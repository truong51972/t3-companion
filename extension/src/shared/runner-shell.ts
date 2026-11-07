/** Runner code lives in a Git checkout; no downloaded JS installer. */
export type RunnerVerb = 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove' | 'inspect' | 'configure';
export const RUNNER_REPOSITORY = 'https://github.com/truong51972/t3-companion.git';
export const RUNNER_CHECKOUT = '~/.t3/t3-companion';
const ENTRY = "require(require('node:path').join(require('node:os').homedir(),'.t3','t3-companion','runner','bin','companion-control.cjs'))";
const STATUS = "const p=require('node:path'),h=require('node:os').homedir(),f=require('node:fs'),s=p.join(h,'.t3','t3-companion','runner','bin','companion-control.cjs');" +
  "if(f.existsSync(s))require(s);else{const legacy=f.existsSync(p.join(h,'.t3','companion','runner','bin','t3-runner.mjs'));" +
  "let pid=null,running=false;try{pid=JSON.parse(f.readFileSync(p.join(h,'.t3','runner','runner.lock','owner.json'),'utf8')).pid;process.kill(pid,0);running=true}catch{}" +
  "console.log('T3_COMPANION_RESULT:'+JSON.stringify({installed:legacy,running,pid:running?pid:null,version:null,bridgeMissing:legacy,upgradeRequired:legacy}));console.log(process.argv[2]+':0')}";
function encodeTarget(target: string): string {
  const bytes = Array.from(new TextEncoder().encode(target), byte => String.fromCharCode(byte)).join('');
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Project paths are inert base64url data, never shell source. */
export function runnerShellCommand(verb: RunnerVerb, target: string | undefined, marker: string): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid Runner command marker');
  if (['add', 'remove', 'inspect'].includes(verb) && !target) throw new Error('Project path required');
  if (verb === 'configure' && !/^[1-3]$/.test(target || '')) throw new Error('Max concurrent must be 1..3');
  const actualVerb = verb === 'reinstall' || verb === 'update' ? 'status' : verb;
  const args = [actualVerb, marker, ...(target === undefined ? [] : [encodeTarget(target)])];
  const control = 'node -e "' + (verb === 'status' ? STATUS : ENTRY) + '" -- ' + args.join(' ');
  if (verb === 'install')
    return 'git clone --depth 1 ' + RUNNER_REPOSITORY + ' ' + RUNNER_CHECKOUT +
      ' && ' + control + ' || echo ' + marker + ':1';
  if (verb === 'update' || verb === 'reinstall')
    return 'git -C ' + RUNNER_CHECKOUT + ' pull --ff-only && ' + control + ' || echo ' + marker + ':1';
  return control;
}
/** T3 PTY Enter requires CR. */
export function terminalSubmit(command: string): string { return command + '\r'; }
export function readableTerminalText(value: string): string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[=>]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
}
