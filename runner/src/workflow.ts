/**
 * Deterministic, runner-owned Kanban projection of T3's read-only thread metadata.
 * Never infer PR state from assistant text and never let an unverified link mark Done.
 */
export type WorkflowStage = 'in_progress' | 'human_review' | 'awaiting_merge' | 'done';
export type ChangeRequestState = 'open' | 'closed' | 'merged' | 'unknown';
export type ChangeRequest = { url: string; state: ChangeRequestState };
export type ThreadInspection = {
  stage: WorkflowStage;
  pendingRequestCount: number;
  changeRequests: ChangeRequest[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * The T3 CLI returns {thread, messages}. The thread is an authoritative
 * server projection with pendingRequestCount and linked pullRequests.
 * The runner never scans transcripts or guesses repo/branch associations.
 */
export function projectThreadInspection(payload: unknown): ThreadInspection | null {
  const body = record(payload);
  const thread = record(body?.thread);
  if (!thread || typeof thread.status !== 'string') return null;
  const count = typeof thread.pendingRequestCount === 'number' &&
    Number.isSafeInteger(thread.pendingRequestCount) && thread.pendingRequestCount >= 0
    ? thread.pendingRequestCount : 0;
  const requests: ChangeRequest[] = [];
  if (Array.isArray(thread.pullRequests)) {
    for (const raw of thread.pullRequests) {
      const pr = record(raw);
      if (!pr || pr.source === 'stack-dismissed' || typeof pr.url !== 'string' ||
          !/^https:\/\//.test(pr.url)) continue;
      const state: ChangeRequestState = pr.state === 'open' || pr.state === 'closed' || pr.state === 'merged'
        ? pr.state : 'unknown';
      // Deduplicate without making a guess about different stacks/layers.
      if (!requests.some(existing => existing.url === pr.url))
        requests.push({ url: pr.url, state });
    }
  }
  // The legacy single link has no verified merge state; it can keep review
  // pending, but it can never constitute proof of merge.
  if (requests.length === 0) {
    const link = record(thread.linkedPullRequest);
    if (typeof link?.url === 'string' && /^https:\/\//.test(link.url))
      requests.push({ url: link.url, state: 'unknown' });
  }
  if (count > 0) return { stage: 'human_review', pendingRequestCount: count, changeRequests: requests };
  const status = thread.status;
  if (status === 'running' || status === 'pending' || status === 'queued' || status === 'starting') {
    return { stage: 'in_progress', pendingRequestCount: 0, changeRequests: requests };
  }
  if (status !== 'completed' && status !== 'idle' && status !== 'failed' &&
      status !== 'cancelled' && status !== 'interrupted' && status !== 'rolled_back') return null;
  if (status !== 'completed' && status !== 'idle') {
    return { stage: 'human_review', pendingRequestCount: 0, changeRequests: requests };
  }
  if (requests.length > 0 && requests.every(pr => pr.state === 'merged'))
    return { stage: 'done', pendingRequestCount: 0, changeRequests: requests };
  if (requests.some(pr => pr.state === 'open'))
    return { stage: 'awaiting_merge', pendingRequestCount: 0, changeRequests: requests };
  // No linked request, unknown state or closed without merge requires a human.
  return { stage: 'human_review', pendingRequestCount: 0, changeRequests: requests };
}
