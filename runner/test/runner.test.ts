import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicWrite, filesFor, listProjects, readRuntime, readTasks, registerProject, unregisterProject, createTask, readRunnerSettings, saveRunnerSettings } from '../src/storage.ts';
import { runRunner, status, requestStop, workspaceBaseFor } from '../src/runner.ts';
async function sandbox(t: any) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 't3-companion-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const project = path.join(tmp, 'project'); await fs.mkdir(project);
  return { project, home: path.join(tmp, 'home') };
}
test('single projects.json registry with canonical paths', async t => {
  const { project, home } = await sandbox(t);
  await registerProject(project, home); await registerProject(project, home);
  assert.deepEqual(await listProjects(home), [await fs.realpath(project)]);
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
  assert.equal((await readRuntime(project)).requests[task.executionRequests![0].requestId].reply, undefined, 'runtime should not duplicate full T3 replies');
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

test('parallel worker completions preserve both runtime records', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const a = await createTask(project, 'One', 'one', 'main');
  const b = await createTask(project, 'Two', 'two', 'main');
  await runRunner({ home, once: true, execute: async (_p, task) => {
    await new Promise(resolve => setTimeout(resolve, task.title === 'One' ? 20 : 5));
    return { status: 'completed', threadId: task.id };
  } });
  const { requests } = await readRuntime(project);
  assert.equal(Object.keys(requests).length, 2);
  assert.equal(requests[a.executionRequests![0].requestId].threadId, a.id);
  assert.equal(requests[b.executionRequests![0].requestId].threadId, b.id);
});
test('scheduled future request is not dispatched', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const a = await createTask(project, 'Future', 'not yet');
  const doc = await readTasks(project);
  doc.tasks[0].executionRequests![0].notBefore = new Date(Date.now() + 60_000).toISOString();
  await atomicWrite(filesFor(project).tasks, doc);
  let called = false;
  await runRunner({ home, once: true, execute: async () => { called = true; return { status: 'completed' }; } });
  assert.equal(called, false);
  assert.equal(Object.keys((await readRuntime(project)).requests).length, 0);
});
test('duplicate execution request IDs fail validation without overwriting task data', async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const task = await createTask(project, 'A', 'A');
  const doc = await readTasks(project);
  doc.tasks.push({ ...task, id: 'second-task' });
  await atomicWrite(filesFor(project).tasks, doc);
  await assert.rejects(readTasks(project), /Invalid task contract/);
});
// This uses a POSIX shebang executable. Windows cannot spawn a .js file
// directly without a native .exe, which is covered separately by CLI resolver
// tests and real-host smoke testing.
test('T3 adapter safely passes prompt via stdin and accepts JSON result',
  { skip: process.platform === 'win32' ? 'POSIX shebang executable' : false }, async t => {
  const { project, home } = await sandbox(t); await registerProject(project, home);
  const tmp = path.dirname(home);
  const mock = path.join(tmp, 'mock-t3');
  await fs.writeFile(mock, `#!${process.execPath}\nlet s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify({threadId:'test-thread',runId:'run-1',status:'completed',reply:s})));\n`, { mode: 0o700 });
  const { executeT3 } = await import('../src/runner.ts');
  const previous = process.env.T3_COMPANION_T3_BIN;
  process.env.T3_COMPANION_T3_BIN = mock;
  try {
    const prompt = 'Do not expand $(pwd) or `echo hi`';
    const response = await executeT3(project, { id: 'x', title: 'A', status: 'todo', prompt }, { requestId: 'y' });
    assert.equal(response.status, 'completed');
    assert.equal(response.reply, prompt);
    assert.equal(response.threadId, 'test-thread');
  } finally {
    if (previous === undefined) delete process.env.T3_COMPANION_T3_BIN;
    else process.env.T3_COMPANION_T3_BIN = previous;
  }
});

