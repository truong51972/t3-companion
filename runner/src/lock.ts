import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { defaultHome, readJson } from './storage.ts';

export const lockDir = (home: string) => path.join(home, 'runner.lock');
export const stopFile = (home: string) => path.join(home, 'stop.json');

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
};

export async function status(home = defaultHome()) {
  try {
    const owner = await readJson(path.join(lockDir(home), 'owner.json'));
    return { running: Number.isInteger(owner.pid) && isAlive(owner.pid), pid: owner.pid };
  } catch {
    return { running: false, pid: null };
  }
}

export async function acquire(home: string) {
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const dir = lockDir(home);
  try {
    await fs.mkdir(dir);
  } catch (e: any) {
    if (e.code !== 'EEXIST') throw e;
    if ((await status(home)).running) throw new Error('Runner is already running');
    const stat = await fs.stat(dir);
    if (Date.now() - stat.mtimeMs < 3000) throw new Error('Runner lock is initializing; retry');
    const stale = `${dir}.stale-${randomUUID()}`;
    await fs.rename(dir, stale);
    await fs.rm(stale, { recursive: true });
    await fs.mkdir(dir);
  }
  // Identify which checkout owns this PID, so migrations do not stop a new worker twice.
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString(),
    entry: process.argv[1] ? path.resolve(process.argv[1]) : null };
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  return owner;
}

export async function release(home: string, owner: { token: string }) {
  try {
    const current = await readJson(path.join(lockDir(home), 'owner.json'));
    if (current.token === owner.token) await fs.rm(lockDir(home), { recursive: true });
  } catch {
    /* lock removed */
  }
}

export async function requestStop(home = defaultHome()) {
  if (!(await status(home)).running) return false;
  await fs.writeFile(stopFile(home), JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
  return true;
}
