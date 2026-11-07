# File contract v1

The Board and optional project Agent Skill can edit task definitions; the Runner alone owns execution metadata. All use the T3 environment's **project filesystem**, not a central server.

## Registry — `~/.t3/runner/projects.json`

`{"projects":["/absolute/project/path"]}`. No per-project registry files. If T3 Code uses `T3CODE_HOME`, the Runner follows that environment variable unless `T3_COMPANION_HOME` overrides it.

## Tasks — `project/.t3/tasks.json`

```json
{
  "version": 1,
  "tasks": [{
    "id": "task-uuid", "title": "Investigate failing tests", "description": "optional",
    "prompt": "Find root cause and fix tests", "status": "todo", "priority": 2, "statusOverride": false,
    "executionRequests": [{ "requestId": "request-uuid", "workspace": "auto", "notBefore": "2026-11-10T09:00:00+07:00" }]
  }]
}
```

Task title and agent prompt are distinct; Runner sends only the prompt to T3. `status` is independent of execution: `todo | in_progress | review | awaiting_merge | done`. The five visible lanes are **To Do**, **In Progress**, **Human Review**, **Awaiting Merge**, and **Done**. Runner uses `t3 thread show --json` to inspect the thread's server-owned `pendingRequestCount` and linked PR/MR states, without extracting or interpreting chat text. Any pending input goes to Human Review. A finished thread with an open or not-yet-verified linked PR/MR goes to Awaiting Merge. A finished thread with **all** linked requests verifiably merged goes to Done. No linked PR or a closed-unmerged PR/MR stays in Human Review; linked PR/MR with unknown merge state stays Awaiting Merge (unverified), never Done. `statusOverride: true` preserves a user's manual lane move until the next queue request, which resets the override. Runner never edits `tasks.json`. Each request ID must be unique. A task can accumulate execution requests; append a new `requestId` for an intentional rerun. `notBefore` is an optional ISO 8601 timestamp. `workspace` is `auto | worktree | root`: auto creates isolated T3 worktrees for Git projects (based on their current branch), falling back to serial root execution for non-Git projects. `worktree` optionally selects a base ref. Old requests without `workspace` preserve their original root/worktree semantics. No shell commands are allowed.

## Runtime — `project/.t3/runtime.json`

```json
{
  "version": 1,
  "requests": {
    "request-uuid": {
      "taskId": "task-uuid", "status": "dispatching",
      "startedAt": "2026-11-10T09:00:00.000Z", "threadId": null
    }
  }
}
```

Runtime statuses: `dispatching | completed | blocked | failed | needs_reconciliation`. Runner stores execution metadata (including thread/run IDs, bounded PR/MR snapshots, pending input count and errors), **not the full agent reply**, to keep the frequently-read runtime document small; full output remains available in the T3 thread. Legacy records may still contain a `reply` field. Runner persists `dispatching` **before** calling T3. On restart, it transitions stranded `dispatching` requests to `needs_reconciliation` and does not automatically relaunch them because the T3 thread might still be running. The first implementation uses `t3 thread start --wait --json`, so the T3 thread ID is recorded once the CLI returns; for a crash during launch, reconciliation requires inspecting T3 before manual retry.

## Consistency

Runner writes with sibling temporary file plus atomic rename (same filesystem). It skips invalid JSON without resetting it. Neither the Board nor the Agent Skill may write `runtime.json`; Runner must never rewrite `tasks.json`. **Verified upstream limitation:** T3's current `projects.writeFile` truncates the target in place (`O_TRUNC`) and is not an atomic replace. The MVP enables Board CRUD with a read-before-write comparison and the skill script uses read-compare + temporary-file rename, but neither provides **atomic cross-writer compare-and-swap**: concurrent panels or an interrupted write can still lose or corrupt task changes. Keep one active writer per project for this MVP; cross-panel CAS or atomic server-side writes remain future work. The Runner is the only writer to runtime per registered project; the runtime must not be modified by other processes.

## Browser preferences and cache

Companion stores page, lane expansion, explicit environment/project selection and project-scoped workspace defaults in `chrome.storage.local`; ephemeral tab choice is in `chrome.storage.session`. Runner and Agent Skill status caches are environment/project-scoped with verification timestamps. The cache is for display only: live actions still go through T3 RPC. No T3 credentials or cookies are copied into extension storage.

Clear Browser Data in Overview clears Companion-owned local and session storage, not project task/runtime files, T3 sign-in, installed Runner/Skill or Git worktrees. Custom T3 hosts may need browser recognition again.

## Upgrade lifecycle

The Runner controller resolves a single trusted repository commit SHA and downloads all executable files from that commit, drains running jobs, and rolls back files and version metadata if replacement/restart fails. Registry, task history and worktrees are preserved. Agent Skill Update uses `npx skills update t3-companion -p -y`; Re-install uses project-scoped `npx skills add`.

## Runner settings

Runner settings are durable at `~/.t3/runner/config.json` (or the configured runner home):
```json
{"maxConcurrent":3,"scanIntervalMs":10000}
```

The global worker limit is 1–3; the scan interval is validated between 1000–60000 ms. Both are reloaded each dispatch loop, so changing the limit does not interrupt active workers. The Overview controls Max Concurrent through the existing terminal bridge; it is **not** a browser-only preference. Runner separately re-inspects at most four relevant threads per project pass, with a 30-second per-thread throttle; failures do not infer a PR merge or completion.

The `runtime.json` entries may include `workflowStage` (`in_progress | human_review | awaiting_merge | done`), `pendingRequestCount`, `changeRequests` (`url` and `state`) and `lastInspectedAt`. Merge detection only trusts T3's linked PR/MR metadata; it never scans assistant replies, project branches or arbitrary PR mentions. Thread state may be temporarily stale while T3's PR metadata is being refreshed. No agent is instructed to update its own task status.
