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
test('skill add is a backlog-only operation; queue adds distinct requests', t => {
  const { project, run } = fixture(t);
  const added = run('add', '--title', 'Investigate', '--prompt', 'Inspect failures');
  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.value.status, 'todo');
  assert.equal(added.value.executionRequests, undefined);
  const first = run('queue', '--id', added.value.id);
  const second = run('queue', '--id', added.value.id, '--worktree', 'main');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(first.value.requestId, second.value.requestId);
  const listed = run('list');
  assert.equal(listed.value.tasks[0].executionRequests.length, 2);
  assert.equal(listed.value.tasks[0].status, 'todo');
  assert.equal(readFileSync(path.join(project, '.t3', 'tasks.json'), 'utf8').includes('Investigate'), true);
  assert.equal(run('show', '--id', added.value.id).value.id, added.value.id);
});
test('update status and reject invalid files without destroying data', t => {
  const { project, run } = fixture(t);
  const task = run('add', '--title', 'A', '--prompt', 'B').value;
  assert.equal(run('set', '--id', task.id, '--status', 'review').value.status, 'review');
  assert.notEqual(run('set', '--id', task.id, '--status', 'invalid').status, 0);
  const file = path.join(project, '.t3', 'tasks.json');
  writeFileSync(file, '{broken');
  assert.notEqual(run('add', '--title', 'C', '--prompt', 'D').status, 0);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});
