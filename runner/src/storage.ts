import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'awaiting_merge' | 'done';
export type ExecutionStatus = 'dispatching' | 'completed' | 'blocked' | 'failed' | 'needs_reconciliation';
export type WorkspaceMode = 'auto' | 'root' | 'worktree';
export interface TaskModelSelection { instanceId: string; model: string }
export interface TaskExecutionSettings { workspace: WorkspaceMode; baseRef?: string; branch?: string; modelSelection?: TaskModelSelection; notBefore?: string }
export interface ExecutionRequest { requestId: string; execution: TaskExecutionSettings }
export interface Task { id: string; title: string; prompt: string; description?: string; status: TaskStatus; priority?: number; execution?: TaskExecutionSettings; executionRequests?: ExecutionRequest[] }
export interface TaskDocument { version: 1; tasks: Task[] }
export interface RuntimeRecord { taskId: string; status: ExecutionStatus; startedAt: string; finishedAt?: string; threadId?: string | null; runId?: string | null; error?: string | null; workflowStage?: import('./workflow.ts').WorkflowStage; pendingRequestCount?: number; changeRequests?: import('./workflow.ts').ChangeRequest[]; lastInspectedAt?: string }
export interface RuntimeDocument { version: 1; requests: Record<string, RuntimeRecord> }
// Durable state lives beside Companion code, not in T3's global user directory.
export const defaultHome = () => path.resolve(
  process.env.T3_COMPANION_HOME || fileURLToPath(new URL('../../.data/runner/', import.meta.url))
);
export const registryPath = (home: string) => path.join(home, 'projects.json');
export type RunnerSettings = { maxConcurrent: number; scanIntervalMs: number };
export const DEFAULT_RUNNER_SETTINGS: RunnerSettings = { maxConcurrent: 3, scanIntervalMs: 10_000 };
export const runnerSettingsPath = (home: string) => path.join(home, 'config.json');
export function validateRunnerSettings(value: unknown): RunnerSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Runner settings');
  const data = value as Partial<RunnerSettings>;
  if (!Number.isInteger(data.maxConcurrent) || data.maxConcurrent! < 1 || data.maxConcurrent! > 3)
    throw new Error('Max concurrent must be 1..3');
  if (!Number.isInteger(data.scanIntervalMs) || data.scanIntervalMs! < 1_000 || data.scanIntervalMs! > 60_000)
    throw new Error('Scan interval must be 1000..60000 milliseconds');
  return { maxConcurrent: data.maxConcurrent!, scanIntervalMs: data.scanIntervalMs! };
}
export async function readRunnerSettings(home = defaultHome()): Promise<RunnerSettings> {
  return validateRunnerSettings(await readJson(runnerSettingsPath(home), DEFAULT_RUNNER_SETTINGS));
}
export async function saveRunnerSettings(input: RunnerSettings, home = defaultHome()): Promise<RunnerSettings> {
  const validated = validateRunnerSettings(input);
  await atomicWrite(runnerSettingsPath(home), validated);
  return validated;
}
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

export function validExecutionSettings(v: any): v is TaskExecutionSettings {
  return v && typeof v === 'object' && !Array.isArray(v) &&
    ['auto', 'root', 'worktree'].includes(v.workspace) &&
    (v.baseRef === undefined || (typeof v.baseRef === 'string' && !!v.baseRef.trim())) &&
    (v.branch === undefined || (typeof v.branch === 'string' && !!v.branch.trim())) &&
    (v.notBefore === undefined || (typeof v.notBefore === 'string' && !Number.isNaN(Date.parse(v.notBefore)))) &&
    (v.modelSelection === undefined || (v.modelSelection &&
      typeof v.modelSelection.instanceId === 'string' && !!v.modelSelection.instanceId.trim() &&
      typeof v.modelSelection.model === 'string' && !!v.modelSelection.model.trim())) &&
    !(v.workspace === 'root' && (v.baseRef || v.branch)) &&
    !(v.branch && !v.baseRef && v.workspace !== 'auto');
}
function validTaskDocument(data: any): data is TaskDocument {
  const ids = new Set<string>();
  const requestIds = new Set<string>();
  return data?.version === 1 && Array.isArray(data.tasks) && data.tasks.every((task: any) => {
    if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.title !== 'string' || typeof task.prompt !== 'string' || !['todo','in_progress','review','awaiting_merge','done'].includes(task.status) || (task.execution !== undefined && !validExecutionSettings(task.execution))) return false;
    ids.add(task.id);
    return task.executionRequests === undefined || (Array.isArray(task.executionRequests) && task.executionRequests.every((req: any) => {
      if (!req || typeof req.requestId !== 'string' || !req.requestId || requestIds.has(req.requestId)) return false;
      requestIds.add(req.requestId);
      return validExecutionSettings(req.execution);
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

// Minimal CLI task creation; browser extension is the intended owner of tasks.json.
export async function createTask(projectInput: string, title: string, prompt: string, worktree?: string) {
  const project = await fs.realpath(path.resolve(projectInput));
  if (!title.trim() || !prompt.trim()) throw new Error('Task title and prompt are required');
  const doc = await readTasks(project);
  const execution: TaskExecutionSettings = { workspace: worktree ? 'worktree' : 'auto', ...(worktree ? { baseRef: worktree } : {}) };
  const task: Task = { id: randomUUID(), title, prompt, status: 'todo', execution, executionRequests: [{ requestId: randomUUID(), execution: { ...execution } }] };
  doc.tasks.push(task); await atomicWrite(filesFor(project).tasks, doc); return task;
}
