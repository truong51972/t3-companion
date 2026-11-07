import { readRuntime, readTasks, type RuntimeDocument } from './storage.ts';
import type { ThreadInspection } from './workflow.ts';

export type InspectThread = (project: string, threadId: string) => Promise<ThreadInspection | null>;

export const INSPECT_INTERVAL_MS = 30_000;

/**
 * Reconcile finished/waiting sessions and PR merge status without editing tasks.json.
 * Inspect no more than four threads per project pass; 30s per-thread throttle.
 */
export async function reconcileProject(
  project: string,
  inspectThread: InspectThread,
  updateRuntime: (
    project: string,
    mutate: (doc: RuntimeDocument) => boolean | void
  ) => Promise<unknown>
) {
  const snapshot = await readRuntime(project);
  const tasks = await readTasks(project);
  const currentRequestIds = new Set(
    tasks.tasks.map(task => task.executionRequests?.at(-1)?.requestId).filter(Boolean)
  );
  const now = Date.now();
  const items = Object.entries(snapshot.requests)
    .filter(([id]) => currentRequestIds.has(id))
    .filter(
      ([, entry]) =>
        Boolean(entry.threadId) &&
        ['dispatching', 'completed', 'blocked', 'failed', 'needs_reconciliation'].includes(
          entry.status
        ) &&
        entry.workflowStage !== 'done' &&
        (!entry.lastInspectedAt || now - Date.parse(entry.lastInspectedAt) >= INSPECT_INTERVAL_MS)
    )
    .slice(0, 4);

  await Promise.allSettled(
    items.map(async ([id, entry]) => {
      const observed = await inspectThread(project, entry.threadId!);
      const at = new Date().toISOString();
      await updateRuntime(project, current => {
        const record = current.requests[id];
        if (!record || record.threadId !== entry.threadId) return false;
        record.lastInspectedAt = at;
        if (observed) {
          record.workflowStage = observed.stage;
          record.pendingRequestCount = observed.pendingRequestCount;
          record.changeRequests = observed.changeRequests;
          if (record.status === 'blocked' && observed.stage !== 'human_review') {
            record.status = observed.stage === 'in_progress' ? 'dispatching' : 'completed';
          } else if (record.status === 'dispatching' && observed.stage !== 'in_progress') {
            record.status =
              observed.stage === 'human_review' && observed.pendingRequestCount > 0
                ? 'blocked'
                : 'completed';
          }
        }
      });
    })
  );
}
