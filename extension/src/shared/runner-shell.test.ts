import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readableTerminalText, runnerShellCommand, RUNNER_SOURCE_REF } from './runner-shell.ts';

const MARKER = 'COMPANION_' + 'a'.repeat(32);
function decode(command: string): string {
  const match = /Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)/.exec(command);
  assert.ok(match, 'command must contain a portable base64 Node payload');
  return Buffer.from(match[1], 'base64').toString('utf8');
}

test('uses only Node and no POSIX or PowerShell-specific syntax', () => {
  const command = runnerShellCommand('status', undefined, MARKER);
  assert.ok(command.startsWith('node -e "eval(Buffer.from('));
  assert.doesNotMatch(command, /\$HOME|printf|command -v|; fi|&&|git clone/);
  const payload = decode(command);
  assert.match(payload, /node:child_process/);
  assert.match(payload, /T3_COMPANION_RESULT/);
  assert.match(payload, /runner\/bin\/t3-runner.mjs/);
  assert.match(payload, new RegExp(RUNNER_SOURCE_REF));
});

test('quotes hostile project names as JSON inside the encoded payload', () => {
  const target = "/projects/my 'repo' $(touch /tmp/pwn) & whoami";
  const command = runnerShellCommand('add', target, MARKER);
  assert.ok(!command.includes(target), 'path must never appear in the shell text');
  const payload = decode(command);
  assert.ok(payload.includes(JSON.stringify(target)));
  assert.ok(!command.includes('whoami'));
});

test('uninstalled Runner status can execute using just Node without npm/git', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'companion-portable-'));
  try {
    const program = decode(runnerShellCommand('status', undefined, MARKER));
    const child = spawnSync(process.execPath, ['-e', program], {
      env: { ...process.env, HOME: temp, USERPROFILE: temp }, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.match(/T3_COMPANION_RESULT:(\{[^\r\n]+\})/);
    assert.ok(line, child.stdout);
    assert.deepEqual(JSON.parse(line[1]), { installed: false, running: false, pid: null });
    assert.ok(child.stdout.includes(MARKER + ':0'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('runner installation is pinned and only downloads the four required source files', () => {
  const payload = decode(runnerShellCommand('install', undefined, MARKER));
  assert.ok(payload.includes('https://raw.githubusercontent.com/truong51972/t3-companion/'));
  assert.ok(payload.includes(RUNNER_SOURCE_REF));
  assert.equal((payload.match(/'runner\/(?:bin|src)\//g) || []).length, 4);
});

test('rejects invalid command marker', () => {
  assert.throws(() => runnerShellCommand('status', undefined, 'bad'), /marker/);
});

test('strips noisy PTY control sequences from runner output', () => {
  const raw = '\u001b]2;some-title\u0007\u001b[1m{"running":true}\u001b[0m\u0007';
  assert.equal(readableTerminalText(raw), '{"running":true}');
});
