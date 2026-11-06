import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export const rootDir = () => path.resolve(process.env.T3_COMPANION_HOME || path.join(homedir(), '.t3', 'runner'));
export const jobStates = ['pending', 'running', 'completed', 'blocked', 'failed', 'interrupted'];
const json = (data) => `${JSON.stringify(data, null, 2)}\n`;

export async function initialize(root = rootDir()) {
  await Promise.all(['projects', ...jobStates.map((s) => path.join('jobs', s))].map((dir) =>
    fs.mkdir(path.join(root, dir), { recursive: true, mode: 0o700 })));
  return root;
}

export async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, json(data), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export const projectId = (realPath) => createHash('sha256').update(realPath).digest('hex').slice(0, 20);

export async function registerProject(input, root = rootDir()) {
  const real = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Project must be a directory');
  await initialize(root);
  const project = { id: projectId(real), path: real };
  await atomicJson(path.join(root, 'projects', `${project.id}.json`), project);
  return project;
}

export async function listProjects(root = rootDir()) {
  await initialize(root);
  const names = await fs.readdir(path.join(root, 'projects'));
  const items = [];
  for (const name of names.filter((name) => /^[a-f0-9]{20}\.json$/.test(name)).sort()) {
    items.push(await readJson(path.join(root, 'projects', name)));
  }
  return items;
}

export async function resolveProject(identifier, root = rootDir()) {
  const projects = await listProjects(root);
  const match = projects.find((item) => item.id === identifier || item.path === path.resolve(identifier));
  if (match) return match;
  // Accept paths containing symlinks (but never silently register a project).
  try {
    const real = await fs.realpath(path.resolve(identifier));
    const item = projects.find((project) => project.path === real);
    if (item) return item;
  } catch { /* An id is not necessarily a filesystem path. */ }
  throw new Error(`Project is not registered: ${identifier}`);
}

export async function unregisterProject(identifier, root = rootDir()) {
  const project = await resolveProject(identifier, root);
  const jobs = await listJobs(root);
  if (jobs.some((job) => job.projectId === project.id && ['pending', 'running'].includes(job.state))) {
    throw new Error('Project has pending or running jobs');
  }
  await fs.unlink(path.join(root, 'projects', `${project.id}.json`));
  return project;
}

export const jobFile = (root, state, id) => path.join(root, 'jobs', state, `${id}.json`);

export async function enqueueJob(projectIdentifier, prompt, { worktree } = {}, root = rootDir()) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt must not be empty');
  if (worktree !== undefined && (typeof worktree !== 'string' || !worktree.trim())) {
    throw new Error('Worktree base ref must not be empty');
  }
  const project = await resolveProject(projectIdentifier, root);
  const job = { id: randomUUID(), projectId: project.id, prompt, ...(worktree ? { worktree } : {}),
    createdAt: new Date().toISOString(), state: 'pending' };
  await fs.writeFile(jobFile(root, 'pending', job.id), json(job), { flag: 'wx', mode: 0o600 });
  return job;
}

export async function listJobs(root = rootDir()) {
  await initialize(root);
  const result = [];
  for (const state of jobStates) {
    for (const name of (await fs.readdir(path.join(root, 'jobs', state))).filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
      result.push({ ...await readJson(path.join(root, 'jobs', state, name)), state });
    }
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function moveJob(root, job, from, to, changes = {}) {
  const source = jobFile(root, from, job.id);
  const target = jobFile(root, to, job.id);
  // Rename claims a job atomically; never execute a job before claiming it.
  await fs.rename(source, target);
  const next = { ...job, ...changes, state: to };
  await atomicJson(target, next);
  return next;
}
