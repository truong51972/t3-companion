import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite, filesFor, listProjects, readRuntime, readTasks, registerProject, unregisterProject, createTask } from '../src/storage.ts';
import { runRunner, status, requestStop } from '../src/runner.ts';
async function sandbox(t: any) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 't3-companion-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const project = path.join(tmp, 'project'); await fs.mkdir(project);
  return { project, home: path.join(tmp, 'home') };
}
test('single projects.json registry with canonical paths', async t => {
  const { project, home } = await sandbox(t);
  await registerProject(project, home); await registerProject(project, home);
  assert.deepEqual(await listProjects(home), [project]);
  await unregisterProject(project, home); assert.deepEqual(await listProjects(home), []);
});
test('task creation produces project .t3/tasks.json and not runtime until dispatched', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const task = await createTask(project, 'Investigate', 'Inspect source', 'main');
  assert.equal((await readTasks(project)).tasks[0].id, task.id);
  assert.deepEqual((await readRuntime(project)).requests, {});
});
test('dispatch once and preserve kanban status independently of runtime', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const task = await createTask(project, 'Test', 'Do it'); let called = 0;
  const execute = async () => { called++; return { status: 'completed' as const, threadId: 'thread-42', reply: 'ok' }; };
  await runRunner({ home, once: true, execute }); await runRunner({ home, once: true, execute });
  assert.equal(called, 1);
  assert.equal((await readTasks(project)).tasks[0].status, 'todo');
  assert.equal((await readRuntime(project)).requests[task.executionRequests![0].requestId].threadId, 'thread-42');
});
test('existing dispatching request becomes needs_reconciliation and is not retried', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const task = await createTask(project, 'Test', 'Do it');
  const req = task.executionRequests![0].requestId;
  await atomicWrite(filesFor(project).runtime, { version: 1, requests: { [req]: { taskId: task.id, status: 'dispatching', startedAt: new Date().toISOString() } } });
  let called = 0;
  await runRunner({ home, once: true, execute: async () => { called++; return { status: 'completed' }; } });
  assert.equal(called, 0);
  assert.equal((await readRuntime(project)).requests[req].status, 'needs_reconciliation');
});
test('invalid tasks.json is not overwritten, other projects still work', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  await fs.mkdir(path.dirname(filesFor(project).tasks), { recursive: true });
  await fs.writeFile(filesFor(project).tasks, '{bad json');
  await runRunner({ home, once: true, execute: async () => ({ status: 'completed' }) });
  assert.equal(await fs.readFile(filesFor(project).tasks, 'utf8'), '{bad json');
});
test('worktree jobs can execute simultaneously up to the pool cap', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  await createTask(project, 'A', 'A', 'main'); await createTask(project, 'B', 'B', 'main');
  let count = 0, peak = 0;
  await runRunner({ home, once: true, concurrency: 3, execute: async () => { count++; peak = Math.max(peak, count); await new Promise(r => setTimeout(r, 15)); count--; return { status: 'completed' }; } });
  assert.equal(peak, 2);
});
test('plain checkout jobs are serialized', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  await createTask(project, 'A', 'A'); await createTask(project, 'B', 'B');
  let called = 0;
  await runRunner({ home, once: true, execute: async () => { called++; return { status: 'completed' }; } });
  assert.equal(called, 1);
  await runRunner({ home, once: true, execute: async () => { called++; return { status: 'completed' }; } });
  assert.equal(called, 2);
});
test('requestStop drains running work and leaves undispatched requests intact', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  await createTask(project, 'A', 'A'); await createTask(project, 'B', 'B'); let count = 0;
  await runRunner({ home, intervalMs: 10, execute: async () => { count++; assert.equal(await requestStop(home), true); return { status: 'completed' }; } });
  assert.equal(count, 1); assert.equal(Object.keys((await readRuntime(project)).requests).length, 1);
  assert.equal((await status(home)).running, false);
});
