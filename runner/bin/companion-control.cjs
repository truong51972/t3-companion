'use strict';
// Fixed, auditable Runner adapter invoked by T3 Companion's terminal transport.
// Installed once at ~/.t3/companion/runner-control.cjs; no eval or generated programs.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const [verb, marker, encodedTarget] = process.argv.slice(1);
const root = path.join(os.homedir(), '.t3', 'companion');
const entry = path.join(root, 'runner', 'bin', 't3-runner.mjs');
const files = [
  'runner/bin/t3-runner.mjs',
  'runner/src/cli.ts',
  'runner/src/runner.ts',
  'runner/src/storage.ts',
];
const SOURCE_REF = '5ae13b7b08e78668dfc5ffb290fc958cc00c6bf8';

function run(command, arg) {
  const args = [entry, command, ...(arg === undefined ? [] : [arg])];
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    throw new Error((child.error?.message || child.stderr || child.stdout || 'Runner CLI failed').trim().slice(-500));
  }
  try { return JSON.parse(child.stdout.trim()); }
  catch { throw new Error('Invalid Runner CLI JSON output'); }
}

async function installRunner() {
  const base = 'https://raw.githubusercontent.com/truong51972/t3-companion/' + SOURCE_REF + '/';
  const contents = await Promise.all(files.map(async file => {
    const response = await fetch(base + file, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Runner download failed: ' + file + ' (HTTP ' + response.status + ')');
    return [file, await response.text()];
  }));
  for (const [file, data] of contents) {
    const destination = path.join(root, file);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temp = destination + '.' + process.pid + '.tmp';
    try {
      await fsp.writeFile(temp, data, { flag: 'wx', mode: 0o600 });
      await fsp.rename(temp, destination);
    } finally { await fsp.rm(temp, { force: true }); }
  }
}

async function main() {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid completion marker');
  if (!['install', 'status', 'start', 'stop', 'add', 'remove'].includes(verb)) throw new Error('Unknown Runner operation');
  let installed = files.every(file => fs.existsSync(path.join(root, file)));
  if (verb === 'install' && !installed) {
    await installRunner();
    installed = true;
  }
  if (!installed) return { installed: false, running: false, pid: null };
  if (verb === 'install' || verb === 'start') {
    const before = run('status');
    if (!before.running) {
      try { run('start'); }
      catch (error) {
        if (!/already running/i.test(String(error))) throw error;
      }
      // One bounded readiness check, not repeated terminal polling or CLI spawning.
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const current = run('status');
    return { ...current, installed: true, ...(!current.running ? { starting: true } : {}) };
  }
  if (verb === 'stop') {
    const response = run('stop');
    return { ...run('status'), installed: true, stopRequested: response.requested };
  }
  if (verb === 'add' || verb === 'remove') {
    if (!encodedTarget || !/^[A-Za-z0-9_-]+$/.test(encodedTarget)) throw new Error('Project path required');
    const target = Buffer.from(encodedTarget, 'base64url').toString('utf8');
    if (!target) throw new Error('Project path required');
    const projects = run(verb, target);
    return { ...run('status'), installed: true, projects };
  }
  return { ...run('status'), installed: true };
}

main().then(value => {
  process.stdout.write('T3_COMPANION_RESULT:' + JSON.stringify(value) + '\n' + marker + ':0\n');
}).catch(error => {
  process.stdout.write('T3_COMPANION_ERROR:' + String(error.message || error).slice(-500) + '\n' + marker + ':1\n');
  process.exitCode = 1;
});
