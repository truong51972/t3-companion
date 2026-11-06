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
    "prompt": "Find root cause and fix tests", "status": "todo", "priority": 2,
    "executionRequests": [{ "requestId": "request-uuid", "worktree": "main", "notBefore": "2026-11-10T09:00:00+07:00" }]
  }]
}
```

`status` is independent of agent execution: `todo | in_progress | review | done`. Each request ID must be unique. A task can accumulate execution requests; append a new `requestId` for an intentional rerun. `notBefore` is an optional ISO 8601 timestamp. No shell commands are allowed.

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

Runtime statuses: `dispatching | completed | blocked | failed | needs_reconciliation`. Runner persists `dispatching` **before** calling T3. On restart, it transitions stranded `dispatching` requests to `needs_reconciliation` and does not automatically relaunch them because the T3 thread might still be running. The first implementation uses `t3 thread start --wait --json`, so the T3 thread ID is recorded once the CLI returns; for a crash during launch, reconciliation requires inspecting T3 before manual retry.

## Consistency

Runner writes with sibling temporary file plus atomic rename (same filesystem). It skips invalid JSON without resetting it. Neither the Board nor the Agent Skill may write `runtime.json`; Runner must never rewrite `tasks.json`. **Verified upstream limitation:** T3's current `projects.writeFile` truncates the target in place (`O_TRUNC`) and is not an atomic replace. The MVP enables Board CRUD with a read-before-write comparison and the skill script uses read-compare + temporary-file rename, but neither provides **atomic cross-writer compare-and-swap**: concurrent panels or an interrupted write can still lose or corrupt task changes. Keep one active writer per project for this MVP; cross-panel CAS or atomic server-side writes remain future work. The Runner is the only writer to runtime per registered project; the runtime must not be modified by other processes.
