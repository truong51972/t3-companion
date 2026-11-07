import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const control = path.resolve(import.meta.dirname, '../bin/companion-control.cjs');
const marker = 'COMPANION_' + 'b'.repeat(32);

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), 't3-control-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, RUNNER_TEST_STATE: path.join(home, 'state.txt') };
  const run = (verb, target) => {
    const args = ['-e', 'require(' + JSON.stringify(control) + ')', '--', verb, marker];
    if (target !== undefined) args.push(Buffer.from(target).toString('base64url'));
    const child = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 15000 });
    const match = child.stdout.match(/T3_COMPANION_RESULT:(\{[^\r\n]*\})/);
    return { ...child, result: match ? JSON.parse(match[1]) : null };
  };
  const installStub = () => {
    const root = path.join(home, '.t3', 'companion', 'runner');
    mkdirSync(path.join(root, 'bin'), { recursive: true });
    mkdirSync(path.join(root, 'src'), { recursive: true });
    for (const file of ['cli.ts', 'runner.ts', 'storage.ts', 'workflow.ts', 't3-cli.ts']) writeFileSync(path.join(root, 'src', file), '');
    writeFileSync(path.join(root, 'bin', 't3-runner.mjs'), `
      import fs from 'node:fs';
      const file=process.env.RUNNER_TEST_STATE,verb=process.argv[2];
      const running=fs.existsSync(file)&&fs.readFileSync(file,'utf8')==='1';
      if(verb==='status')console.log(JSON.stringify({running,pid:running?123:null}));
      else if(verb==='start'){fs.writeFileSync(file,'1');console.log(JSON.stringify({pid:123}))}
      else if(verb==='stop'){fs.writeFileSync(file,'0');console.log(JSON.stringify({requested:true}))}
      else if(verb==='add'||verb==='remove')console.log(JSON.stringify({verb,target:process.argv[3]}));
      else{console.error('invalid verb');process.exitCode=1}
    `);
  };
  return { run, installStub, home };
}

test('status does not install anything and returns a stable JSON envelope', t => {
  const { run } = fixture(t);
  const response = run('status');
  assert.equal(response.status, 0, response.stderr);
  assert.deepEqual(response.result, { installed: false, running: false, pid: null, version: null });
  assert.ok(response.stdout.includes(marker + ':0'));
});

test('start / stop and registered paths work without shell interpretation', t => {
  const { run, installStub } = fixture(t);
  installStub();
  const initially = run('status');
  assert.equal(initially.result.running, false);
  assert.equal(initially.result.version, null);
  const started = run('start');
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.result.running, true);
  const target = "/tmp/ümlaut & $(touch /tmp/evil) ' repo";
  const added = run('add', target);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.result.projects.target, target);
  const stopped = run('stop');
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(stopped.result.running, false);
  assert.equal(stopped.result.stopRequested, true);
});

test('unknown actions fail with an explicit marker', t => {
  const { run } = fixture(t);
  const response = run('oops');
  assert.equal(response.status, 1);
  assert.ok(response.stdout.includes('T3_COMPANION_ERROR:'));
  assert.ok(response.stdout.includes(marker + ':1'));
});

test('legacy four-file Runner remains installed and eligible for an upgrade', t => {
  const { run, installStub, home } = fixture(t);
  installStub();
  const pathToWorkflow = path.join(home, '.t3', 'companion', 'runner', 'src', 'workflow.ts');
  unlinkSync(pathToWorkflow);
  const status = run('status');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.result.installed, true);
  assert.equal(status.result.upgradeRequired, true);
});

test('installed Runner starts its real CLI status from the complete downloaded module set', t => {
  const { run, home } = fixture(t);
  const sha = 'e'.repeat(40);
  const repositoryRoot = path.resolve(import.meta.dirname, '../..');
  const script = [
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    'const sha=' + JSON.stringify(sha) + ';',
    'const root=' + JSON.stringify(repositoryRoot) + ';',
    'global.fetch=async url=>{',
    " const prefix='/'+sha+'/';",
    " const part=String(url).split(prefix)[1];",
    " if(!part)throw Error('Unexpected fetch '+url);",
    " return {ok:true,text:async()=>fs.readFileSync(path.join(root,part),'utf8')};",
    '};',
    'require(' + JSON.stringify(control) + ');',
  ].join('\n');
  const upgrade = () => {
    const child = spawnSync(process.execPath, ['-e', script, '--', 'update', marker, sha],
      { env: { ...process.env, HOME: home, USERPROFILE: home },
        encoding: 'utf8', timeout: 20000 });
    const match = child.stdout.match(/T3_COMPANION_RESULT:(\{[^\r\n]+\})/);
    assert.equal(child.status, 0, child.stderr + '\n' + child.stdout);
    assert.ok(match, child.stdout);
    return JSON.parse(match[1]);
  };

  const installed = upgrade();
  assert.equal(installed.installed, true);
  assert.equal(installed.updated, true);
  assert.equal(installed.upgradeRequired, false);
  assert.equal(installed.version, sha);
  for (const name of ['lock.ts', 'reconciler.ts', 'workflow.ts', 't3-cli.ts', 'adapters.ts'])
    assert.ok(existsSync(path.join(home, '.t3', 'companion', 'runner', 'src', name)),
      'Missing installed Runner dependency: ' + name);

  // Execute status in a *new process*, loading modules only from installed
  // files. Unit tests importing source checkout would not detect omissions.
  const status = run('status');
  assert.equal(status.status, 0, status.stderr + '\n' + status.stdout);
  assert.equal(status.result.installed, true);
  assert.equal(status.result.upgradeRequired, false);
  assert.deepEqual(status.result.settings, { maxConcurrent: 3, scanIntervalMs: 10000 });
  assert.ok(typeof status.result.cli?.available === 'boolean');
  assert.equal(JSON.parse(readFileSync(path.join(home, '.t3', 'companion', 'runner', 'install.json'), 'utf8')).sha, sha);

  // Simulate a machine that already installed the defective refactor payload
  // and is missing lock.ts. Both Status and Update must remain usable.
  unlinkSync(path.join(home, '.t3', 'companion', 'runner', 'src', 'lock.ts'));
  const damaged = run('status');
  assert.equal(damaged.status, 0, damaged.stderr + '\n' + damaged.stdout);
  assert.equal(damaged.result.installed, true);
  assert.equal(damaged.result.upgradeRequired, true);
  assert.equal(damaged.result.incompleteInstall, true);
  const repaired = upgrade();
  assert.equal(repaired.upgradeRequired, false);
  assert.equal(repaired.installed, true);
  assert.ok(existsSync(path.join(home, '.t3', 'companion', 'runner', 'src', 'lock.ts')));
  assert.equal(run('status').result.upgradeRequired, false);
});
