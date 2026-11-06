import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueJob, jobFile, listJobs, listProjects, registerProject, resolveProject, unregisterProject } from '../src/store.mjs';
import { executeT3, runRunner, runnerStatus } from '../src/runner.mjs';

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 't3-companion-test-'));
  const projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root: path.join(root, 'state'), projectDir };
}

test('registry is deterministic and does not auto-register unknown projects', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const a = await registerProject(projectDir, root);
  const b = await registerProject(projectDir, root);
  assert.deepEqual(a, b);
  assert.equal((await listProjects(root)).length, 1);
  assert.equal((await resolveProject(projectDir, root)).id, a.id);
  await assert.rejects(resolveProject('not-registered', root), /not registered/);
  assert.equal((await unregisterProject(a.id, root)).id, a.id);
  assert.equal((await listProjects(root)).length, 0);
});

test('queue is file-based, persistent and prevents unregistering active projects', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const project = await registerProject(projectDir, root);
  const job = await enqueueJob(project.id, 'Implement a test', {}, root);
  assert.equal(job.state, 'pending');
  assert.equal((await listJobs(root))[0].prompt, 'Implement a test');
  await assert.rejects(unregisterProject(project.id, root), /pending or running/);
  await assert.rejects(enqueueJob(project.id, '  ', {}, root), /Prompt/);
});

test('runner dispatches through executor, persists results and honors worktrees', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const project = await registerProject(projectDir, root);
  const work = await enqueueJob(project.id, 'hello', { worktree: 'main' }, root);
  const seen = [];
  await runRunner({ root, once: true, execute: async (job, target) => {
    seen.push([job.id, target.path, job.worktree]);
    return { state: 'completed', threadId: 'thread-123', reply: 'done' };
  }});
  assert.deepEqual(seen, [[work.id, projectDir, 'main']]);
  const result = (await listJobs(root))[0];
  assert.equal(result.state, 'completed');
  assert.equal(result.threadId, 'thread-123');
  assert.equal((await runnerStatus(root)).running, false);
});

test('a recovered running job is interrupted, not dispatched twice', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const project = await registerProject(projectDir, root);
  const job = await enqueueJob(project.id, 'hello', {}, root);
  await fs.mkdir(path.dirname(jobFile(root, 'running', job.id)), { recursive: true });
  await fs.rename(jobFile(root, 'pending', job.id), jobFile(root, 'running', job.id));
  let count = 0;
  await runRunner({ root, once: true, execute: async () => { count++; return { state: 'completed' }; } });
  assert.equal(count, 0);
  assert.equal((await listJobs(root))[0].state, 'interrupted');
});

test('without a worktree only one same-project job is dispatched per scan', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const project = await registerProject(projectDir, root);
  await enqueueJob(project.id, 'one', {}, root);
  await enqueueJob(project.id, 'two', {}, root);
  let count = 0;
  const execute = async () => { count++; return { state: 'completed' }; };
  await runRunner({ root, once: true, maxConcurrent: 3, execute });
  assert.equal(count, 1);
  assert.equal((await listJobs(root)).filter((job) => job.state === 'pending').length, 1);
  await runRunner({ root, once: true, maxConcurrent: 3, execute });
  assert.equal(count, 2);
});

test('worktree-isolated jobs can execute concurrently', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const project = await registerProject(projectDir, root);
  await enqueueJob(project.id, 'one', { worktree: 'main' }, root);
  await enqueueJob(project.id, 'two', { worktree: 'main' }, root);
  let running = 0, peak = 0;
  await runRunner({ root, once: true, maxConcurrent: 3, execute: async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running--;
    return { state: 'completed' };
  }});
  assert.equal(peak, 2);
});

test('T3 adapter uses stdin, --wait and JSON without shell interpolation', async (t) => {
  const { root, projectDir } = await sandbox(t);
  const script = path.join(path.dirname(root), 'fake-t3');
  await fs.writeFile(script, `#!${process.execPath}\nprocess.stdin.setEncoding('utf8'); let text=''; process.stdin.on('data',s=>text+=s); process.stdin.on('end',()=>{ console.log(JSON.stringify({threadId:'t1',runId:'r1',status:'completed',reply:text})); });\n`, { mode: 0o700 });
  const prompt = 'Review file; echo $(rm -rf /)';
  const result = await executeT3({ prompt, worktree: 'main' }, { path: projectDir }, { bin: script });
  assert.equal(result.state, 'completed');
  assert.equal(result.reply, prompt);
  assert.equal(result.threadId, 't1');
});
