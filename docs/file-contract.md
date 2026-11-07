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

Task title and agent prompt are distinct; Runner sends only the prompt to T3. `status` is independent of execution: `todo | in_progress | review | done`. The Board derives In Progress and Review from the newest execution until `statusOverride` becomes true following a manual move; queuing again resets the override. Runner never edits `tasks.json`. Each request ID must be unique. A task can accumulate execution requests; append a new `requestId` for an intentional rerun. `notBefore` is an optional ISO 8601 timestamp. `workspace` is `auto | worktree | root`: auto creates isolated T3 worktrees for Git projects (based on their current branch), falling back to serial root execution for non-Git projects. `worktree` optionally selects a base ref. Old requests without `workspace` preserve their original root/worktree semantics. No shell commands are allowed.

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

Runtime statuses: `dispatching | completed | blocked | failed | needs_reconciliation`. Runner stores execution metadata (including thread/run IDs and errors), **not the full agent reply**, to keep the frequently-read runtime document small; full output remains available in the T3 thread. Legacy records may still contain a `reply` field. Runner persists `dispatching` **before** calling T3. On restart, it transitions stranded `dispatching` requests to `needs_reconciliation` and does not automatically relaunch them because the T3 thread might still be running. The first implementation uses `t3 thread start --wait --json`, so the T3 thread ID is recorded once the CLI returns; for a crash during launch, reconciliation requires inspecting T3 before manual retry.

## Consistency

Runner writes with sibling temporary file plus atomic rename (same filesystem). It skips invalid JSON without resetting it. Neither the Board nor the Agent Skill may write `runtime.json`; Runner must never rewrite `tasks.json`. **Verified upstream limitation:** T3's current `projects.writeFile` truncates the target in place (`O_TRUNC`) and is not an atomic replace. The MVP enables Board CRUD with a read-before-write comparison and the skill script uses read-compare + temporary-file rename, but neither provides **atomic cross-writer compare-and-swap**: concurrent panels or an interrupted write can still lose or corrupt task changes. Keep one active writer per project for this MVP; cross-panel CAS or atomic server-side writes remain future work. The Runner is the only writer to runtime per registered project; the runtime must not be modified by other processes.

## Browser preferences and cache

Companion stores page, lane expansion, explicit environment/project selection and project-scoped workspace defaults in `chrome.storage.local`; ephemeral tab choice is in `chrome.storage.session`. Runner and Agent Skill status caches are environment/project-scoped with verification timestamps. The cache is for display only: live actions still go through T3 RPC. No T3 credentials or cookies are copied into extension storage.

Clear Browser Data in Overview clears Companion-owned local and session storage, not project task/runtime files, T3 sign-in, installed Runner/Skill or Git worktrees. Custom T3 hosts may need browser recognition again.

## Upgrade lifecycle

The Runner controller resolves a single trusted repository commit SHA and downloads all executable files from that commit, drains running jobs, and rolls back files and version metadata if replacement/restart fails. Registry, task history and worktrees are preserved. Agent Skill Update uses `npx skills update t3-companion -p -y`; Re-install uses project-scoped `npx skills add`.
