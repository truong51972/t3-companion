import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', timeout: 10000 }).trim();
}

/** Offline E2E: actual git clone/pull into the same user-home layout used by Companion. */
test('Git checkout updates only code, preserving legacy files and durable Runner state', t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 't3-companion-git-install-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'upstream repo');
  const checkout = path.join(home, '.t3', 't3-companion');
  const stateFile = path.join(home, '.t3', 'runner', 'projects.json');
  const legacyFile = path.join(home, '.t3', 'companion', 'runner', 'bin', 't3-runner.mjs');
  mkdirSync(source, { recursive: true });
  mkdirSync(path.dirname(stateFile), { recursive: true });
  mkdirSync(path.dirname(legacyFile), { recursive: true });
  writeFileSync(stateFile, '{"projects":["/example/project"]}\n');
  writeFileSync(legacyFile, 'legacy binary');
  git('init', source);
  git('-C', source, 'config', 'user.email', 'test@example.invalid');
  git('-C', source, 'config', 'user.name', 'Companion Test');
  writeFileSync(path.join(source, 'README.md'), 'initial\n');
  git('-C', source, 'add', 'README.md');
  git('-C', source, 'commit', '-m', 'initial');
  git('clone', source, checkout);
  const v1 = git('-C', checkout, 'rev-parse', 'HEAD');
  assert.equal(v1, git('-C', source, 'rev-parse', 'HEAD'));
  assert.ok(existsSync(path.join(checkout, '.git')));
  writeFileSync(path.join(source, 'README.md'), 'updated\n');
  git('-C', source, 'add', 'README.md');
  git('-C', source, 'commit', '-m', 'next');
  git('-C', checkout, 'pull', '--ff-only');
  const v2 = git('-C', checkout, 'rev-parse', 'HEAD');
  assert.notEqual(v1, v2);
  assert.equal(v2, git('-C', source, 'rev-parse', 'HEAD'));
  assert.equal(readFileSync(path.join(checkout, 'README.md'), 'utf8'), 'updated\n');
  assert.equal(readFileSync(stateFile, 'utf8'), '{"projects":["/example/project"]}\n');
  assert.equal(readFileSync(legacyFile, 'utf8'), 'legacy binary');
});

/** A dirty checkout must not be silently reset, even if a new commit exists upstream. */
test('Git pull --ff-only refuses conflicting local edits without destroying state', t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 't3-companion-git-dirty-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'source');
  const checkout = path.join(home, '.t3', 't3-companion');
  mkdirSync(source, { recursive: true });
  git('init', source);
  git('-C', source, 'config', 'user.email', 'test@example.invalid');
  git('-C', source, 'config', 'user.name', 'Companion Test');
  writeFileSync(path.join(source, 'README.md'), 'old\n');
  git('-C', source, 'add', 'README.md');
  git('-C', source, 'commit', '-m', 'initial');
  git('clone', source, checkout);
  writeFileSync(path.join(checkout, 'README.md'), 'my local edits\n');
  writeFileSync(path.join(source, 'README.md'), 'new upstream\n');
  git('-C', source, 'add', 'README.md');
  git('-C', source, 'commit', '-m', 'new version');
  const before = git('-C', checkout, 'rev-parse', 'HEAD');
  const result = spawnSync('git', ['-C', checkout, 'pull', '--ff-only'], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.equal(git('-C', checkout, 'rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(path.join(checkout, 'README.md'), 'utf8'), 'my local edits\n');
});
