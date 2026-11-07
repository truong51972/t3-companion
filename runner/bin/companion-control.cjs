'use strict';
// Git-checkout local controller; durable Runner state lives under .data/runner.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const [verb,marker,encodedTarget]=process.argv.slice(2);
const checkout=path.resolve(__dirname,'..','..');
const entry=path.join(checkout,'runner','bin','t3-runner.mjs');
const legacyEntry=path.join(os.homedir(),'.t3','companion','runner','bin','t3-runner.mjs');
const previousCheckoutEntry=path.join(os.homedir(),'.t3','t3-companion','runner','bin','t3-runner.mjs');
const home=path.resolve(process.env.T3_COMPANION_HOME||
  path.join(checkout,'.data','runner'));
const legacyHome=path.resolve(path.join(process.env.T3CODE_HOME||
  path.join(os.homedir(),'.t3'),'runner'));
const importOld=!process.env.T3_COMPANION_HOME && legacyHome!==home;
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
  const old=importOld?lockStatus(legacyHome):{running:false,pid:null};
  return {...data,installed:true,bridgeMissing:false,version,upgradeRequired:!complete||!version,
    running:!!(data.running||old.running),pid:data.running?data.pid:old.pid,
    legacyRunnerRunning:old.running,
    migrationPending:importOld && fs.existsSync(legacyHome) &&
      !fs.existsSync(path.join(home,'.legacy-import.json')),
    checkoutDirty:git('status','--porcelain')!=='',originTrusted:trusted,...extra};
}
function target(){
  if(!encodedTarget||!/^[A-Za-z0-9_-]+$/.test(encodedTarget))throw Error('Invalid project argument');
  const decoded=Buffer.from(encodedTarget,'base64url').toString('utf8');
  if(!decoded)throw Error('Empty project argument');
  return decoded;
}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
function importLegacyData(){
  if(!importOld||!fs.existsSync(legacyHome))return;
  const marker=path.join(home,'.legacy-import.json');
  if(fs.existsSync(marker))return;
  if(lockStatus(legacyHome).running){
    fs.writeFileSync(path.join(legacyHome,'stop.json'),
      JSON.stringify({at:new Date().toISOString()}),{mode:0o600});
    throw Error('Previous Runner is draining work; retry Start after it stops');
  }
  // Import regular files only, skipping locks, signals and stale heartbeats.
  // Never overwrite a conflicting destination or remove the old state.
  const transient=new Set(['runner.lock','stop.json','health.json','.legacy-import.json']);
  function copyDirectory(from,to){
    fs.mkdirSync(to,{recursive:true,mode:0o700});
    for(const file of fs.readdirSync(from,{withFileTypes:true})){
      if(transient.has(file.name)||file.name.endsWith('.tmp'))continue;
      const source=path.join(from,file.name),destination=path.join(to,file.name);
      if(file.isDirectory()){copyDirectory(source,destination);continue}
      if(!file.isFile())continue;
      if(fs.existsSync(destination)){
        if(!fs.readFileSync(source).equals(fs.readFileSync(destination)))
          throw Error('Runner data conflict at '+destination+'; reconcile manually');
        continue;
      }
      fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination,0o600);
    }
  }
  copyDirectory(legacyHome,home);
  fs.writeFileSync(marker,JSON.stringify({source:legacyHome,importedAt:new Date().toISOString()}),
    {flag:'wx',mode:0o600});
}
function start(){
  // A legacy Runner may be running against the old data path.
  migrateLegacy();
  importLegacyData();
  if(lockStatus().running)return state();
  try{run('start')}catch(e){
    if(/T3 CLI not found|T3 CLI executable|T3_COMPANION_T3_BIN/i.test(String(e)))
      return state({requiresCli:true,restarted:false});
    if(!/already running/i.test(String(e)))throw e;
  }
  sleep(300);return state();
}
function migrateLegacy(){
  if(!lockStatus().running ||
    (!fs.existsSync(legacyEntry) && !fs.existsSync(previousCheckoutEntry)))return;
  // New workers carry their entry path in the lock. Old workers do not.
  // This prevents repeatedly draining the new worker when old code is retained.
  let owner;
  try { owner=JSON.parse(fs.readFileSync(path.join(home,'runner.lock','owner.json'),'utf8')); }
  catch(e) { throw Error('Cannot inspect active Runner before migration: '+String(e)); }
  if(typeof owner.entry==='string'){
    const current=path.resolve(owner.entry).toLowerCase();
    const installedRoot=(checkout+path.sep).toLowerCase();
    if(current.startsWith(installedRoot))return;
  }
  // Drains the old worker using the common ~/.t3/runner stop flag.
  run('stop');
  for(let i=0;i<60;i++){if(!lockStatus().running)return;sleep(500)}
  throw Error('Previous Runner is still draining tasks; retry after it stops');
}
function main(){
  if(!/^COMPANION_[a-f0-9]{32}$/.test(marker))throw Error('Invalid completion marker');
  if(!['install','status','start','stop','add','remove','inspect','configure'].includes(verb))
    throw Error('Unknown Runner operation');
  if(verb==='install')return start();
  if(verb==='status')return state();
  if(verb==='start')return start();
  if(verb==='stop'){
    let requested=run('stop').requested;
    if(importOld&&lockStatus(legacyHome).running){
      fs.writeFileSync(path.join(legacyHome,'stop.json'),
        JSON.stringify({at:new Date().toISOString()}),{mode:0o600});
      requested=true;
    }
    return state({stopRequested:requested});
  }
  if(verb==='configure'){
    const value=target();if(!/^[1-3]$/.test(value))throw Error('Max concurrent must be 1..3');
    run('config','set',value);return state();
  }
  if(verb==='add'||verb==='remove')return state({projects:run(verb,target())});
  if(verb==='inspect')return state({projectInspection:run('inspect',target())});
}
try{process.stdout.write('T3_COMPANION_RESULT:'+JSON.stringify(main())+'\n'+marker+':0\n')}
catch(e){process.stdout.write('T3_COMPANION_ERROR:'+String(e.message||e).slice(-500)+'\n'+marker+':1\n');process.exitCode=1}
