/** Runner code lives in a Git checkout; no downloaded JS installer. */
export type RunnerVerb = 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove' | 'inspect' | 'configure';
export const RUNNER_REPOSITORY = 'https://github.com/truong51972/t3-companion.git';
export const RUNNER_CHECKOUT = '~/.t3/t3-companion';
const ENTRY = "try{require(require('node:path').join(require('node:os').homedir(),'.t3','t3-companion','runner','bin','companion-control.cjs'))}" +
  "catch(e){console.log('T3_COMPANION_ERROR:'+String(e.message||e).slice(-500));console.log(process.argv[3]+':1');process.exitCode=1}";
const STATUS = "const p=require('node:path'),h=require('node:os').homedir(),f=require('node:fs'),s=p.join(h,'.t3','t3-companion','runner','bin','companion-control.cjs');" +
  "if(f.existsSync(s))require(s);else{const legacy=f.existsSync(p.join(h,'.t3','companion','runner','bin','t3-runner.mjs'));" +
  "let pid=null,running=false;try{pid=JSON.parse(f.readFileSync(p.join(h,'.t3','runner','runner.lock','owner.json'),'utf8')).pid;process.kill(pid,0);running=true}catch{}" +
  "console.log('T3_COMPANION_RESULT:'+JSON.stringify({installed:legacy,running,pid:running?pid:null,version:null,bridgeMissing:legacy,upgradeRequired:legacy}));console.log(process.argv[3]+':0')}";
function encodeTarget(target: string): string {
  const bytes = Array.from(new TextEncoder().encode(target), byte => String.fromCharCode(byte)).join('');
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Project paths are inert base64url data, never shell source. */
export function runnerShellCommand(verb: RunnerVerb, target: string | undefined, marker: string,
  hostOs: 'windows' | 'linux' | 'darwin' = 'linux'): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid Runner command marker');
  if (['add', 'remove', 'inspect'].includes(verb) && !target) throw new Error('Project path required');
  if (verb === 'configure' && !/^[1-3]$/.test(target || '')) throw new Error('Max concurrent must be 1..3');
  const actualVerb = verb === 'reinstall' || verb === 'update' ? 'status' : verb;
  const args = ['companion', actualVerb, marker, ...(target === undefined ? [] : [encodeTarget(target)])];
  const control = 'node -e "' + (verb === 'status' ? STATUS : ENTRY) + '" -- ' + args.join(' ');
  // Git commands can call the file directly after clone/pull. No eval-style
  // launcher is needed for installation, updates or repair.
  const localControl = (hostOs === 'windows'
    ? 'node "$HOME/.t3/t3-companion/runner/bin/companion-control.cjs" '
    : 'node ~/.t3/t3-companion/runner/bin/companion-control.cjs ') +
    actualVerb + ' ' + marker;
  if (hostOs === 'windows' && ['install', 'update', 'reinstall'].includes(verb)) {
    // PowerShell 5.1 and 7: native Git does not reliably expand ~ on Windows.
    // Check LASTEXITCODE before calling the local checkout's controller.
    const dir = '"$HOME/.t3/t3-companion"';
    const git = verb === 'install'
      ? 'git clone ' + RUNNER_REPOSITORY + ' ' + dir
      : 'git -C ' + dir + ' pull --ff-only';
    return git + '; if ($LASTEXITCODE -eq 0) { ' + localControl +
      ' } else { Write-Output "' + marker + ':1" }';
  }
  if (verb === 'install')
    return 'git clone ' + RUNNER_REPOSITORY + ' ' + RUNNER_CHECKOUT +
      ' && ' + localControl + ' || echo ' + marker + ':1';
  if (verb === 'update' || verb === 'reinstall')
    return 'git -C ' + RUNNER_CHECKOUT + ' pull --ff-only && ' + localControl + ' || echo ' + marker + ':1';
  return control;
}
/** T3 PTY Enter requires CR. */
export function terminalSubmit(command: string): string { return command + '\r'; }
export function readableTerminalText(value: string): string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[=>]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
}
