import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, defaultPreferences, parseCache, parsePreferences, scopeKey } from './preferences.ts';

test('preferences recover safely from missing or malformed browser data', () => {
  assert.deepEqual(parsePreferences(null), defaultPreferences());
  const restored = parsePreferences({
    page: 'overview',
    manualEnvironmentId: 'remote-1',
    projectByEnvironment: { 'remote-1': 'project-2', invalid: 5 },
    workspaceByProject: {
      'remote-1:/repo': { mode: 'auto', baseRef: 'develop' },
      broken: { mode: 'invalid', baseRef: 'main' },
    },
    expandedLanes: { todo: false, review: true, done: true },
  });
  assert.equal(restored.page, 'overview');
  assert.equal(restored.manualEnvironmentId, 'remote-1');
  assert.equal(restored.projectByEnvironment['remote-1'], 'project-2');
  assert.equal('invalid' in restored.projectByEnvironment, false);
  assert.equal(restored.workspaceByProject['remote-1:/repo'].baseRef, 'develop');
  assert.equal('broken' in restored.workspaceByProject, false);
  assert.equal(restored.expandedLanes.todo, false);
  assert.equal(restored.expandedLanes.in_progress, true);
});
test('workspace and cache keys are environment/project-scoped', () => {
  assert.notEqual(scopeKey('env-a', '/repo'), scopeKey('env-b', '/repo'));
  assert.notEqual(cacheKey('skill', 'env-a', '/repo'), cacheKey('runner', 'env-a', '/repo'));
  assert.notEqual(cacheKey('skill', 'env-a', '/repo'), cacheKey('skill', 'env-b', '/repo'));
});
test('cached statuses are hints with validated timestamps', () => {
  const check = (v: unknown): v is string => v === 'installed';
  const good = { value: 'installed', verifiedAt: Date.now() - 4000 };
  assert.deepEqual(parseCache(good, check), good);
  assert.equal(parseCache({ ...good, value: 'failed' }, check), null);
  assert.equal(parseCache({ ...good, verifiedAt: Date.now() + 120000 }, check), null);
  assert.equal(parseCache({ value: 'installed' }, check), null);
});
