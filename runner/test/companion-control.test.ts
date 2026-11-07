import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
    for (const file of ['cli.ts', 'runner.ts', 'storage.ts', 'workflow.ts']) writeFileSync(path.join(root, 'src', file), '');
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
  return { run, installStub };
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
