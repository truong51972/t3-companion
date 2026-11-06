/** Build a command for T3's PTY without depending on a global npm bin directory. */
export type RunnerVerb = 'status' | 'start' | 'stop' | 'add' | 'remove';
export const runnerScript = '$HOME/.t3/companion/runner/bin/t3-runner.mjs';

function shellLiteral(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function runnerShellCommand(verb: RunnerVerb, target?: string): string {
  const args = verb + (target ? ' ' + shellLiteral(target) : '');
  // The user-level clone takes precedence, but existing global installs still work.
  // Never put an untrusted project path into a shell command without quoting it.
  return [
    'if [ -f "' + runnerScript + '" ]; then node "' + runnerScript + '" ' + args,
    'elif command -v t3-runner >/dev/null 2>&1; then t3-runner ' + args,
    "else printf '%s\\n' 'T3_COMPANION_RUNNER_NOT_INSTALLED'; (exit 127)",
    'fi',
  ].join('; ');
}

/** T3 terminals return raw PTY history (including zsh OSC, cursor and color codes). */
export function readableTerminalText(value: string): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .trim();
}
