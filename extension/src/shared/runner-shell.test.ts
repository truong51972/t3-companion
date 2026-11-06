import assert from 'node:assert/strict';
import test from 'node:test';
import { readableTerminalText, runnerShellCommand } from './runner-shell.ts';

test('prefers the user-level runner clone while preserving global CLI fallback', () => {
  const cmd = runnerShellCommand('status');
  assert.match(cmd, /node "\$HOME\/\.t3\/companion\/runner\/bin\/t3-runner\.mjs" status/);
  assert.match(cmd, /command -v t3-runner/);
  assert.match(cmd, /T3_COMPANION_RUNNER_NOT_INSTALLED/);
});

test('quotes project paths as shell data, not commands', () => {
  const cmd = runnerShellCommand('add', "/home/user/projects/my 'repo' $(touch /tmp/pwn)");
  assert.match(cmd, /'my '\\''repo'\\''/);
  assert.equal((cmd.match(/\$\(touch /g) || []).length, 2);
  assert.ok(cmd.includes("'$(touch /tmp/pwn)'"));
});

test('strips noisy PTY control sequences from runner output', () => {
  const raw = '\u001b]2;some-title\u0007\u001b[1m{"running":true}\u001b[0m\u0007';
  assert.equal(readableTerminalText(raw), '{"running":true}');
});
