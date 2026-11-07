import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const bridge = readFileSync(new URL('../bridge/t3-bridge.ts', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../sidepanel/components/Modals/TaskEditorModal.tsx', import.meta.url), 'utf8');
const runnerShell = readFileSync(new URL('./runner-shell.ts', import.meta.url), 'utf8');

test('T3 native discovery is read-only, environment scoped, and model exploration is explicit', () => {
  assert.match(bridge, /'vcs.listRefs', 'server.getConfig'/);
  assert.match(bridge, /'vcs.listRefs',\s*\{ cwd, limit: 200/);
  assert.match(bridge, /'server.getConfig', \{\}/);
  assert.match(editor, /onExploreModels\(\)/);
  assert.match(editor, /Explore models/);
  assert.match(editor, /More ···/);
  assert.match(editor, /onExploreRefs\(\)/);
});

test('worktree inspection passes inert project paths to a bundled Runner adapter', () => {
  assert.match(runnerShell, /'inspect'/);
  assert.match(runnerShell, /encodeTarget\(target\)/);
  assert.match(editor, /onExploreWorktrees\(\)/);
  assert.match(editor, /Read-only explorer/);
});