test('cloned runner bin works directly with Node without npm link', async t => {
  const { home } = await sandbox(t);
  const bin = fileURLToPath(new URL('../bin/t3-runner.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [bin, 'status'], {
    env: { ...process.env, T3_COMPANION_HOME: home }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.running, false);
  assert.equal(data.home, home);
});

test('auto workspace resolves the selected Git branch, without hardcoded main', async t => {
  const { project } = await sandbox(t);
  const init = spawnSync('git', ['init', '-b', 'feature/test', project], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(workspaceBaseFor(project, { requestId: 'x', workspace: 'auto' }), 'feature/test');
  assert.equal(workspaceBaseFor(project, { requestId: 'x', workspace: 'worktree', worktree: 'release' }), 'release');
  assert.equal(workspaceBaseFor(project, { requestId: 'x', workspace: 'root', worktree: 'release' }), null);
  assert.equal(workspaceBaseFor(project, { requestId: 'x' }), null, 'legacy requests stay in root');
});
test('new task snapshots honor workspace, base ref and scheduled not-before', async t => {
  const { project, home } = await sandbox(t);
  await registerProject(project, home);
  const task = await createTask(project, 'Configured', 'Do it');
  const doc = await readTasks(project);
  const configured = {
    workspace: 'worktree' as const, baseRef: 'origin/main', branch: 'fix/task',
    modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
    notBefore: new Date(Date.now() + 60_000).toISOString(),
  };
  doc.tasks[0].execution = { ...configured };
  doc.tasks[0].executionRequests![0] = {
    requestId: task.executionRequests![0].requestId,
    execution: { ...configured }, notBefore: configured.notBefore,
  };
  await atomicWrite(filesFor(project).tasks, doc);
  let called = false;
  await runRunner({ home, once: true, execute: async () => {
    called = true; return { status: 'completed' };
  } });
  assert.equal(called, false);
  const read = await readTasks(project);
  assert.deepEqual(read.tasks[0].executionRequests![0].execution, configured);
});

test('T3 CLI receives the configured model, title and no injected shell parsing',
  { skip: process.platform === 'win32' ? 'POSIX shebang executable' : false }, async t => {
  const { project, home } = await sandbox(t);
  const mock = path.join(path.dirname(home), 'mock-t3-model');
  await fs.writeFile(mock, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({status:'completed',threadId:'one',reply:JSON.stringify(process.argv.slice(2))})));\n`, { mode: 0o700 });
  const previous = process.env.T3_COMPANION_T3_BIN;
  process.env.T3_COMPANION_T3_BIN = mock;
  try {
    const { executeT3 } = await import('../src/runner.ts');
    const task = { id: 'task-1', title: 'Fix tests', status: 'todo' as const, prompt: 'Fix tests' };
    const request = { requestId: 'req-1', execution: {
      workspace: 'root' as const, modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
    }};
    const result = await executeT3(project, task, request);
    const args = JSON.parse(result.reply!);
    assert.deepEqual(args.slice(0,4), ['thread','start',project,'-']);
    assert.equal(args[args.indexOf('--title') + 1], 'Fix tests');
    assert.equal(args[args.indexOf('--provider') + 1], 'codex');
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
    assert.equal(args.includes('--worktree'), false);
  } finally {
    if (previous === undefined) delete process.env.T3_COMPANION_T3_BIN;
    else process.env.T3_COMPANION_T3_BIN = previous;
  }
});

test('auto worktree serializes non-Git tasks but parallelizes Git tasks', async t => {
  const { project, home } = await sandbox(t);
  await registerProject(project, home);
  const a = await createTask(project, 'A', 'one');
  const b = await createTask(project, 'B', 'two');
  const doc = await readTasks(project);
  for (const task of doc.tasks) task.executionRequests![0].workspace = 'auto';
  await atomicWrite(filesFor(project).tasks, doc);
  let active = 0, peak = 0;
  const execute = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return { status: 'completed' as const };
  };
  await runRunner({ home, once: true, execute });
  assert.equal(peak, 1, 'non-Git auto workspace uses serial root');
  assert.equal(Object.keys((await readRuntime(project)).requests).length, 1);
  const init = spawnSync('git', ['init', '-b', 'integration', project], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  // Existing completed request does not re-run; the next run can execute other isolated requests.
  const next = await readTasks(project);
  next.tasks[0].executionRequests!.push({ requestId: 'git-1', workspace: 'auto' });
  next.tasks[1].executionRequests!.push({ requestId: 'git-2', workspace: 'auto' });
  await atomicWrite(filesFor(project).tasks, next);
  // Hold the first worker until another worker has started. Timing-based
  // peak measurements were flaky under CPU pressure in GitHub Actions.
  peak = 0;
  let unblock!: () => void;
  const concurrentStart = new Promise<void>(resolve => { unblock = resolve; });
  await runRunner({ home, once: true, execute: async () => {
    active++;
    peak = Math.max(peak, active);
    if (active >= 2) unblock();
    await Promise.race([concurrentStart, new Promise<void>(resolve => setTimeout(resolve, 600))]);
    active--;
    return { status: 'completed' as const };
  } });
  assert.ok(peak >= 2 && peak <= 3, 'Git auto workspace supports parallel execution up to the pool cap');
  assert.equal(a.title, 'A'); assert.equal(b.title, 'B');
});
test('explicit root request stays serialized even with a baseRef field', async t => {
  const { project, home } = await sandbox(t);
  await registerProject(project, home);
  await createTask(project, 'A', 'one');
  await createTask(project, 'B', 'two');
  const doc = await readTasks(project);
  for (const task of doc.tasks) {
    task.executionRequests![0].workspace = 'root';
    task.executionRequests![0].worktree = 'unexpected-legacy-base';
  }
  await atomicWrite(filesFor(project).tasks, doc);
  let active = 0, peak = 0;
  await runRunner({ home, once: true, execute: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return { status: 'completed' };
  }});
  assert.equal(peak, 1);
});

test('Runner settings persist and control the scheduler independently of browser preferences', async t => {
  const { home, project } = await sandbox(t);
  assert.deepEqual(await readRunnerSettings(home), { maxConcurrent: 3, scanIntervalMs: 10000 });
  await assert.rejects(saveRunnerSettings({ maxConcurrent: 4, scanIntervalMs: 10000 }, home), /1\.\.3/);
  await saveRunnerSettings({ maxConcurrent: 1, scanIntervalMs: 10000 }, home);
  await registerProject(project, home);
  for (let i = 0; i < 3; i++) await createTask(project, 'Task ' + i, 'work', 'main');
  let active = 0, peak = 0, waitForPair = false;
  let release!: () => void;
  const pair = new Promise<void>(resolve => { release = resolve; });
  const execute = async () => {
    active++; peak = Math.max(active, peak);
    if (waitForPair && active >= 2) release();
    await Promise.race([
      waitForPair ? pair : Promise.resolve(),
      new Promise<void>(resolve => setTimeout(resolve, 400)),
    ]);
    active--;
    return { status: 'completed' as const };
  };
  await runRunner({ home, once: true, execute });
  assert.equal(peak, 1);
  assert.equal(Object.keys((await readRuntime(project)).requests).length, 1);
  await saveRunnerSettings({ maxConcurrent: 2, scanIntervalMs: 10000 }, home);
  waitForPair = true; peak = 0;
  await runRunner({ home, once: true, execute });
  assert.equal(peak, 2);
  assert.equal(Object.keys((await readRuntime(project)).requests).length, 3);
});

test('Runner rescans a waiting T3 thread, then follows open PR to merged Done', async t => {
  const { home, project } = await sandbox(t);
  await registerProject(project, home);
  const task = await createTask(project, 'Implement change', 'Do the work', 'main');
  const requestId = task.executionRequests![0].requestId;
  let stage = 'human_review';
  let calls = 0;
  const inspect = async (_project: string, threadId: string) => {
    assert.equal(threadId, 'thread-a');
    return { stage: stage as 'human_review' | 'awaiting_merge' | 'done', pendingRequestCount: stage === 'human_review' ? 1 : 0,
      changeRequests: stage === 'human_review' ? [] : [{ url: 'https://github.com/a/b/pull/1',
        state: stage === 'done' ? 'merged' as const : 'open' as const }] };
  };
  await runRunner({ home, once: true, inspect, execute: async () => {
    calls++;
    return { status: 'blocked', threadId: 'thread-a' };
  } });
  let record = (await readRuntime(project)).requests[requestId];
  assert.equal(record.status, 'blocked');
  assert.equal(record.workflowStage, 'human_review');
  stage = 'awaiting_merge';
  record.lastInspectedAt = '2000-01-01T00:00:00.000Z';
  const file = filesFor(project).runtime;
  await atomicWrite(file, await readRuntime(project).then(doc => ({ ...doc, requests: { ...doc.requests, [requestId]: record } })));
  await runRunner({ home, once: true, inspect, execute: async () => { calls++; return { status: 'completed' }; } });
  record = (await readRuntime(project)).requests[requestId];
  assert.equal(record.status, 'completed');
  assert.equal(record.workflowStage, 'awaiting_merge');
  stage = 'done';
  record.lastInspectedAt = '2000-01-01T00:00:00.000Z';
  await atomicWrite(file, await readRuntime(project).then(doc => ({ ...doc, requests: { ...doc.requests, [requestId]: record } })));
  await runRunner({ home, once: true, inspect, execute: async () => { calls++; return { status: 'completed' }; } });
  record = (await readRuntime(project)).requests[requestId];
  assert.equal(record.workflowStage, 'done');
  assert.equal(record.changeRequests?.[0]?.state, 'merged');
  assert.equal(calls, 1, 'scanning must not re-run an agent task');
  assert.equal((await readTasks(project)).tasks[0].status, 'todo', 'Runner must never mutate task definitions');
});
