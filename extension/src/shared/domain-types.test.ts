import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRunnerState, validateTasks, validateRuntime, getTaskColumn, type Task, type RuntimeDocument } from './domain-types.ts';

test('parseRunnerState handles uninstalled and running states without regex', () => {
  const stoppedJson = JSON.stringify({
    running: false,
    installed: true,
    pid: null,
    settings: { maxConcurrent: 2, scanIntervalMs: 10000 },
    cli: { available: true, command: '/usr/local/bin/t3' },
  });
  const state = parseRunnerState(stoppedJson, true);
  assert.equal(state.running, false);
  assert.equal(state.installed, true);
  assert.equal(state.label, 'Stopped');
  assert.equal(state.maxConcurrent, 2);
  assert.equal(state.cliAvailable, true);
  assert.equal(state.cliCommand, '/usr/local/bin/t3');

  const runningJson = JSON.stringify({
    running: true,
    installed: true,
    pid: 1234,
    version: 'abcdef1234567890abcdef1234567890abcdef12',
  });
  const runningState = parseRunnerState(runningJson, true);
  assert.equal(runningState.running, true);
  assert.equal(runningState.pid, 1234);
  assert.equal(runningState.label, 'Running');

  const errorState = parseRunnerState('Runner check failed: Process timeout', true);
  assert.equal(errorState.error, 'Process timeout');
  assert.equal(errorState.label, 'Error');

  const noHostState = parseRunnerState(runningJson, false);
  assert.equal(noHostState.label, 'Needs session');
});

test('parseRunnerState accepts actual Runner CLI status envelope with nested settings', () => {
  // runner/src/cli.ts produces {running,pid,home,settings,cli}; the controller
  // merges that with installed/version rather than flattening settings.
  const actualStatus = JSON.stringify({
    running: true,
    pid: 8412,
    home: '/home/test/t3-companion/.data/runner',
    settings: { maxConcurrent: 2, scanIntervalMs: 15000 },
    cli: { available: true, command: '/home/test/.local/bin/t3', source: 'local-install' },
    installed: true,
    upgradeRequired: false,
    version: 'a'.repeat(40),
  });
  const state = parseRunnerState(actualStatus, true);
  assert.equal(state.label, 'Running');
  assert.equal(state.maxConcurrent, 2);
  assert.equal(state.scanIntervalMs, 15000);
  assert.equal(state.cliAvailable, true);
  assert.equal(state.upgradeRequired, false);
});

test('top-level legacy scheduler settings are ignored', () => {
  const obsolete = parseRunnerState(JSON.stringify({
    installed: true, running: false, maxConcurrent: 1, scanIntervalMs: 20000,
  }), true);
  assert.equal(obsolete.maxConcurrent, 3);
  assert.equal(obsolete.scanIntervalMs, null);

  const invalid = parseRunnerState(JSON.stringify({
    installed: true, running: false,
    settings: { maxConcurrent: '3', scanIntervalMs: '10000' },
  }), true);
  assert.equal(invalid.maxConcurrent, 3);
  assert.equal(invalid.scanIntervalMs, null);
});

test('getTaskColumn projects status correctly from runtime record and manual override', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Test',
    prompt: 'Do something',
    status: 'todo',
    executionRequests: [{ requestId: 'req-1', execution: { workspace: 'auto' } }],
  };

  const runtime: RuntimeDocument = {
    version: 1,
    requests: {
      'req-1': {
        taskId: 'task-1',
        status: 'dispatching',
        workflowStage: 'in_progress',
      },
    },
  };

  assert.equal(getTaskColumn(task, runtime), 'in_progress');

  runtime.requests['req-1']!.workflowStage = 'human_review';
  assert.equal(getTaskColumn(task, runtime), 'review');

  runtime.requests['req-1']!.workflowStage = 'awaiting_merge';
  assert.equal(getTaskColumn(task, runtime), 'awaiting_merge');

  runtime.requests['req-1']!.workflowStage = 'done';
  assert.equal(getTaskColumn(task, runtime), 'done');

  // Manual override takes precedence
  const overriddenTask: Task = { ...task, status: 'review', statusOverride: true };
  assert.equal(getTaskColumn(overriddenTask, runtime), 'review');
});

test('validateTasks and validateRuntime reject invalid payloads', () => {
  assert.throws(() => validateTasks({ version: 2, tasks: [] }));
  assert.throws(() => validateTasks({ version: 1, tasks: [{ id: '1' }] }));
  assert.throws(() => validateRuntime({ version: 1, requests: [] }));

  assert.doesNotThrow(() => validateTasks({ version: 1, tasks: [] }));
  assert.doesNotThrow(() => validateRuntime({ version: 1, requests: {} }));
});

test('task execution settings validate and remain separate from queued snapshots', () => {
  const configured = {
    version: 1, tasks: [{
      id: 'task', title: 'Fix', prompt: 'Fix it', status: 'todo',
      execution: { workspace: 'worktree', baseRef: 'origin/main',
        modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' } },
      executionRequests: [{ requestId: 'run-1', execution: {
        workspace: 'root', notBefore: '2026-12-01T02:00:00.000Z' } }],
    }],
  };
  assert.doesNotThrow(() => validateTasks(configured));
  assert.throws(() => validateTasks({ ...configured,
    tasks: [{ ...configured.tasks[0], execution: { workspace: 'unsupported' } }] }));
  assert.throws(() => validateTasks({ ...configured,
    tasks: [{ ...configured.tasks[0], executionRequests: [{ requestId: 'run-2',
      execution: { workspace: 'worktree', modelSelection: { instanceId: '', model: 'gpt' } } }] }] }));
  assert.throws(() => validateTasks({ ...configured,
    tasks: [{ ...configured.tasks[0], executionRequests: [{ requestId: 'old-request' }] }] }));
});
