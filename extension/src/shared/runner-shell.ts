/**
 * Portable, one-shot Runner control commands executed by a T3 terminal.
 * Node is the only prerequisite. The encoded program avoids shell-specific
 * quoting, PATH-based global npm binaries, and Windows/POSIX differences.
 */
export type RunnerVerb = 'install' | 'status' | 'start' | 'stop' | 'add' | 'remove';
export const RUNNER_SOURCE_REF = '5ae13b7b08e78668dfc5ffb290fc958cc00c6bf8';

const PROGRAM = String.raw` 
const request = __REQUEST__;
const marker = __MARKER__;
(async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const root = path.join(os.homedir(), '.t3', 'companion');
  const entry = path.join(root, 'runner', 'bin', 't3-runner.mjs');
  const files = [
    'runner/bin/t3-runner.mjs',
    'runner/src/cli.ts',
    'runner/src/runner.ts',
    'runner/src/storage.ts',
  ];
  const exists = async (file) => fs.access(file).then(() => true, () => false);
  let installed = (await Promise.all(files.map(f => exists(path.join(root, f))))).every(Boolean);

  if (request.verb === 'install' && !installed) {
    // Immutable GitHub commit: never execute an unpinned moving branch.
    const base = 'https://raw.githubusercontent.com/truong51972/t3-companion/' + request.ref + '/';
    const downloads = await Promise.all(files.map(async (file) => {
      const response = await fetch(base + file, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Runner download failed: ' + file + ' (HTTP ' + response.status + ')');
      return [file, await response.text()];
    }));
    for (const [file, contents] of downloads) {
      const destination = path.join(root, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = destination + '.' + process.pid + '.tmp';
      await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, destination);
    }
    installed = true;
  }
  if (!installed) return { installed: false, running: false, pid: null };

  const call = (verb, arg) => {
    const child = spawnSync(process.execPath, [entry, verb, ...(arg ? [arg] : [])], { encoding: 'utf8', timeout: 15000 });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error((child.stderr || child.stdout || 'Runner CLI failed').trim());
    try { return JSON.parse(child.stdout.trim()); }
    catch { throw new Error('Invalid Runner CLI output: ' + child.stdout.slice(-300)); }
  };
  if (request.verb === 'install' || request.verb === 'start') {
    const before = call('status');
    if (!before.running) {
      try { call('start'); } catch (error) {
        // Another Side Panel can start the same Runner concurrently.
        if (!/already running/i.test(String(error))) throw error;
      }
    }
    for (let i = 0; i < 10; i++) {
      const current = call('status');
      if (current.running) return { ...current, installed: true };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Runner did not become ready after start');
  }
  if (request.verb === 'stop') {
    const stopped = call('stop');
    return { ...call('status'), installed: true, stopRequested: stopped.requested };
  }
  if (request.verb === 'add' || request.verb === 'remove') {
    if (!request.target) throw new Error('Project path is required');
    const projects = call(request.verb, request.target);
    return { ...call('status'), installed: true, projects };
  }
  return { ...call('status'), installed: true };
})().then(result => {
  process.stdout.write('T3_COMPANION_RESULT:' + JSON.stringify(result) + '\n');
  process.stdout.write(marker + ':0\n');
}).catch(error => {
  process.stdout.write('T3_COMPANION_ERROR:' + String(error.message || error) + '\n');
  process.stdout.write(marker + ':1\n');
  process.exitCode = 1;
});
`;

export function runnerShellCommand(verb: RunnerVerb, target: string | undefined, marker: string): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid Runner command marker');
  const payload = PROGRAM
    .replace('__REQUEST__', JSON.stringify({ verb, target, ref: RUNNER_SOURCE_REF }))
    .replace('__MARKER__', JSON.stringify(marker));
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
  // Only base64 occurs within double quotes: works with sh, bash, zsh, cmd and PowerShell.
  return 'node -e "eval(Buffer.from(' + "'" + encoded + "','base64').toString('utf8'))" + '"';
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
