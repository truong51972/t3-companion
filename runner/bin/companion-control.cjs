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
  'runner/src/workflow.ts',
  'runner/src/t3-cli.ts',
  'runner/src/lock.ts',
  'runner/src/reconciler.ts',
  'runner/src/adapters.ts',
];
// Release channel: resolve main to one immutable SHA before fetching all files.
// The original four-file Runner is still a valid legacy install. New modules
// must be downloaded together, but must not cause pre-refactor installs to
// disappear from the UI before the user can upgrade them.
const coreFiles = [
  'runner/bin/t3-runner.mjs',
  'runner/src/cli.ts',
  'runner/src/runner.ts',
  'runner/src/storage.ts',
];
const fileExists = file => fs.existsSync(path.join(root, file));
const hasLegacyRunner = () => coreFiles.every(fileExists);
const hasCurrentRunner = () => files.every(fileExists);
const REPOSITORY = 'truong51972/t3-companion';
const DEFAULT_SOURCE_REF = 'main';

function run(command, ...args) {
  const child = spawnSync(process.execPath, [entry, command, ...args], {
    encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (child.error || child.status !== 0)
    throw new Error((child.error?.message || child.stderr || child.stdout || 'Runner CLI failed').trim().slice(-500));
  try { return JSON.parse(child.stdout.trim()); }
  catch { throw new Error('Invalid Runner CLI JSON output'); }
}
function isT3CliUnavailable(error) {
  return /T3 CLI not found|T3 CLI executable|T3_COMPANION_T3_BIN/i.test(String(error));
}
function isIncompleteInstall(error) {
  // Only recover from missing module imports; an arbitrary CLI failure must
  // not be treated as evidence that the Runner is stopped.
  return /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/i.test(String(error));
}
function runnerHome() {
  return path.resolve(process.env.T3_COMPANION_HOME ||
    path.join(process.env.T3CODE_HOME || path.join(os.homedir(), '.t3'), 'runner'));
}
function lockStatus() {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(runnerHome(), 'runner.lock', 'owner.json'), 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return { running: false, pid: null };
    try { process.kill(owner.pid, 0); return { running: true, pid: owner.pid }; }
    catch (error) {
      if (error.code === 'EPERM') return { running: true, pid: owner.pid };
      if (error.code === 'ESRCH') return { running: false, pid: null };
      throw error;
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { running: false, pid: null };
    // A corrupted lock must block update rather than overwrite live code.
    throw new Error('Cannot verify Runner lock for recovery: ' + String(error));
  }
}
function safeRunnerStatus() {
  try { return run('status'); }
  catch (error) {
    if (!isIncompleteInstall(error)) throw error;
    return { ...lockStatus(), incompleteInstall: true };
  }
}
function requestRunnerStop() {
  try { return run('stop'); }
  catch (error) {
    if (!isIncompleteInstall(error)) throw error;
    // The process may have started before the incomplete upgrade. It still
    // watches stop.json and must drain before any module is replaced.
    fs.mkdirSync(runnerHome(), { recursive: true });
    fs.writeFileSync(path.join(runnerHome(), 'stop.json'), JSON.stringify({ at: new Date().toISOString() }));
    return { requested: true };
  }
}
function installation() {
  try { return JSON.parse(fs.readFileSync(manifest, 'utf8')); }
  catch { return null; }
}
function state(extra = {}) {
  const installed = hasLegacyRunner();
  return installed ? { ...safeRunnerStatus(), installed: true, upgradeRequired: !hasCurrentRunner(), version: installation()?.sha || null, ...extra }
    : { installed: false, running: false, pid: null, version: null, ...extra };
}
async function downloadAndInstall(force, sourceRef = DEFAULT_SOURCE_REF) {
  if (sourceRef !== 'main' && !/^[0-9a-f]{40}$/.test(sourceRef))
    throw new Error('Invalid Runner release ref: expected main or a full commit SHA');
  const installed = hasCurrentRunner();
  const previous = hasLegacyRunner() ? safeRunnerStatus() : { running: false };
  const previousInstall = installation();
  // An immutable build SHA needs no unauthenticated GitHub API request.
  // Resolve "main" only for distributed source archives built without .git.
  let sha = sourceRef;
  if (sourceRef === 'main') {
    const source = await fetch('https://api.github.com/repos/' + REPOSITORY + '/commits/main',
      { headers: { 'Accept': 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!source.ok) throw new Error('Cannot resolve Runner release: HTTP ' + source.status);
    sha = (await source.json()).sha;
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('Invalid Runner release SHA');
  }
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
      requestRunnerStop();
      let stopped = false;
      for (let n = 0; n < 60; n++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!safeRunnerStatus().running) { stopped = true; break; }
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
    if (previous.running) {
      try { run('start'); }
      catch (restartError) {
        // The update is valid even if this host doesn't have T3 CLI installed.
        // Keep the new Runner so Overview can display the CLI diagnosis; let
        // the user install the prerequisite and start it explicitly.
        if (isT3CliUnavailable(restartError))
          return state({ updated: true, restarted: false, requiresCli: true });
        // Other failed restarts still trigger a complete rollback.
        // A failed restart is a failed upgrade. Restore the entire executable
        // set and its prior version marker before attempting to restart again.
        for (const target of written) await fsp.rm(target, { force: true });
        for (const [backup, target] of backups.reverse()) await fsp.rename(backup, target);
        if (previousInstall) {
          const temp = manifest + '.' + process.pid + '.rollback';
          await fsp.writeFile(temp, JSON.stringify(previousInstall) + '\n', { mode: 0o600 });
          await fsp.rename(temp, manifest);
        } else await fsp.rm(manifest, { force: true });
        try { run('start'); }
        catch { /* original failed update is more useful than a second error */ }
        throw new Error('Runner update rolled back after restart failed: ' + String(restartError));
      }
    }
    return state({ updated: true });
  } catch (error) {
    // If the download or replacement failed after a graceful stop, restart
    // the intact old Runner whenever it is safe to do so.
    if (previous.running && hasLegacyRunner()) {
      try { if (!safeRunnerStatus().running) run('start'); } catch { /* preserve original failure */ }
    }
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid completion marker');
  if (!['install','update','reinstall','status','start','stop','add','remove','configure'].includes(verb))
    throw new Error('Unknown Runner operation');
  if (verb === 'install' || verb === 'update' || verb === 'reinstall') {
    // For upgrades the optional third argument is the trusted release SHA
    // compiled into this extension; other commands retain encodedTarget semantics.
    const result = await downloadAndInstall(verb === 'reinstall' || verb === 'install',
      encodedTarget || DEFAULT_SOURCE_REF);
    if (!result.running && verb === 'install') {
      try { run('start'); }
      catch (error) {
        if (isT3CliUnavailable(error)) return state({ installed: true, requiresCli: true, restarted: false });
        if (!/already running/i.test(String(error))) throw error;
      }
      return state();
    }
    return result;
  }
  if (!hasLegacyRunner()) return state();
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
  if (verb === 'configure') {
    if (!encodedTarget || !/^[A-Za-z0-9_-]{1,16}$/.test(encodedTarget)) throw new Error('Invalid Runner setting');
    const value = Buffer.from(encodedTarget, 'base64url').toString('utf8');
    if (!/^[1-3]$/.test(value)) throw new Error('Max concurrent must be 1..3');
    run('config', 'set', value);
    return state();
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
