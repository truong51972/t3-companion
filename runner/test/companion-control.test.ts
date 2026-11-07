import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = 'COMPANION_' + 'b'.repeat(32);
function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10000 }).trim();
}
function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), 't3-companion-controller-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 't3-companion');
  const control = path.join(root, 'runner', 'bin', 'companion-control.cjs');
  const src = path.resolve(import.meta.dirname, '../bin/companion-control.cjs');
  mkdirSync(path.dirname(control), { recursive: true });
  mkdirSync(path.join(root, 'runner', 'src'), { recursive: true });
  copyFileSync(src, control);
  writeFileSync(path.join(root, '.gitignore'), '.data/\n');
  for (const name of ['cli.ts','runner.ts','storage.ts','workflow.ts',
    't3-cli.ts','lock.ts','reconciler.ts','adapters.ts'])
    writeFileSync(path.join(root, 'runner', 'src', name), '// bundled');
  const mock = `
import fs from 'node:fs';
const state = process.env.RUNNER_TEST_STATE, cmd = process.argv[2];
const running = fs.existsSync(state) && fs.readFileSync(state, 'utf8') === '1';
if (cmd === 'status')
  console.log(JSON.stringify({ running, pid: running ? 123 : null,
    settings: {maxConcurrent:3,scanIntervalMs:10000},cli:{available:true}}));
else if (cmd === 'start') { fs.writeFileSync(state, '1'); console.log(JSON.stringify({pid:123})); }
else if (cmd === 'stop') { fs.writeFileSync(state, '0'); console.log(JSON.stringify({requested:true})); }
else if (cmd === 'add'||cmd === 'remove'||cmd === 'inspect')
  console.log(JSON.stringify({cmd, target:process.argv[3]}));
else if (cmd === 'config') console.log(JSON.stringify({maxConcurrent:Number(process.argv[4])}));
else { console.error('Invalid command'); process.exitCode=1; }
`;
  writeFileSync(path.join(root, 'runner', 'bin', 't3-runner.mjs'), mock);
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Companion Test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/truong51972/t3-companion.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  const env = { ...process.env, HOME: home, USERPROFILE: home,
    RUNNER_TEST_STATE: path.join(home, 'runner-state.txt') };
  const run = (verb, target, marker = MARKER) => {
    const args = ['-e', 'require(' + JSON.stringify(control) + ')', '--', 'companion', verb, marker];
    if (target !== undefined) args.push(Buffer.from(target).toString('base64url'));
    const child = spawnSync(process.execPath, args, { env, encoding:'utf8', timeout: 15000 });
    const match = child.stdout.match(/T3_COMPANION_RESULT:(\{[^\r\n]+\})/);
    return { ...child, data: match ? JSON.parse(match[1]) : null };
  };
  return { run, root, env, home };
}

test('Git checkout controller reports version, origin and a clean tree', t => {
  const { run } = fixture(t);
  const status = run('status');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.data.installed, true);
  assert.equal(status.data.bridgeMissing, false);
  assert.equal(status.data.upgradeRequired, false);
  assert.equal(status.data.originTrusted, true);
  assert.equal(status.data.checkoutDirty, false);
  assert.match(status.data.version, /^[0-9a-f]{40}$/);
  assert.deepEqual(status.data.settings, {maxConcurrent:3,scanIntervalMs:10000});
});

test('start, stop and project arguments use the local controller without shell evaluation', t => {
  const { run } = fixture(t);
  const start = run('start');
  assert.equal(start.status, 0, start.stderr);
  assert.equal(start.data.running, true);
  const target = "/projects/ümlaut & $(touch /tmp/pwn) 'repo'";
  const added = run('add', target);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.data.projects.target, target);
  const inspect = run('inspect', target);
  assert.equal(inspect.status, 0, JSON.stringify({stdout:inspect.stdout,stderr:inspect.stderr,error:inspect.error?.message}));
  assert.ok(inspect.data, JSON.stringify({stdout:inspect.stdout,stderr:inspect.stderr,error:inspect.error?.message}));
  assert.equal(inspect.data.projectInspection.target, target);
  const stopped = run('stop');
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(stopped.data.stopRequested, true);
  assert.equal(stopped.data.running, false);
});

test('missing adapter module signals an incomplete Git checkout', t => {
  const { run, root } = fixture(t);
  unlinkSync(path.join(root, 'runner', 'src', 'adapters.ts'));
  const state = run('status');
  assert.equal(state.status, 0, state.stderr);
  assert.equal(state.data.upgradeRequired, true);
  assert.equal(state.data.checkoutDirty, true);
});

test('old Runner data migrates to .data/runner without moving transient files', t => {
  const { run, root, home } = fixture(t);
  const legacy = path.join(home, '.t3', 'runner');
  const current = path.join(root, '.data', 'runner');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(path.join(legacy, 'projects.json'), '{"projects":["/example/repo"]}\n');
  writeFileSync(path.join(legacy, 'config.json'), '{"maxConcurrent":2,"scanIntervalMs":10000}\n');
  writeFileSync(path.join(legacy, 'runner.log'), 'legacy log\n');
  writeFileSync(path.join(legacy, 'health.json'), '{"pid":123}\n');
  writeFileSync(path.join(legacy, 'stop.json'), '{"at":"old"}\n');
  const started = run('start');
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(readFileSync(path.join(current, 'projects.json'), 'utf8'), '{"projects":["/example/repo"]}\n');
  assert.equal(readFileSync(path.join(current, 'config.json'), 'utf8'), '{"maxConcurrent":2,"scanIntervalMs":10000}\n');
  assert.equal(readFileSync(path.join(current, 'runner.log'), 'utf8'), 'legacy log\n');
  assert.equal(readFileSync(path.join(legacy, 'projects.json'), 'utf8'), '{"projects":["/example/repo"]}\n');
  assert.equal(existsSync(path.join(current, 'stop.json')), false);
  assert.equal(existsSync(path.join(current, 'health.json')), false);
  assert.equal(existsSync(path.join(current, '.legacy-import.json')), true);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('migration refuses to overwrite conflicting existing Runner data', t => {
  const { run, root, home } = fixture(t);
  const legacy = path.join(home, '.t3', 'runner');
  const current = path.join(root, '.data', 'runner');
  mkdirSync(legacy, { recursive: true });
  mkdirSync(current, { recursive: true });
  writeFileSync(path.join(legacy, 'projects.json'), '{"projects":["/old"]}\n');
  writeFileSync(path.join(current, 'projects.json'), '{"projects":["/new"]}\n');
  const response = run('start');
  assert.equal(response.status, 1);
  assert.match(response.stdout, /Runner data conflict/);
  assert.equal(readFileSync(path.join(current, 'projects.json'), 'utf8'), '{"projects":["/new"]}\n');
  assert.equal(existsSync(path.join(current, '.legacy-import.json')), false);
});

test('unknown verbs and invalid markers are rejected', t => {
  const { run } = fixture(t);
  const unknown = run('download');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /Unknown Runner operation/);
  const marker = run('status', undefined, 'malformed');
  assert.equal(marker.status, 1);
  assert.match(marker.stdout, /Invalid completion marker/);
});
