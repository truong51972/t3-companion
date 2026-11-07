/**
 * Shared domain contracts and schemas for Tasks, Runtime, and Runner state.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'awaiting_merge' | 'done';

export type ExecutionStatus = 'dispatching' | 'completed' | 'blocked' | 'failed' | 'needs_reconciliation';

export type WorkflowStage = 'in_progress' | 'human_review' | 'awaiting_merge' | 'done';

export type ChangeRequestState = 'open' | 'closed' | 'merged' | 'unknown';

export interface ChangeRequest {
  url: string;
  state: ChangeRequestState;
}

export type WorkspaceMode = 'auto' | 'root' | 'worktree';

export interface ExecutionRequest {
  requestId: string;
  notBefore?: string;
  worktree?: string;
  workspace?: WorkspaceMode;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  prompt: string;
  status: TaskStatus;
  statusOverride?: boolean;
  priority?: number;
  executionRequests?: ExecutionRequest[];
}

export interface TasksDocument {
  version: 1;
  tasks: Task[];
}

export interface RuntimeRecord {
  taskId: string;
  status: string;
  threadId?: string | null;
  runId?: string | null;
  reply?: string | null;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
  workflowStage?: WorkflowStage;
  pendingRequestCount?: number;
  changeRequests?: ChangeRequest[];
  lastInspectedAt?: string;
}

export interface RuntimeDocument {
  version: 1;
  requests: Record<string, RuntimeRecord>;
}

export const BOARD_COLUMNS: { key: TaskStatus; name: string }[] = [
  { key: 'todo', name: 'To Do' },
  { key: 'in_progress', name: 'In Progress' },
  { key: 'review', name: 'Human Review' },
  { key: 'awaiting_merge', name: 'Awaiting Merge' },
  { key: 'done', name: 'Done' },
];

export const emptyTasks = (): TasksDocument => ({ version: 1, tasks: [] });
export const emptyRuntime = (): RuntimeDocument => ({ version: 1, requests: {} });
export const blankTask = (): Task => ({
  id: crypto.randomUUID(),
  title: '',
  description: '',
  prompt: '',
  status: 'todo',
  priority: 2,
});

export function validateTasks(data: unknown): TasksDocument {
  const doc = data as TasksDocument;
  if (
    doc?.version !== 1 ||
    !Array.isArray(doc.tasks) ||
    !doc.tasks.every(
      t =>
        t &&
        typeof t.id === 'string' &&
        typeof t.title === 'string' &&
        typeof t.prompt === 'string' &&
        BOARD_COLUMNS.some(c => c.key === t.status)
    )
  ) {
    throw new Error('Invalid tasks.json; refusing to overwrite.');
  }
  return doc;
}

export function validateRuntime(data: unknown): RuntimeDocument {
  const doc = data as RuntimeDocument;
  if (
    doc?.version !== 1 ||
    !doc.requests ||
    typeof doc.requests !== 'object' ||
    Array.isArray(doc.requests)
  ) {
    throw new Error('Invalid runtime.json; refusing to show corrupted data');
  }
  return doc;
}

export function getTaskExecution(task: Task, runtime: RuntimeDocument): RuntimeRecord | null {
  const req = task.executionRequests?.at(-1);
  return req ? runtime.requests[req.requestId] || null : null;
}

export function getTaskColumn(task: Task, runtime: RuntimeDocument): TaskStatus {
  if (task.statusOverride || task.status === 'done' || task.status === 'review' || task.status === 'awaiting_merge') {
    return task.status;
  }
  const execution = getTaskExecution(task, runtime);
  if (execution?.workflowStage === 'done') return 'done';
  if (execution?.workflowStage === 'awaiting_merge') return 'awaiting_merge';
  if (execution?.workflowStage === 'human_review') return 'review';
  if (execution?.workflowStage === 'in_progress') return 'in_progress';
  const status = execution?.status;
  if (status === 'dispatching') return 'in_progress';
  if (status === 'completed' || status === 'blocked' || status === 'failed' || status === 'needs_reconciliation') {
    return 'review';
  }
  return task.status;
}

export interface ParsedRunnerState {
  raw: string;
  installed: boolean;
  running: boolean;
  pid: number | null;
  bridgeMissing: boolean;
  starting: boolean;
  stopping: boolean;
  error: string;
  version: string | null;
  maxConcurrent: number;
  scanIntervalMs: number | null;
  upgradeRequired: boolean;
  cliAvailable: boolean;
  cliCommand: string | null;
  requiresCli: boolean;
  label: 'Needs session' | 'Error' | 'Setup required' | 'Starting' | 'Not installed' | 'CLI unavailable' | 'Stopping' | 'Running' | 'Stopped' | 'Checking';
}

export function parseRunnerState(raw: string, hostAvailable: boolean): ParsedRunnerState {
  let parsed: Record<string, unknown> | null = null;
  let errorMsg = '';

  if (raw.startsWith('Runner check failed: ')) {
    errorMsg = raw.slice('Runner check failed: '.length);
  } else if (raw.startsWith('{')) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      errorMsg = 'Invalid runner JSON response';
    }
  }

  const running = parsed?.running === true;
  const installed = parsed?.installed === true;
  const bridgeMissing = parsed?.bridgeMissing === true;
  const starting = parsed?.starting === true;
  const stopRequested = parsed?.stopRequested === true;
  const stopping = stopRequested && running;
  const pid = typeof parsed?.pid === 'number' ? parsed.pid : null;
  const version = typeof parsed?.version === 'string' ? parsed.version : null;
  // Runner CLI reports { settings: { maxConcurrent, scanIntervalMs } }.
  // Top-level values are accepted only for backward compatibility.
  const settings = parsed?.settings && typeof parsed.settings === 'object' &&
    !Array.isArray(parsed.settings) ? parsed.settings as Record<string, unknown> : null;
  const rawInterval = settings?.scanIntervalMs ?? parsed?.scanIntervalMs;
  const scanIntervalMs = typeof rawInterval === 'number' && Number.isInteger(rawInterval) &&
    rawInterval >= 1000 && rawInterval <= 60000 ? rawInterval : null;
  const upgradeRequired = parsed?.upgradeRequired === true;
  const requiresCli = parsed?.requiresCli === true;

  const cliObj = parsed?.cli as { available?: boolean; command?: string | null } | undefined;
  const cliAvailable = cliObj ? cliObj.available !== false : true;
  const cliCommand = typeof cliObj?.command === 'string' ? cliObj.command : null;

  const rawConcurrent = settings?.maxConcurrent ?? parsed?.maxConcurrent;
  const maxConcurrent = typeof rawConcurrent === 'number' && Number.isInteger(rawConcurrent) &&
    rawConcurrent >= 1 && rawConcurrent <= 3 ? rawConcurrent : 3;

  let label: ParsedRunnerState['label'] = 'Checking';
  if (!hostAvailable) {
    label = 'Needs session';
  } else if (errorMsg) {
    label = 'Error';
  } else if (bridgeMissing && installed) {
    label = 'Setup required';
  } else if (starting) {
    label = 'Starting';
  } else if (!installed && raw !== 'Not checked') {
    label = 'Not installed';
  } else if (!cliAvailable || requiresCli) {
    label = 'CLI unavailable';
  } else if (stopping) {
    label = 'Stopping';
  } else if (running) {
    label = 'Running';
  } else if (parsed && !running) {
    label = 'Stopped';
  } else {
    label = 'Checking';
  }

  return {
    raw,
    installed,
    running,
    pid,
    bridgeMissing,
    starting,
    stopping,
    error: errorMsg,
    version,
    maxConcurrent,
    scanIntervalMs,
    upgradeRequired,
    cliAvailable,
    cliCommand,
    requiresCli,
    label,
  };
}
