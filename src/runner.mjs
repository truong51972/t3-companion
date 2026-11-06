import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { initialize, jobFile, listJobs, listProjects, moveJob, readJson, rootDir } from './store.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lockPath = (root) => path.join(root, 'runner.lock');
const stopPath = (root) => path.join(root, 'stop.json');

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export async function runnerStatus(root = rootDir()) {
  const lock = lockPath(root);
  try {
    const owner = await readJson(path.join(lock, 'owner.json'));
    return { running: isAlive(owner.pid), pid: owner.pid, token: owner.token };
  } catch { return { running: false }; }
}

async function acquire(root) {
  const lock = lockPath(root);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(lock);
      const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
      await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      return owner;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const status = await runnerStatus(root);
      if (status.running) throw new Error(`Runner already active (PID ${status.pid})`);
      // A recently created lock may still be awaiting owner.json.
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs < 2000) throw new Error('Runner is starting; try again');
      const stale = `${lock}.stale-${randomUUID()}`;
      try { await fs.rename(lock, stale); await fs.rm(stale, { recursive: true, force: true }); }
      catch (moveError) { if (moveError.code !== 'ENOENT') throw moveError; }
    }
  }
  throw new Error('Unable to obtain runner lock');
}

async function release(root, owner) {
  const lock = lockPath(root);
  try {
    const current = await readJson(path.join(lock, 'owner.json'));
    if (current.token === owner.token) await fs.rm(lock, { recursive: true, force: true });
  } catch { /* Lock removed externally. */ }
}

export async function requestStop(root = rootDir()) {
  if (!(await runnerStatus(root)).running) return false;
  await fs.writeFile(stopPath(root), JSON.stringify({ requestedAt: new Date().toISOString() }), { mode: 0o600 });
  return true;
}

export async function startDetached(root = rootDir()) {
  await initialize(root);
  if ((await runnerStatus(root)).running) throw new Error('Runner already active');
  const logFile = await fs.open(path.join(root, 'runner.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'bin', 't3-companion.mjs'), 'runner', 'run'], {
      env: { ...process.env, T3_COMPANION_HOME: root }, detached: true, stdio: ['ignore', logFile.fd, logFile.fd],
    });
    child.unref();
    return child.pid;
  } finally { await logFile.close(); }
}

// The T3 CLI owns agent lifecycle. --wait reports completion/blocked/error; no T3 APIs are reimplemented.
export async function executeT3(job, project, { bin = process.env.T3_COMPANION_T3_BIN || 't3' } = {}) {
  const args = ['thread', 'start', project.path, '-', '--wait', '--json'];
  if (job.worktree) args.push('--worktree', job.worktree);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: project.path, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', () => { /* The CLI may exit before consuming stdin. */ });
    child.on('close', (code) => {
      const stdout = Buffer.concat(output).toString('utf8');
      const stderr = Buffer.concat(errors).toString('utf8');
      let details;
      try { details = JSON.parse(stdout); }
      catch { details = { status: 'failed', error: stderr.trim() || stdout.trim() || `T3 exited ${code}` }; }
      const state = code === 2 || details.status === 'waiting' ? 'blocked'
        : code === 0 && (details.status === 'completed' || details.status === undefined) ? 'completed'
        : 'failed';
      resolve({ state, threadId: details.threadId || null, runId: details.runId || null,
        reply: details.reply ?? null, error: details.error || (state === 'failed' ? stderr.trim() || `T3 exited ${code}` : null) });
    });
    child.stdin.end(job.prompt);
  });
}

export async function runRunner({ root = rootDir(), once = false, intervalMs = 10000, maxConcurrent = 3, execute = executeT3 } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 10) throw new Error('intervalMs must be >= 10');
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 3) {
    throw new Error('maxConcurrent must be between 1 and 3');
  }
  await initialize(root);
  const owner = await acquire(root);
  const active = new Map();
  const activeProjects = new Set();
  let stopping = false;
  const onSignal = () => { stopping = true; };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  try {
    await fs.rm(stopPath(root), { force: true });
    // Do not automatically replay a job that might have launched an agent before a crash.
    for (const job of (await listJobs(root)).filter((j) => j.state === 'running')) {
      await moveJob(root, job, 'running', 'interrupted', { finishedAt: new Date().toISOString(),
        error: 'Runner restarted; T3 thread may still be active. Reconcile manually.' });
    }
    while (!stopping) {
      if (await fs.stat(stopPath(root)).then(() => true, () => false)) break;
      const projects = new Map((await listProjects(root)).map((p) => [p.id, p]));
      const queue = (await listJobs(root)).filter((j) => j.state === 'pending');
      for (const job of queue) {
        if (active.size >= maxConcurrent || stopping) break;
        // Without a worktree, never let jobs from the same project mutate a checkout concurrently.
        if (!job.worktree && activeProjects.has(job.projectId)) continue;
        let claimed;
        try { claimed = await moveJob(root, job, 'pending', 'running', { startedAt: new Date().toISOString() }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (!job.worktree) activeProjects.add(job.projectId);
        const task = (async () => {
          try {
            const project = projects.get(job.projectId);
            if (!project) throw new Error('Project is no longer registered');
            const result = await execute(claimed, project);
            await moveJob(root, claimed, 'running', result.state, { ...result, finishedAt: new Date().toISOString() });
          } catch (error) {
            await moveJob(root, claimed, 'running', 'failed', { error: String(error.message || error), finishedAt: new Date().toISOString() });
          } finally { active.delete(job.id); if (!job.worktree) activeProjects.delete(job.projectId); }
        })();
        active.set(job.id, task);
      }
      if (once) break;
      await sleep(intervalMs);
    }
    await Promise.all(active.values());
  } finally {
    await Promise.allSettled(active.values());
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    await fs.rm(stopPath(root), { force: true });
    await release(root, owner);
  }
}
