'use strict';
// Fixed, auditable Runner adapter. Executable downloads resolve to one GitHub
// commit per operation; no eval, generated shell programs or user-supplied URL.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const [verb, marker, encodedTarget] = process.argv.slice(1);
const root = path.join(os.homedir(), '.t3', 'companion');
const runnerRoot = path.join(root, 'runner');
const entry = path.join(runnerRoot, 'bin', 't3-runner.mjs');
const manifest = path.join(runnerRoot, 'install.json');
const files = [
  'runner/bin/t3-runner.mjs',
  'runner/src/cli.ts',
  'runner/src/runner.ts',
  'runner/src/storage.ts',
];
// Release channel: resolve main to one immutable SHA before fetching all files.
const REPOSITORY = 'truong51972/t3-companion';
const SOURCE_REF = 'main';

function run(command, arg) {
  const child = spawnSync(process.execPath, [entry, command, ...(arg === undefined ? [] : [arg])], {
    encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (child.error || child.status !== 0)
    throw new Error((child.error?.message || child.stderr || child.stdout || 'Runner CLI failed').trim().slice(-500));
  try { return JSON.parse(child.stdout.trim()); }
  catch { throw new Error('Invalid Runner CLI JSON output'); }
}
function installation() {
  try { return JSON.parse(fs.readFileSync(manifest, 'utf8')); }
  catch { return null; }
}
function state(extra = {}) {
  const installed = files.every(file => fs.existsSync(path.join(root, file)));
  return installed ? { ...run('status'), installed: true, version: installation()?.sha || null, ...extra }
    : { installed: false, running: false, pid: null, version: null, ...extra };
}
async function downloadAndInstall(force) {
  const installed = files.every(file => fs.existsSync(path.join(root, file)));
  const previous = installed ? run('status') : { running: false };
  const source = await fetch('https://api.github.com/repos/' + REPOSITORY + '/commits/' + SOURCE_REF,
    { headers: { 'Accept': 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!source.ok) throw new Error('Cannot resolve Runner release: HTTP ' + source.status);
  const sha = (await source.json()).sha;
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('Invalid Runner release SHA');
  if (!force && installed && installation()?.sha === sha) return state({ upToDate: true });
  await fsp.mkdir(root, { recursive: true });
  const staging = await fsp.mkdtemp(path.join(root, '.runner-update-'));
  const backups = [];
  const written = [];
  try {
    for (const file of files) {
      const response = await fetch('https://raw.githubusercontent.com/' + REPOSITORY + '/' + sha + '/' + file,
        { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Runner download failed: ' + file + ' (HTTP ' + response.status + ')');
      const target = path.join(staging, file);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, await response.text(), { mode: 0o600 });
    }
    if (previous.running) {
      run('stop');
      let stopped = false;
      for (let n = 0; n < 60; n++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!run('status').running) { stopped = true; break; }
      }
      if (!stopped) throw new Error('Runner is still draining work. Update was not applied; retry when it stops.');
    }
    try {
      for (const file of files) {
        const target = path.join(root, file);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) {
          const backup = path.join(staging, 'backup', file);
          await fsp.mkdir(path.dirname(backup), { recursive: true });
          await fsp.rename(target, backup);
          backups.push([backup, target]);
        }
        await fsp.rename(path.join(staging, file), target);
        written.push(target);
      }
      // Metadata must be written only after all executable files were replaced.
      const meta = manifest + '.' + process.pid + '.tmp';
      await fsp.writeFile(meta, JSON.stringify({ sha, installedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
      await fsp.rename(meta, manifest);
    } catch (error) {
      for (const target of written) await fsp.rm(target, { force: true });
      for (const [backup, target] of backups.reverse()) await fsp.rename(backup, target);
      throw error;
    }
    if (previous.running) run('start');
    return state({ updated: true });
  } catch (error) {
    // If the download or replacement failed after a graceful stop, restart
    // the intact old Runner whenever it is safe to do so.
    if (previous.running && files.every(file => fs.existsSync(path.join(root, file)))) {
      try { if (!run('status').running) run('start'); } catch { /* preserve original failure */ }
    }
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid completion marker');
  if (!['install','update','reinstall','status','start','stop','add','remove'].includes(verb))
    throw new Error('Unknown Runner operation');
  if (verb === 'install' || verb === 'update' || verb === 'reinstall') {
    const result = await downloadAndInstall(verb === 'reinstall' || verb === 'install');
    if (!result.running && verb === 'install') {
      try { run('start'); } catch (error) { if (!/already running/i.test(String(error))) throw error; }
      return state();
    }
    return result;
  }
  if (!files.every(file => fs.existsSync(path.join(root, file)))) return state();
  if (verb === 'start') {
    if (!run('status').running) {
      try { run('start'); } catch (error) { if (!/already running/i.test(String(error))) throw error; }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const current = state();
    return { ...current, ...(!current.running ? { starting: true } : {}) };
  }
  if (verb === 'stop') {
    const response = run('stop');
    return state({ stopRequested: response.requested });
  }
  if (verb === 'add' || verb === 'remove') {
    if (!encodedTarget || !/^[A-Za-z0-9_-]+$/.test(encodedTarget)) throw new Error('Project path required');
    const target = Buffer.from(encodedTarget, 'base64url').toString('utf8');
    if (!target) throw new Error('Project path required');
    return state({ projects: run(verb, target) });
  }
  return state();
}
main().then(value => {
  process.stdout.write('T3_COMPANION_RESULT:' + JSON.stringify(value) + '\n' + marker + ':0\n');
}).catch(error => {
  process.stdout.write('T3_COMPANION_ERROR:' + String(error.message || error).slice(-500) + '\n' + marker + ':1\n');
  process.exitCode = 1;
});
