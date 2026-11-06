/**
 * Portable T3 terminal commands. Control logic lives in the fixed, pinned
 * runner-control.cjs file installed once in the selected environment.
 * Only the first installation downloads it; ordinary commands are short and
 * readable, with no eval, base64-encoded programs, or shell-specific syntax.
 */
export type RunnerVerb = 'install' | 'status' | 'start' | 'stop' | 'add' | 'remove';
export const RUNNER_SOURCE_REF = '5ae13b7b08e78668dfc5ffb290fc958cc00c6bf8';
export const CONTROL_SOURCE_REF = '715b00ce618ab821ee308bd5566723b9782b521d';

const CONTROL_URL = 'https://raw.githubusercontent.com/truong51972/t3-companion/' +
  CONTROL_SOURCE_REF + '/runner/bin/companion-control.cjs';

// Single/double quote convention is intentional: the double-quoted -e argument
// works in POSIX shells, PowerShell and cmd, without interpolating project paths.
const PATH_SCRIPT = "const p=require('node:path'),o=require('node:os'),f=require('node:fs'),s=p.join(o.homedir(),'.t3','companion','runner-control.cjs');";

const CONTROL_SCRIPT = PATH_SCRIPT +
  "if(f.existsSync(s))require(s);else if(process.argv[1]==='status'){" +
  "const installed=f.existsSync(p.join(o.homedir(),'.t3','companion','runner','bin','t3-runner.mjs'));" +
  "console.log('T3_COMPANION_RESULT:'+JSON.stringify({installed,running:false,pid:null,bridgeMissing:true}));" +
  "console.log(process.argv[2]+':0')" +
  "}else{console.log('T3_COMPANION_ERROR:Runner controls require setup');" +
  "console.log(process.argv[2]+':1');process.exitCode=1}";

const INSTALL_SCRIPT = PATH_SCRIPT +
  "fetch('" + CONTROL_URL + "',{signal:AbortSignal.timeout(15000)})" +
  ".then(r=>{if(!r.ok)throw Error('Control download failed: HTTP '+r.status);return r.text()})" +
  ".then(body=>{f.mkdirSync(p.dirname(s),{recursive:true});f.writeFileSync(s,body,{mode:0o600});require(s)})" +
  ".catch(e=>{console.log('T3_COMPANION_ERROR:'+String(e.message||e).slice(-500));" +
  "console.log(process.argv[2]+':1');process.exitCode=1})";

function encodeTarget(target: string): string {
  const binary = Array.from(new TextEncoder().encode(target), byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function runnerShellCommand(verb: RunnerVerb, target: string | undefined, marker: string): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid Runner command marker');
  if ((verb === 'add' || verb === 'remove') && !target) throw new Error('Project path required');
  const args = [verb, marker, ...(target === undefined ? [] : [encodeTarget(target)])];
  return 'node -e "' + (verb === 'install' ? INSTALL_SCRIPT : CONTROL_SCRIPT) + '" -- ' + args.join(' ');
}

/** A PTY Enter key sends CR; LF is Ctrl+J in terminal raw mode (not Enter on PowerShell). */
export function terminalSubmit(command: string): string {
  return command + '\r';
}

/** T3 terminals return raw PTY history, including zsh OSC, cursor and ANSI codes. */
export function readableTerminalText(value: string): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .trim();
}
