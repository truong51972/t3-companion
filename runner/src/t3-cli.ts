import path from 'node:path';
import os from 'node:os';
import { constants as fsConstants, promises as fs } from 'node:fs';

/**
 * T3's server and its CLI are not the same thing. A T3 Web session can be
 * healthy even when the runner's detached process cannot find the 't3'
 * executable. Official T3 CLI installers place it in ~/.local/bin, which is
 * often absent from a non-login process's PATH.
 *
 * Never invoke a shell or auto-download an arbitrary version of T3.
 */
export type T3CliOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
};

export type T3CliStatus = {
  available: boolean;
  command: string | null;
  source: 'override' | 'path' | 'local-install' | null;
  message?: string;
};

async function usable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    await fs.access(file, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findT3Cli(options: T3CliOptions = {}): Promise<T3CliStatus> {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const configured = env.T3_COMPANION_T3_BIN?.trim();

  const missing = (message?: string): T3CliStatus => ({
    available: false, command: null, source: null,
    message: message ?? 'T3 CLI not found on this environment host. Install T3 Code CLI on the host running Runner, or set T3_COMPANION_T3_BIN to its absolute executable path. Then restart Runner.',
  });

  if (configured) {
    const resolved = configured.startsWith('~/') || configured.startsWith('~\\')
      ? path.join(home, configured.slice(2)) : configured;
    if (!path.isAbsolute(resolved))
      return missing('T3_COMPANION_T3_BIN must be an absolute executable path (or ~/...).');
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolved))
      return missing('T3_COMPANION_T3_BIN must point to the T3 executable (.exe), not a .cmd/.bat shell wrapper.');
    if (await usable(resolved, platform)) return { available: true, command: resolved, source: 'override' };
    return missing('Configured T3 CLI executable not found or not executable: ' + resolved);
  }

  const names = platform === 'win32' ? ['t3.exe', 't3.com', 't3'] : ['t3'];
  const delimiter = platform === 'win32' ? ';' : ':';
  const rawPath = env.PATH ?? env.Path ?? '';
  const dirs = rawPath.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await usable(candidate, platform)) return { available: true, command: candidate, source: 'path' };
    }
  }
  for (const name of names) {
    const candidate = path.join(home, '.local', 'bin', name);
    if (await usable(candidate, platform)) {
      return { available: true, command: candidate, source: 'local-install' };
    }
  }
  return missing();
}

export async function requireT3Cli(options?: T3CliOptions): Promise<string> {
  const status = await findT3Cli(options);
  if (!status.available || !status.command) throw new Error(status.message || 'T3 CLI unavailable');
  return status.command;
}
