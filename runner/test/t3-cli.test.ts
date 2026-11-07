import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findT3Cli, requireT3Cli } from '../src/t3-cli.ts';

async function sandbox(t: any) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-t3-cli-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}
async function binary(file: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'T3 mock executable', { mode: 0o755 });
  await fs.chmod(file, 0o755);
}

test('finds official ~/.local/bin/t3 when a detached process lacks it in PATH', async t => {
  const home = await sandbox(t);
  const cli = path.join(home, '.local', 'bin', process.platform === 'win32' ? 't3.exe' : 't3');
  await binary(cli);
  const resolved = await findT3Cli({ home, env: { PATH: '' } });
  assert.deepEqual(resolved, { available: true, command: cli, source: 'local-install' });
  assert.equal(await requireT3Cli({ home, env: { PATH: '' } }), cli);
});

test('uses PATH before local installer and accepts explicit absolute executable overrides', async t => {
  const home = await sandbox(t);
  const local = path.join(home, '.local', 'bin', process.platform === 'win32' ? 't3.exe' : 't3');
  const preferred = path.join(home, 'bin', process.platform === 'win32' ? 't3.exe' : 't3');
  await binary(local); await binary(preferred);
  const env = { PATH: path.dirname(preferred) };
  assert.deepEqual(await findT3Cli({ home, env }), {
    available: true, command: preferred, source: 'path',
  });
  assert.deepEqual(await findT3Cli({ home, env: { ...env, T3_COMPANION_T3_BIN: local } }), {
    available: true, command: local, source: 'override',
  });
});

test('bad explicit override never falls back silently to a different executable', async t => {
  const home = await sandbox(t);
  const local = path.join(home, '.local', 'bin', process.platform === 'win32' ? 't3.exe' : 't3');
  await binary(local);
  const result = await findT3Cli({ home, env: { PATH: '', T3_COMPANION_T3_BIN: './t3' } });
  assert.equal(result.available, false);
  assert.match(result.message || '', /absolute executable path/);
});

test('missing T3 CLI provides actionable error instead of spawn ENOENT', async t => {
  const home = await sandbox(t);
  const options = { home, env: { PATH: '' } };
  assert.equal((await findT3Cli(options)).available, false);
  await assert.rejects(requireT3Cli(options), /T3 CLI not found.*Install T3 Code CLI/);
});

test('CLI preflight refuses to claim any task if T3 executable is missing', async t => {
  const home = await sandbox(t);
  const runnerHome = path.join(home, 'runner');
  const cli = new URL('../src/cli.ts', import.meta.url);
  const child = spawnSync(process.execPath,
    ['--experimental-strip-types', cli.pathname, 'run', '--once'], {
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '',
        T3_COMPANION_HOME: runnerHome, T3_COMPANION_T3_BIN: '' },
      encoding: 'utf8', timeout: 10000,
    });
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /T3 CLI not found/);
  await assert.rejects(fs.stat(path.join(runnerHome, 'runner.lock')), { code: 'ENOENT' });
});
