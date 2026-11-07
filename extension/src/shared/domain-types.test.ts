import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRunnerState, validateTasks, validateRuntime, getTaskColumn, type Task, type RuntimeDocument } from './domain-types.ts';

test('parseRunnerState handles uninstalled and running states without regex', () => {
  const stoppedJson = JSON.stringify({
    running: false,
    installed: true,
    pid: null,
    maxConcurrent: 2,
    scanIntervalMs: 10000,
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

test('getTaskColumn projects status correctly from runtime record and manual override', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Test',
    prompt: 'Do something',
    status: 'todo',
    executionRequests: [{ requestId: 'req-1' }],
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
