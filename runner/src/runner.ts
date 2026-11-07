import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { projectThreadInspection, type ThreadInspection } from './workflow.ts';
import { requireT3Cli } from './t3-cli.ts';
import { defaultHome, listProjects, readTasks, readRuntime, saveRuntime, readRunnerSettings } from './storage.ts';
import type { Task, ExecutionRequest } from './storage.ts';
import { acquire, release, status, requestStop, stopFile } from './lock.ts';
import { reconcileProject, type InspectThread } from './reconciler.ts';

export { status, requestStop };
export type { InspectThread };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const inspectExec = promisify(execFile);

/** Read T3's server-owned thread projection, never scrape visible UI or agent text. */
export const inspectT3Thread: InspectThread = async (project, threadId) => {
  try {
    const { stdout } = await inspectExec(await requireT3Cli(),
      ['thread', 'show', threadId, '--messages', '1', '--json'],
      { cwd: project, encoding: 'utf8', timeout: 9000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return projectThreadInspection(JSON.parse(stdout));
  } catch {
    return null; // an unreachable T3 host is unknown, never proof of completion/merge
  }
};

export async function startDetached(home = defaultHome()) {
  if ((await status(home)).running) throw new Error('Runner already running');
  // Validate *before* announcing a running worker pool. A logged-in T3 Web
  // session does not guarantee the CLI is available to a detached process.
  await requireT3Cli();
  await fs.mkdir(home, { recursive: true });
  const file = await fs.open(path.join(home, 'runner.log'), 'a', 0o600);
  try {
    const cli = path.resolve(import.meta.dirname, 'cli.ts');
    const child = spawn(process.execPath, ['--experimental-strip-types', cli, 'run'], { detached: true, windowsHide: true,
      env: { ...process.env, T3_COMPANION_HOME: home }, stdio: ['ignore', file.fd, file.fd] });
    child.unref(); return child.pid;
  } finally { await file.close(); }
}

/** Resolve a base branch without guessing 'main' for repositories using another default. */
function gitOutput(project: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function workspaceBaseFor(project: string, request: ExecutionRequest): string | null {
  const configuration = request.execution;
  if (configuration?.workspace === 'root' || request.workspace === 'root') return null;
  // An explicit worktree ref from the v1 contract always opts into isolation.
  const explicit = configuration ? configuration.baseRef?.trim() : request.worktree?.trim();
  if (!configuration && !request.workspace && !explicit) return null; // legacy stays on shared checkout
  const isRepo = gitOutput(project, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!isRepo) {
    if ((configuration?.workspace || request.workspace) === 'auto' && !explicit) return null; // non-Git use root
    throw new Error('Worktree execution requires a Git repository');
  }
  const branch = explicit ||
    gitOutput(project, ['branch', '--show-current']) ||
    gitOutput(project, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '');
  if (!branch) throw new Error('Cannot resolve a base branch; select one in Advanced options');
  return branch;
}

export type Execute = (project: string, task: Task, request: ExecutionRequest) => Promise<{ status: 'completed' | 'blocked' | 'failed'; threadId?: string | null; runId?: string | null; reply?: string | null; error?: string | null }>;
export const executeT3: Execute = async (project, task, request) => {
  const cli = await requireT3Cli();
  const args = ['thread', 'start', project, '-', '--wait', '--json', '--title', task.title];
  const base = workspaceBaseFor(project, request);
  if (base) args.push('--worktree', base);
  // T3's native CLI supports provider/model as a pair; never guess or use UI labels.
  if (request.execution?.modelSelection) {
    args.push('--provider', request.execution.modelSelection.instanceId,
      '--model', request.execution.modelSelection.model);
  }
  if (request.execution?.branch) {
    if (!base) throw new Error('A named worktree branch requires a Git base ref');
    args.push('--branch', request.execution.branch);
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(cli, args, { cwd: project, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    proc.stdout.on('data', x => stdout.push(x)); proc.stderr.on('data', x => stderr.push(x));
    proc.on('error', reject); proc.stdin.on('error', () => {});
    proc.on('close', code => {
      const text = Buffer.concat(stdout).toString('utf8'), err = Buffer.concat(stderr).toString('utf8').trim();
      let response: any;
      try { response = JSON.parse(text); }
      catch { response = { error: err || text.trim() || `T3 exit ${code}` }; }
      const status = code === 2 && response.status === 'waiting' ? 'blocked' :
        code === 0 && response.status === 'completed' ? 'completed' : 'failed';
      resolve({ status, threadId: response.threadId || null, runId: response.runId || null,
        reply: response.reply ?? null, error: response.error || (status === 'failed' ? err || `T3 exit ${code}` : null) });
    });
    proc.stdin.end(task.prompt);
  });
};

export async function runRunner({ home = defaultHome(), once = false, intervalMs, concurrency, execute = executeT3, inspect }:
  { home?: string; once?: boolean; intervalMs?: number; concurrency?: number; execute?: Execute; inspect?: InspectThread } = {}) {
  // Synthetic executors used by unit tests do not contact a real T3 server.
  const inspectThread = inspect ?? (execute === executeT3 ? inspectT3Thread : null);
  if (intervalMs !== undefined && (!Number.isInteger(intervalMs) || intervalMs < 10))
    throw new Error('Polling interval must be >= 10ms');
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3))
    throw new Error('Concurrency must be 1..3');
  // Refuse to claim queued requests if the actual T3 CLI cannot be located.
  // Otherwise ENOENT would incorrectly mark untouched work as failed.
  if (execute === executeT3) await requireT3Cli();
  const owner = await acquire(home);
  const active = new Map<string, Promise<void>>();
  // Serialize read-modify-write of runtime.json per project. Atomic rename alone
  // does not prevent lost updates when multiple agent executions finish together.
  const runtimeQueues = new Map<string, Promise<unknown>>();
  async function updateRuntime(project: string, mutate: (doc: Awaited<ReturnType<typeof readRuntime>>) => boolean | void) {
    const previous = runtimeQueues.get(project) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const doc = await readRuntime(project);
      const changed = mutate(doc);
      if (changed === false) return false;
      await saveRuntime(project, doc);
      return true;
    });
    runtimeQueues.set(project, next.catch(() => {}));
    return next;
  }

  const nonWorktreeProjects = new Set<string>();
  let stopping = false;
  const onSignal = () => { stopping = true; };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    await fs.rm(stopFile(home), { force: true });
    // Crash may leave a T3 agent running. Never replay a dispatching request automatically.
    for (const project of await listProjects(home)) {
      try {
        await updateRuntime(project, runtime => {
          let changed = false;
          for (const entry of Object.values(runtime.requests)) if (entry.status === 'dispatching') {
            entry.status = 'needs_reconciliation'; changed = true;
          }
          return changed;
        });
      } catch (error) { console.error(String(error)); }
    }
    while (!stopping) {
      if (await fs.stat(stopFile(home)).then(() => true, () => false)) break;
      // Read durable config on every dispatch cycle; decreases never kill
      // running workers. Explicit CLI overrides remain supported.
      const settings = await readRunnerSettings(home);
      const poolLimit = concurrency ?? settings.maxConcurrent;
      const cycleMs = intervalMs ?? settings.scanIntervalMs;
      for (const project of await listProjects(home)) {
        if (stopping) break; // PR/input reconciliation continues while the pool is full
        try {
          const tasks = await readTasks(project); const runtime = await readRuntime(project);
          for (const task of tasks.tasks) for (const request of task.executionRequests || []) {
            if (active.size >= poolLimit || stopping) break;
            if (await fs.stat(stopFile(home)).then(() => true, () => false)) { stopping = true; break; }
            if (runtime.requests[request.requestId]) continue;
            const notBefore = request.notBefore || request.execution?.notBefore;
            if (notBefore && (Number.isNaN(Date.parse(notBefore)) || Date.parse(notBefore) > Date.now())) continue;
            const workspace = request.execution?.workspace || request.workspace;
            const sharedCheckout = workspace === 'root' ? true
              : workspace === 'auto' ? gitOutput(project, ['rev-parse', '--is-inside-work-tree']) !== 'true'
              : workspace === 'worktree' ? false
              : !request.worktree; // legacy behavior
            if (sharedCheckout && nonWorktreeProjects.has(project)) continue;
            const id = `${project}:${request.requestId}`;
            const claimed = await updateRuntime(project, current => {
              if (current.requests[request.requestId]) return false;
              current.requests[request.requestId] = { taskId: task.id, status: 'dispatching', startedAt: new Date().toISOString() };
            });
            if (!claimed) continue;
            runtime.requests[request.requestId] = { taskId: task.id, status: 'dispatching', startedAt: new Date().toISOString() };
            // The durable intent has been written before any T3 CLI side effect.
            if (sharedCheckout) nonWorktreeProjects.add(project);
            const operation = (async () => {
              try {
                const result = await execute(project, task, request);
                // Full agent replies belong in T3 threads, not the Side Panel's
                // repeatedly-read runtime.json. Keep only execution metadata.
                const { reply: _reply, ...summary } = result;
                // The first projection may already expose the linked PR, so
                // use it immediately. Subsequent scans follow merges and input.
                const observed = result.threadId && inspectThread
                  ? await inspectThread(project, result.threadId).catch(() => null) : null;
                await updateRuntime(project, updated => {
                  updated.requests[request.requestId] = {
                    ...updated.requests[request.requestId], ...summary, finishedAt: new Date().toISOString(),
                    workflowStage: observed?.stage ?? 'human_review',
                    ...(observed ? { pendingRequestCount: observed.pendingRequestCount,
                      changeRequests: observed.changeRequests, lastInspectedAt: new Date().toISOString() } : {}),
                  };
                });
              } catch (error) {
                await updateRuntime(project, updated => {
                  updated.requests[request.requestId] = { ...updated.requests[request.requestId], status: 'failed', workflowStage: 'human_review', error: String(error), finishedAt: new Date().toISOString() };
                });
              } finally {
                active.delete(id); if (sharedCheckout) nonWorktreeProjects.delete(project);
              }
            })(); active.set(id, operation);
          }
        } catch (error) { console.error(`Skipping ${project}: ${String(error)}`); }
        // Scan even when there are no new queue entries.
        try {
          if (inspectThread) await reconcileProject(project, inspectThread, updateRuntime);
        } catch (error) { console.error(`Status scan failed for ${project}: ${String(error)}`); }
      }
      if (once) break;
      await sleep(cycleMs);
    }
    await Promise.allSettled(active.values());
  } finally {
    await Promise.allSettled(active.values());
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    await fs.rm(stopFile(home), { force: true }); await release(home, owner);
  }
}
