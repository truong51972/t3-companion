import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const script = path.resolve(import.meta.dirname, '../../skills/t3-companion/scripts/tasks.mjs');
function fixture(t) {
  const project = mkdtempSync(path.join(os.tmpdir(), 't3-skill-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: project, encoding: 'utf8' });
    return { ...result, value: result.status === 0 ? JSON.parse(result.stdout) : null };
  };
  return { project, run };
}
test('skill stores execution settings on tasks and snapshots them only on queue', t => {
  const { project, run } = fixture(t);
  const added = run('add', '--title', 'Investigate', '--prompt', 'Inspect failures',
    '--workspace', 'worktree', '--base-ref', 'origin/main', '--provider', 'codex',
    '--model', 'gpt-6.1-sol', '--not-before', '2026-12-01T09:00:00+07:00');
  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.value.status, 'todo');
  assert.equal(added.value.executionRequests, undefined);
  assert.equal(added.value.execution.baseRef, 'origin/main');
  assert.equal(added.value.execution.modelSelection.model, 'gpt-6.1-sol');
  const first = run('queue', '--id', added.value.id);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(first.value.execution, added.value.execution);
  const edited = run('set', '--id', added.value.id, '--base-ref', 'release');
  assert.equal(edited.status, 0, edited.stderr);
  const second = run('queue', '--id', added.value.id);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.value.execution.baseRef, 'origin/main', 'an earlier queue keeps its snapshot');
  assert.equal(second.value.execution.baseRef, 'release');
  assert.equal(first.value.notBefore, '2026-12-01T02:00:00.000Z');
  assert.notEqual(first.value.requestId, second.value.requestId);
  assert.notEqual(run('queue', '--id', added.value.id, '--workspace', 'root').status, 0,
    'queue is not a second execution configuration editor');
  const root = run('set', '--id', added.value.id, '--workspace', 'root');
  assert.equal(root.status, 0, root.stderr);
  assert.equal(root.value.execution.workspace, 'root');
  assert.equal(root.value.execution.baseRef, undefined);
  const third = run('queue', '--id', added.value.id);
  assert.equal(third.value.execution.workspace, 'root');
  const listed = run('list');
  assert.equal(listed.value.tasks[0].executionRequests.length, 3);
  assert.equal(readFileSync(path.join(project, '.t3', 'tasks.json'), 'utf8').includes('Investigate'), true);
  assert.equal(run('show', '--id', added.value.id).value.id, added.value.id);
});
test('update status and reject invalid files without destroying data', t => {
  const { project, run } = fixture(t);
  const task = run('add', '--title', 'A', '--prompt', 'B').value;
  const reviewed = run('set', '--id', task.id, '--status', 'review').value;
  assert.equal(reviewed.status, 'review');
  assert.equal(reviewed.statusOverride, true);
  assert.equal(run('queue', '--id', task.id).value.execution.workspace, 'auto');
  assert.equal(run('show', '--id', task.id).value.statusOverride, false);
  assert.notEqual(run('set', '--id', task.id, '--status', 'invalid').status, 0);
  assert.notEqual(run('set', '--id', task.id, '--status', 'done').status, 0, 'agent skill must not bypass merge verification');
  const file = path.join(project, '.t3', 'tasks.json');
  writeFileSync(file, '{broken');
  assert.notEqual(run('add', '--title', 'C', '--prompt', 'D').status, 0);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});
