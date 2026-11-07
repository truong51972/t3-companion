'use strict';
// Git-checkout local controller; durable Runner state lives under .data/runner.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const [verb,marker,encodedTarget]=process.argv.slice(2);
const checkout=path.resolve(__dirname,'..','..');
const entry=path.join(checkout,'runner','bin','t3-runner.mjs');
const home=path.resolve(process.env.T3_COMPANION_HOME||
  path.join(checkout,'.data','runner'));
const required=['runner/bin/t3-runner.mjs','runner/src/cli.ts','runner/src/runner.ts',
  'runner/src/storage.ts','runner/src/workflow.ts','runner/src/t3-cli.ts',
  'runner/src/lock.ts','runner/src/reconciler.ts','runner/src/adapters.ts'];
function run(command,...args){
  const child=spawnSync(process.execPath,[entry,command,...args],
    {encoding:'utf8',timeout:15000,maxBuffer:1048576,windowsHide:true});
  if(child.error||child.status!==0)throw Error(
    (child.error?.message||child.stderr||child.stdout||'Runner CLI failed').trim().slice(-500));
  try{return JSON.parse(child.stdout.trim())}catch{throw Error('Invalid Runner CLI JSON output')}
}
function git(...args){
  const child=spawnSync('git',['-C',checkout,...args],{encoding:'utf8',timeout:5000,windowsHide:true});
  return child.status===0?child.stdout.trim():null;
}
function lockStatus(root=home){
  try{
    const owner=JSON.parse(fs.readFileSync(path.join(root,'runner.lock','owner.json'),'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)return {running:false,pid:null};
    try{process.kill(owner.pid,0);return {running:true,pid:owner.pid}}
    catch(e){if(e.code==='EPERM')return {running:true,pid:owner.pid};
      if(e.code==='ESRCH')return {running:false,pid:null};throw e}
  }catch(e){if(e.code==='ENOENT')return {running:false,pid:null};
    throw Error('Cannot verify Runner lock: '+String(e))}
}
function state(extra={}){
  const installed=fs.existsSync(entry),complete=required.every(f=>fs.existsSync(path.join(checkout,f)));
  const version=git('rev-parse','HEAD'),origin=git('remote','get-url','origin');
  const trusted=/^(?:https:\/\/github\.com\/truong51972\/t3-companion(?:\.git)?|git@github\.com:truong51972\/t3-companion(?:\.git)?)$/i.test(origin||'');
  if(!installed)return {installed:false,...lockStatus(),version,upgradeRequired:true,...extra};
  let data;
  try{data=run('status')}catch(e){
    if(!/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/i.test(String(e)))throw e;
    data={...lockStatus(),incompleteInstall:true};
  }
  return {...data,installed:true,version,upgradeRequired:!complete||!version,
    checkoutDirty:git('status','--porcelain')!=='',originTrusted:trusted,...extra};
}
function target(){
  if(!encodedTarget||!/^[A-Za-z0-9_-]+$/.test(encodedTarget))throw Error('Invalid project argument');
  const decoded=Buffer.from(encodedTarget,'base64url').toString('utf8');
  if(!decoded)throw Error('Empty project argument');
  return decoded;
}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
function start(){
  if(lockStatus().running)return state();
  try{run('start')}catch(e){
    if(/T3 CLI not found|T3 CLI executable|T3_COMPANION_T3_BIN/i.test(String(e)))
      return state({requiresCli:true,restarted:false});
    if(!/already running/i.test(String(e)))throw e;
  }
  sleep(300);return state();
}
function main(){
  if(!/^COMPANION_[a-f0-9]{32}$/.test(marker))throw Error('Invalid completion marker');
  if(!['install','status','start','stop','add','remove','inspect','configure'].includes(verb))
    throw Error('Unknown Runner operation');
  if(verb==='install')return start();
  if(verb==='status')return state();
  if(verb==='start')return start();
  if(verb==='stop')return state({stopRequested:run('stop').requested});
  if(verb==='configure'){
    const value=target();if(!/^[1-3]$/.test(value))throw Error('Max concurrent must be 1..3');
    run('config','set',value);return state();
  }
  if(verb==='add'||verb==='remove')return state({projects:run(verb,target())});
  if(verb==='inspect')return state({projectInspection:run('inspect',target())});
}
try{process.stdout.write('T3_COMPANION_RESULT:'+JSON.stringify(main())+'\n'+marker+':0\n')}
catch(e){process.stdout.write('T3_COMPANION_ERROR:'+String(e.message||e).slice(-500)+'\n'+marker+':1\n');process.exitCode=1}
