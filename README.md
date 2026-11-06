# T3 Companion

A small, file-based companion for [T3 Code](https://github.com/pingdotgg/t3code). One repository, two responsibilities:

- **Extension:** a thin, agent-facing management CLI (`t3-companion`), with reusable instructions in [`extension/SKILL.md`](extension/SKILL.md). No native T3 plugin API is assumed.
- **Runner:** a standalone process that polls a durable local queue and dispatches to T3's *official* `t3 thread start ... --wait --json` CLI. T3 remains responsible for agents, models, permissions and worktrees.

This is an initial vertical slice, **not** GitHub Issue synchronization or a custom agent framework. T3 Code already has native schedules and webhooks; those are not duplicated here.

## Requirements

Node.js >=22, a running T3 Code server, and the `t3` CLI on the Runner host. Register the intended projects in T3 Code first. No npm dependencies.

~~~bash
npm link
# Or invoke directly: node bin/t3-companion.mjs ...
t3-companion project add "$PWD"
t3-companion runner start
t3-companion job add "$PWD" --prompt 'Review the tests and propose fixes' --worktree main
t3-companion job list
t3-companion runner status
t3-companion runner stop
~~~

Run interactively with `t3-companion runner run` or one scan with `t3-companion runner run --once`. `runner stop` drains active jobs, not a forced agent cancellation. The detached runner writes logs to `~/.t3/runner/runner.log`. For host-managed startup across reboot, run the foreground command under your preferred process supervisor (for example a systemd user service). A future T3-specific UI integration can call the same CLI.

## Storage

Default home is `~/.t3/runner/`; override with `T3_COMPANION_HOME`. The runner never modifies `~/.t3/userdata`.

~~~text
~/.t3/runner/
  projects/<hash>.json             # {id, path} only
  jobs/pending/<uuid>.json
  jobs/running/<uuid>.json
  jobs/completed/<uuid>.json
  jobs/blocked/<uuid>.json
  jobs/failed/<uuid>.json
  jobs/interrupted/<uuid>.json
  runner.lock/owner.json           # only while running
  runner.log                        # detached process logs
~~~

Jobs are claimed by atomic filesystem rename, dispatch is capped at three concurrent jobs, and a job without `--worktree` never overlaps another job on the same project checkout. T3's `--worktree <base-ref>` is passed through explicitly; the companion does not create or delete Git worktrees itself. `--wait` reports completion, failures and requests that need user input (`blocked`).

**Crash semantics:** a job left in `running` at runner restart becomes `interrupted` and is **not automatically retried**. Its T3 thread might still be active. Inspect T3 and reconcile it before re-enqueueing to avoid duplicate work. This is at-most-once dispatch, not exactly-once execution. No automatic replay of unfinished agent turns is implemented.

## Boundaries

- Registry JSON contains only a canonical project path plus its deterministic ID.
- The queue and state files belong to the runner and are never committed to a project repository.
- Stop via a file request; no `pkill` or unverified PID termination.
- T3 CLI prompts are passed via stdin to avoid shell interpolation and exposing prompts in process arguments.
- No database, Redis, broker, HTTP server, GitHub token or bespoke T3 protocol.

## Roadmap

1. Add GitHub Issue synchronization and explicit dispatch policy once the runner foundation is validated.
2. Add an optional T3-facing management surface if T3 exposes a supported integration point.
3. Add reconciliation against T3 thread state before implementing safe resumable jobs.

Run tests with `npm test`.
