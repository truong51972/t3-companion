import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type ExecutionStatus = 'dispatching' | 'completed' | 'blocked' | 'failed' | 'needs_reconciliation';
export interface ExecutionRequest { requestId: string; notBefore?: string; worktree?: string; workspace?: 'auto' | 'root' | 'worktree' }
export interface Task { id: string; title: string; prompt: string; description?: string; status: TaskStatus; priority?: number; executionRequests?: ExecutionRequest[] }
export interface TaskDocument { version: 1; tasks: Task[] }
export interface RuntimeRecord { taskId: string; status: ExecutionStatus; startedAt: string; finishedAt?: string; threadId?: string | null; runId?: string | null; reply?: string | null; error?: string | null; workflowStage?: import('./workflow.ts').WorkflowStage; pendingRequestCount?: number; changeRequests?: import('./workflow.ts').ChangeRequest[]; lastInspectedAt?: string }
export interface RuntimeDocument { version: 1; requests: Record<string, RuntimeRecord> }
export const defaultHome = () => path.resolve(process.env.T3_COMPANION_HOME || path.join(process.env.T3CODE_HOME || path.join(homedir(), '.t3'), 'runner'));
export const registryPath = (home: string) => path.join(home, 'projects.json');
export const filesFor = (project: string) => ({ tasks: path.join(project, '.t3', 'tasks.json'), runtime: path.join(project, '.t3', 'runtime.json') });
export const emptyTasks = (): TaskDocument => ({ version: 1, tasks: [] });
export const emptyRuntime = (): RuntimeDocument => ({ version: 1, requests: {} });

export async function readJson(file: string, fallback?: unknown): Promise<any> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error: any) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

export async function atomicWrite(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function listProjects(home = defaultHome()): Promise<string[]> {
  const document = await readJson(registryPath(home), { projects: [] });
  if (!document || !Array.isArray(document.projects) || !document.projects.every((p: unknown) => typeof p === 'string' && path.isAbsolute(p))) {
    throw new Error(`Invalid projects registry: ${registryPath(home)}`);
  }
  return document.projects;
}

export async function registerProject(input: string, home = defaultHome()): Promise<string[]> {
  const project = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(project)).isDirectory()) throw new Error('Project must be a directory');
  const paths = await listProjects(home);
  if (!paths.includes(project)) { paths.push(project); await atomicWrite(registryPath(home), { projects: paths }); }
  return paths;
}
export async function unregisterProject(input: string, home = defaultHome()): Promise<string[]> {
  const project = await fs.realpath(path.resolve(input));
  const paths = await listProjects(home);
  const remaining = paths.filter(p => p !== project);
  if (remaining.length !== paths.length) await atomicWrite(registryPath(home), { projects: remaining });
  return remaining;
}

function validTaskDocument(data: any): data is TaskDocument {
  const ids = new Set<string>();
  const requestIds = new Set<string>();
  return data?.version === 1 && Array.isArray(data.tasks) && data.tasks.every((task: any) => {
    if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.title !== 'string' || typeof task.prompt !== 'string' || !['todo','in_progress','review','done'].includes(task.status)) return false;
    ids.add(task.id);
    return task.executionRequests === undefined || (Array.isArray(task.executionRequests) && task.executionRequests.every((req: any) => {
      if (!req || typeof req.requestId !== 'string' || !req.requestId || requestIds.has(req.requestId)) return false;
      requestIds.add(req.requestId);
      return (req.worktree === undefined || typeof req.worktree === 'string') &&
        (req.workspace === undefined || ['auto','root','worktree'].includes(req.workspace)) &&
        (req.notBefore === undefined || typeof req.notBefore === 'string');
    }));
  });
}
export async function readTasks(project: string): Promise<TaskDocument> {
  const file = filesFor(project).tasks; const data = await readJson(file, emptyTasks());
  if (!validTaskDocument(data)) throw new Error(`Invalid task contract: ${file}`);
  return data;
}
export async function readRuntime(project: string): Promise<RuntimeDocument> {
  const file = filesFor(project).runtime; const data = await readJson(file, emptyRuntime());
  if (data?.version !== 1 || !data.requests || typeof data.requests !== 'object' || Array.isArray(data.requests) ||
      !Object.values(data.requests).every((r: any) => r && typeof r === 'object' && typeof r.taskId === 'string' &&
        ['dispatching', 'completed', 'blocked', 'failed', 'needs_reconciliation'].includes(r.status))) {
    throw new Error(`Invalid runtime contract: ${file}`);
  }
  return data;
}
export async function saveRuntime(project: string, doc: RuntimeDocument) { await atomicWrite(filesFor(project).runtime, doc); }

// CLI fallback for smoke tests; browser extension is the intended owner of tasks.json.
export async function createTask(projectInput: string, title: string, prompt: string, worktree?: string) {
  const project = await fs.realpath(path.resolve(projectInput));
  if (!title.trim() || !prompt.trim()) throw new Error('Task title and prompt are required');
  const doc = await readTasks(project);
  const task: Task = { id: randomUUID(), title, prompt, status: 'todo', executionRequests: [{ requestId: randomUUID(), workspace: worktree ? 'worktree' : 'auto', ...(worktree ? { worktree } : {}) }] };
  doc.tasks.push(task); await atomicWrite(filesFor(project).tasks, doc); return task;
}
