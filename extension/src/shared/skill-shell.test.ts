import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { skillInstallShellCommand, SKILL_PATH } from './skill-shell.ts';

const marker = 'COMPANION_' + 'a'.repeat(32);

test('skill detection uses the canonical project installation', () => {
  assert.equal(SKILL_PATH, '.agents/skills/t3-companion/SKILL.md');
});

test('skill installer keeps project path out of shell code', () => {
  const project = '/tmp/a b/ümlaut; touch /tmp/evil';
  const command = skillInstallShellCommand(project, marker);
  assert.match(command, /^node -e "/);
  assert.ok(command.includes("'skills','add'"));
  assert.ok(command.includes("'--skill','t3-companion'"));
  assert.ok(!command.includes(project));
  assert.ok(!command.includes('touch /tmp/evil'));
  assert.equal(Buffer.from(command.split(' ').at(-2)!, 'base64url').toString('utf8'), project);
  assert.equal(command.split(' ').at(-1), 'install');
  assert.doesNotMatch(command, /eval\(|base64.*toString\('utf8'\).*eval/);
});

test('invalid project path returns a structured terminal error without invoking npx', () => {
  const command = skillInstallShellCommand('/definitely/not/a/project/for/t3-companion', marker);
  const script = command.slice('node -e "'.length).split('" -- ')[0];
  const encodedPath = command.split(' ').at(-2)!;
  const child = spawnSync(process.execPath, ['-e', script, '--', marker, encodedPath, 'install'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stdout, /T3_COMPANION_ERROR:/);
  assert.ok(child.stdout.includes(marker + ':1'));
});

test('invalid marker and blank project are rejected', () => {
  assert.throws(() => skillInstallShellCommand('.', 'bad'), /marker/);
  assert.throws(() => skillInstallShellCommand('', marker), /Project path required/);
});
