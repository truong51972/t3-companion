import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readableTerminalText, runnerShellCommand, terminalSubmit, CONTROL_SOURCE_REF, RUNNER_SOURCE_REF } from './runner-shell.ts';

const MARKER = 'COMPANION_' + 'a'.repeat(32);

test('ordinary commands use a fixed adapter rather than encoded JavaScript', () => {
  const command = runnerShellCommand('status', undefined, MARKER);
  assert.match(command, /^node -e "/);
  assert.ok(command.includes('runner-control.cjs'));
  assert.ok(command.includes(' -- status ' + MARKER));
  assert.doesNotMatch(command, /eval\(|Buffer\.from\(|base64.*toString|\$HOME|git clone/);
  assert.ok(command.length < 900, 'status must remain a compact command');
});

test('project arguments are inert base64url data, not executable shell source', () => {
  const target = "/projects/ümlaut 'repo' $(touch /tmp/pwn) & whoami";
  const command = runnerShellCommand('add', target, MARKER);
  assert.ok(!command.includes(target));
  assert.ok(!command.includes('whoami'));
  const encoded = command.split(' ').at(-1)!;
  assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), target);
  assert.throws(() => runnerShellCommand('add', undefined, MARKER), /Project path required/);
});

test('uninstalled Runner status is read-only and reports control setup required', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'companion-portable-'));
  try {
    const command = runnerShellCommand('status', undefined, MARKER);
    const child = spawnSync(process.execPath, ['-e', command.slice('node -e "'.length).split('" -- ')[0], '--', 'status', MARKER], {
      env: { ...process.env, HOME: temp, USERPROFILE: temp }, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.match(/T3_COMPANION_RESULT:(\{[^\r\n]+\})/);
    assert.ok(line, child.stdout);
    assert.deepEqual(JSON.parse(line[1]), { installed: false, running: false, pid: null, bridgeMissing: true });
    assert.ok(child.stdout.includes(MARKER + ':0'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('one-time installer fetches a fixed commit, not a moving branch', () => {
  const command = runnerShellCommand('install', undefined, MARKER);
  assert.match(command, /raw\.githubusercontent\.com/);
  assert.ok(command.includes(CONTROL_SOURCE_REF));
  assert.match(RUNNER_SOURCE_REF, /^[a-f0-9]{40}$/);
  assert.ok(command.includes('runner-control.cjs'));
  assert.doesNotMatch(command, /eval\(|Buffer\.from\(|base64/);
});

test('legacy Runner is detected as installed but requiring one-time control setup', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'companion-legacy-'));
  try {
    const entry = path.join(home, '.t3', 'companion', 'runner', 'bin', 't3-runner.mjs');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, '');
    const command = runnerShellCommand('status', undefined, MARKER);
    const script = command.slice('node -e "'.length).split('" -- ')[0];
    const child = spawnSync(process.execPath, ['-e', script, '--', 'status', MARKER], {
      env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /"installed":true/);
    assert.match(child.stdout, /"bridgeMissing":true/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('one-time bootstrap writes and invokes a fixed adapter without eval or external network in test', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'companion-bootstrap-'));
  try {
    const command = runnerShellCommand('install', undefined, MARKER);
    const script = command.slice('node -e "'.length).split('" -- ')[0];
    const adapter = "console.log('T3_COMPANION_RESULT:'+JSON.stringify({installed:true}));console.log(process.argv[2]+':0')";
    const mockedFetch = 'global.fetch=async()=>({ok:true,text:async()=>'+JSON.stringify(adapter)+'});';
    const child = spawnSync(process.execPath, ['-e', mockedFetch + script, '--', 'install', MARKER], {
      env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(child.stdout.includes(MARKER + ':0'));
    assert.ok(existsSync(path.join(home, '.t3', 'companion', 'runner-control.cjs')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('invalid marker is rejected', () => {
  assert.throws(() => runnerShellCommand('status', undefined, 'bad'), /marker/);
});

test('terminal submit uses CR (PTY Enter), not LF', () => {
  const command = runnerShellCommand('status', undefined, MARKER);
  assert.equal(terminalSubmit(command), command + '\r');
});

test('compact status executes through POSIX sh or Windows PowerShell', () => {
  const command = runnerShellCommand('status', undefined, MARKER);
  const temp = mkdtempSync(path.join(os.tmpdir(), 'companion-shell-'));
  try {
    const child = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          env: { ...process.env, HOME: temp, USERPROFILE: temp }, encoding: 'utf8', timeout: 45000,
        })
      : spawnSync('sh', ['-c', command], {
          env: { ...process.env, HOME: temp }, encoding: 'utf8', timeout: 15000,
        });
    assert.equal(child.status, 0, [child.error?.message, child.stderr, child.stdout].filter(Boolean).join('\n'));
    assert.ok(child.stdout.includes('T3_COMPANION_RESULT:'));
    assert.ok(child.stdout.includes(MARKER + ':0'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('strips PTY control sequences while preserving output line boundaries', () => {
  const raw = '\u001b]2;title\u0007\u001b[1mT3_COMPANION_RESULT:{"running":true}\r\n' + MARKER + ':0\r\n\u001b[0m';
  assert.equal(readableTerminalText(raw), 'T3_COMPANION_RESULT:{"running":true}\n' + MARKER + ':0');
});
