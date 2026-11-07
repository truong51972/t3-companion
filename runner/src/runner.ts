import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { defaultHome, listProjects, readJson, readTasks, readRuntime, saveRuntime } from './storage.ts';
import type { Task, ExecutionRequest } from './storage.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const lockDir = (home: string) => path.join(home, 'runner.lock');
const stopFile = (home: string) => path.join(home, 'stop.json');
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; } };
export async function status(home = defaultHome()) {
  try { const owner = await readJson(path.join(lockDir(home), 'owner.json')); return { running: Number.isInteger(owner.pid) && isAlive(owner.pid), pid: owner.pid }; }
  catch { return { running: false, pid: null }; }
}
async function acquire(home: string) {
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const dir = lockDir(home);
  try { await fs.mkdir(dir); }
  catch (e: any) {
    if (e.code !== 'EEXIST') throw e;
    if ((await status(home)).running) throw new Error('Runner is already running');
    const stat = await fs.stat(dir);
    if (Date.now() - stat.mtimeMs < 3000) throw new Error('Runner lock is initializing; retry');
    const stale = `${dir}.stale-${randomUUID()}`;
    await fs.rename(dir, stale); await fs.rm(stale, { recursive: true });
    await fs.mkdir(dir);
  }
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  return owner;
}
async function release(home: string, owner: {token: string}) {
  try {
    const current = await readJson(path.join(lockDir(home), 'owner.json'));
    if (current.token === owner.token) await fs.rm(lockDir(home), { recursive: true });
  } catch { /* lock removed */ }
}
export async function requestStop(home = defaultHome()) {
  if (!(await status(home)).running) return false;
  await fs.writeFile(stopFile(home), JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
  return true;
}
export async function startDetached(home = defaultHome()) {
  if ((await status(home)).running) throw new Error('Runner already running');
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
  if (request.workspace === 'root') return null;
  // An explicit worktree ref from the v1 contract always opts into isolation.
  const explicit = request.worktree?.trim();
  if (!request.workspace && !explicit) return null; // legacy requests stay on the shared checkout
  const isRepo = gitOutput(project, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!isRepo) {
    if (request.workspace === 'auto' && !explicit) return null; // non-Git projects use root
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
  const args = ['thread', 'start', project, '-', '--wait', '--json'];
  const base = workspaceBaseFor(project, request);
  if (base) args.push('--worktree', base);
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.T3_COMPANION_T3_BIN || 't3', args, { cwd: project, stdio: ['pipe', 'pipe', 'pipe'] });
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

export async function runRunner({ home = defaultHome(), once = false, intervalMs = 10000, concurrency = 3, execute = executeT3 }:
  { home?: string; once?: boolean; intervalMs?: number; concurrency?: number; execute?: Execute } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 10) throw new Error('Polling interval must be >= 10ms');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Concurrency must be 1..3');
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
      for (const project of await listProjects(home)) {
        if (stopping || active.size >= concurrency) break;
        try {
          const tasks = await readTasks(project); const runtime = await readRuntime(project);
          for (const task of tasks.tasks) for (const request of task.executionRequests || []) {
            if (active.size >= concurrency || stopping) break;
            if (await fs.stat(stopFile(home)).then(() => true, () => false)) { stopping = true; break; }
            if (runtime.requests[request.requestId]) continue;
            if (request.notBefore && (Number.isNaN(Date.parse(request.notBefore)) || Date.parse(request.notBefore) > Date.now())) continue;
            let sharedCheckout = !request.worktree && request.workspace !== 'worktree';
            if (request.workspace === 'auto') {
              sharedCheckout = gitOutput(project, ['rev-parse', '--is-inside-work-tree']) !== 'true';
            }
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
                await updateRuntime(project, updated => {
                  updated.requests[request.requestId] = { ...updated.requests[request.requestId], ...summary, finishedAt: new Date().toISOString() };
                });
              } catch (error) {
                await updateRuntime(project, updated => {
                  updated.requests[request.requestId] = { ...updated.requests[request.requestId], status: 'failed', error: String(error), finishedAt: new Date().toISOString() };
                });
              } finally {
                active.delete(id); if (sharedCheckout) nonWorktreeProjects.delete(project);
              }
            })(); active.set(id, operation);
          }
        } catch (error) { console.error(`Skipping ${project}: ${String(error)}`); }
      }
      if (once) break;
      await sleep(intervalMs);
    }
    await Promise.allSettled(active.values());
  } finally {
    await Promise.allSettled(active.values());
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    await fs.rm(stopFile(home), { force: true }); await release(home, owner);
  }
}
