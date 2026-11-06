---
name: t3-companion
summary: Manage the independent T3 Companion runner and enqueue local project work.
---

# T3 Companion control interface

Use the `t3-companion` CLI installed on the T3 Code host to manage the standalone runner.
This is an **agent-facing CLI integration**, not a native T3 Code plugin or a UI patch.

- Register a project: `t3-companion project add /absolute/project/path`
- List registered projects: `t3-companion project list`
- Start runner: `t3-companion runner start`
- Check state: `t3-companion runner status` and `t3-companion job list`
- Queue work: `t3-companion job add /absolute/project/path --prompt-file /path/to/task.md --worktree main`
- Gracefully stop new dispatch: `t3-companion runner stop`

Always ask before enqueueing consequential code changes if the user has not already authorized execution. A stop request lets running T3 agent turns finish; it does not cancel them. `--worktree` lets T3 isolate parallel runs. The runner uses the `t3` CLI installed on the host; it does not bypass T3's approvals, permissions or project membership.
