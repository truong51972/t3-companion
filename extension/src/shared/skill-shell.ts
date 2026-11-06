/** Portable project-scoped skill installer. Status checks use projects.readFile, not a terminal. */
export const SKILL_PATH = '.agents/skills/t3-companion/SKILL.md' as const;

const PROGRAM = String.raw`
const request = __REQUEST__, marker = __MARKER__;
(async () => {
  const cp = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const project = path.resolve(request.project);
  if (!fs.statSync(project).isDirectory()) throw new Error('Not a project directory');
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['-y', 'skills', 'add', 'truong51972/t3-companion', '--skill', 't3-companion', '-y'];
  const child = cp.spawnSync(executable, args, {
    cwd: project, encoding: 'utf8', timeout: 90000, windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (child.error || child.status !== 0) {
    throw new Error('Skill install failed: ' + (child.error?.message || child.stderr || child.stdout || ('exit ' + child.status)).trim().slice(-500));
  }
  return { installed: true };
})().then(value => {
  process.stdout.write('T3_COMPANION_RESULT:' + JSON.stringify(value) + '\n' + marker + ':0\n');
}).catch(error => {
  process.stdout.write('T3_COMPANION_ERROR:' + String(error.message || error) + '\n' + marker + ':1\n');
  process.exitCode = 1;
});
`;
export function skillInstallShellCommand(project: string, marker: string): string {
  if (!/^COMPANION_[a-f0-9]{32}$/.test(marker)) throw new Error('Invalid command marker');
  const payload = PROGRAM.replace('__REQUEST__', JSON.stringify({ project }))
    .replace('__MARKER__', JSON.stringify(marker));
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
  return 'node -e "eval(Buffer.from(' + "'" + encoded + "','base64').toString('utf8'))" + '"';
}
