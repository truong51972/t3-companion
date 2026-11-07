import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { inspectGitProject, RUNNER_CAPABILITIES } from '../src/adapters.ts';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10000 }).trim();
}

test('built-in Git adapter lists refs and all worktrees without executing a shell', async t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 't3-companion-git-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo with spaces');
  mkdirSync(project);
  git(project, 'init');
  git(project, 'config', 'user.email', 'test@example.invalid');
  git(project, 'config', 'user.name', 'Companion Test');
  writeFileSync(path.join(project, 'README.md'), 'example');
  git(project, 'add', 'README.md');
  git(project, 'commit', '-m', 'initial');
  git(project, 'branch', 'feature/testing');
  const linked = path.join(home, 'linked-tree');
  git(project, 'worktree', 'add', '-b', 'worktree-testing', linked);
  const result = await inspectGitProject(project);
  assert.equal(result.isGit, true);
  assert.ok(result.refs.includes('feature/testing'));
  const canonical = (value: string) => realpathSync.native(value).toLowerCase();
  assert.ok(result.worktrees.some(item => canonical(item.path) === canonical(linked) && item.branch === 'worktree-testing'),
    JSON.stringify({ linked, worktrees: result.worktrees }));
  assert.ok(result.worktrees.some(item => canonical(item.path) === canonical(project)));
  assert.equal(RUNNER_CAPABILITIES.existingWorktreeDispatch, false);
});

test('non-Git projects report no refs or worktrees, without guessing main', async t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 't3-companion-no-git-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = await inspectGitProject(home);
  assert.equal(result.isGit, false);
  assert.equal(result.defaultBranch, null);
  assert.deepEqual(result.worktrees, []);
  assert.deepEqual(result.refs, []);
});
