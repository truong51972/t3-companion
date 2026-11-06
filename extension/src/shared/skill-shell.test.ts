import test from 'node:test';
import assert from 'node:assert/strict';
import { skillInstallShellCommand, SKILL_PATHS } from './skill-shell.ts';

const marker = 'COMPANION_' + 'a'.repeat(32);
test('skill detection lists project-scoped agent locations', () => {
  assert.ok(SKILL_PATHS.includes('.agents/skills/t3-companion/SKILL.md'));
  assert.ok(SKILL_PATHS.includes('.claude/skills/t3-companion/SKILL.md'));
});
test('installer runs npx in the requested project without shell path interpolation', () => {
  const project = '/tmp/hello; touch /tmp/evil';
  const encoded = skillInstallShellCommand(project, marker).match(/Buffer\.from\('([^']+)'/);
  assert.ok(encoded);
  const code = Buffer.from(encoded[1], 'base64').toString('utf8');
  assert.ok(code.includes(JSON.stringify(project)));
  assert.match(code, /'skills', 'add'/);
  assert.match(code, /'--skill', 't3-companion'/);
  assert.ok(!skillInstallShellCommand(project, marker).includes(project));
});
test('invalid marker is rejected', () => {
  assert.throws(() => skillInstallShellCommand('.', 'bad'), /marker/);
});
