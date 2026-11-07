import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readableTerminalText, runnerShellCommand, terminalSubmit,
  RUNNER_REPOSITORY, RUNNER_CHECKOUT } from './runner-shell.ts';

const MARKER = 'COMPANION_' + 'a'.repeat(32);

test('install is a plain git clone, not a remote JavaScript downloader', () => {
  const command = runnerShellCommand('install', undefined, MARKER);
  assert.ok(command.startsWith('git clone ' + RUNNER_REPOSITORY + ' ' + RUNNER_CHECKOUT));
  assert.ok(command.includes(' && node ~/.t3/t3-companion/runner/bin/companion-control.cjs install '),
    'the installed controller starts only after a successful clone');
  assert.ok(command.endsWith(' || echo ' + MARKER + ':1'));
  assert.doesNotMatch(command, /node -e|raw\.githubusercontent|fetch\(|curl |wget |git reset|eval\(/);
});

test('updates and repairs use fast-forward-only git pull', () => {
  for (const verb of ['update', 'reinstall'] as const) {
    const command = runnerShellCommand(verb, undefined, MARKER);
    assert.ok(command.startsWith('git -C ' + RUNNER_CHECKOUT + ' pull --ff-only && '));
    assert.ok(command.endsWith(' || echo ' + MARKER + ':1'));
    assert.doesNotMatch(command, /git reset|download|raw\.githubusercontent|force|fetch\(/);
  }
});

test('routine operations call a local Git checkout with short Node resolver', () => {
  const command = runnerShellCommand('start', undefined, MARKER);
  assert.ok(command.startsWith('node -e "'));
  assert.ok(command.includes("'t3-companion','runner','bin','companion-control.cjs'"));
  assert.ok(command.length < 500);
  assert.doesNotMatch(command, /raw\.githubusercontent|Buffer\.from|git clone|git pull/);
});

test('project paths are encoded as inert data, never interpolated into a shell', () => {
  const target = "/projects/ümlaut 'repo' $(touch /tmp/pwn) & whoami";
  for (const verb of ['add', 'remove', 'inspect'] as const) {
    const command = runnerShellCommand(verb, target, MARKER);
    assert.ok(!command.includes(target));
    assert.ok(!command.includes('whoami'));
    assert.equal(Buffer.from(command.split(' ').at(-1)!, 'base64url').toString('utf8'), target);
  }
  assert.throws(() => runnerShellCommand('inspect', undefined, MARKER), /Project path required/);
});

test('validation prevents shell injection in marker and concurrency', () => {
  assert.throws(() => runnerShellCommand('start', undefined, 'bad; exit 0'), /marker/);
  assert.throws(() => runnerShellCommand('configure', '5', MARKER), /Max concurrent/);
  assert.ok(runnerShellCommand('configure', '3', MARKER).includes(' -- companion configure '));
});

test('uninstalled status is read-only and reports no Runner', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'companion-status-'));
  try {
    const command = runnerShellCommand('status', undefined, MARKER);
    const source = command.slice('node -e "'.length).split('" -- ')[0];
    const child = spawnSync(process.execPath, ['-e', source, '--', 'companion', 'status', MARKER],
      { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const marker = child.stdout.match(/T3_COMPANION_RESULT:(\{[^\r\n]+\})/);
    assert.ok(marker, child.stdout);
    assert.deepEqual(JSON.parse(marker[1]), {
      installed: false, running: false, pid: null, version: null, bridgeMissing: false, upgradeRequired: false,
    });
    assert.ok(child.stdout.includes(MARKER + ':0'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('legacy file-copy install is recognized for a one-time Git migration', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'companion-legacy-'));
  try {
    const legacy = path.join(home, '.t3', 'companion', 'runner', 'bin', 't3-runner.mjs');
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, '');
    const command = runnerShellCommand('status', undefined, MARKER);
    const source = command.slice('node -e "'.length).split('" -- ')[0];
    const child = spawnSync(process.execPath, ['-e', source, '--', 'companion', 'status', MARKER],
      { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /"installed":true/);
    assert.match(child.stdout, /"bridgeMissing":true/);
    assert.match(child.stdout, /"upgradeRequired":true/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('missing controller fails clearly instead of a T3 RPC timeout', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'companion-missing-'));
  try {
    const command = runnerShellCommand('start', undefined, MARKER);
    const source = command.slice('node -e "'.length).split('" -- ')[0];
    const child = spawnSync(process.execPath, ['-e', source, '--', 'companion', 'start', MARKER],
      { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.match(child.stdout, /T3_COMPANION_ERROR/);
    assert.ok(child.stdout.includes(MARKER + ':1'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('command wrapping works with POSIX sh and Windows PowerShell', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'companion-shell-'));
  try {
    const command = runnerShellCommand('status', undefined, MARKER);
    const child = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
        { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 10000 })
      : spawnSync('sh', ['-c', command], { env: { ...process.env, HOME: home },
        encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /T3_COMPANION_RESULT:/);
    assert.ok(child.stdout.includes(MARKER + ':0'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('PTY submit and terminal output normalization retain response markers', () => {
  const command = runnerShellCommand('status', undefined, MARKER);
  assert.equal(terminalSubmit(command), command + '\r');
  const raw = '\u001b]2;title\u0007\u001b[1mT3_COMPANION_RESULT:{"running":true}\r\n' +
    MARKER + ':0\r\n\u001b[0m';
  assert.equal(readableTerminalText(raw), 'T3_COMPANION_RESULT:{"running":true}\n' + MARKER + ':0');
});

test('Windows Git operations use a PowerShell-safe home path, not native tilde', () => {
  const install = runnerShellCommand('install', undefined, MARKER, 'windows');
  const update = runnerShellCommand('update', undefined, MARKER, 'windows');
  assert.ok(install.startsWith('git clone ' + RUNNER_REPOSITORY + ' "$HOME/.t3/t3-companion"'));
  assert.ok(update.startsWith('git -C "$HOME/.t3/t3-companion" pull --ff-only'));
  for (const cmd of [install, update]) {
    assert.ok(cmd.includes('if ($LASTEXITCODE -eq 0)'));
    assert.ok(!cmd.includes(' && '));
    assert.ok(!cmd.includes(' || '));
    assert.ok(cmd.includes('Write-Output "' + MARKER + ':1"'));
    assert.ok(cmd.includes('node "$HOME/.t3/t3-companion/runner/bin/companion-control.cjs"'));
  }
});
