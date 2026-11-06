# T3 Companion

**T3 Companion = Chromium Extension + standalone Runner + T3 Code.** Local-first and file-based, with no Companion HTTP service, database, Redis or T3 fork.

## Status (PR #1)

| Area | Status |
| --- | --- |
| P0 — Chrome/Edge popup, Side Panel, DOM detection, custom Cloudflare domain | Implemented; browser smoke test required |
| P1 — Direct, cookie-authenticated T3 WebSocket RPC | Implemented against inspected upstream contracts; live integration test required |
| P2 — Project `.t3/tasks.json` Kanban CRUD, scheduling and `runtime.json` display | Implemented; concurrent panel write limitation below |
| P3 — Runner registry, 10s polling, T3 CLI dispatch, 3 worker limit, crash recovery | Implemented; Node tests passing |
| P4 — Runner CLI management via T3 Terminal RPC | Implemented; live integration test required |
| P5 — Releases checker and offline/manual setup | Implemented; multi-environment T3 Connect bridge not yet available |

### Install extension

From the repository root:

```sh
npm install
npm run build:extension
```

Open `edge://extensions` or `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select **`extension/dist/`** (not the source `extension/`). Reload the extension after every rebuild. Open T3 Web (localhost or custom Cloudflare domain) and click the Companion icon. After DOM verification, open the Side Panel.

In the Side Panel choose a T3 project, manage tasks on the Kanban board, queue execution requests with optional `notBefore`/worktree, and control the installed Runner. **The standalone Sessions tab is removed:** click a backlog card to open its latest linked T3 thread in the existing T3 tab (using T3's own UI), or see Task Details and execution history when no navigable thread exists. A task can have multiple execution requests/threads; older linked threads are available in Task Details. Task columns (`todo`, `in_progress`, `review`, `done`) are deliberately separate from agent execution status.

**Link routing limitation:** Companion only constructs a thread route when the current T3 tab is already on a recognized `/<environmentId>/<threadId>` route. It does not guess the environment from the project, read T3 frontend state, or navigate to a different T3 environment. If the T3 tab is on its home/draft route, open any existing thread there first, then return to the task. The current Runner uses `t3 thread start --wait --json` and writes `threadId` only after the CLI returns. An in-progress execution may therefore appear without a clickable thread link.

### Quick setup Runner on the **T3 environment host** (WSL / Linux)

Requires **Node.js 22.16+** and the `t3` CLI on the same host as T3 Code. The Runner uses only Node built-ins; there is **no npm install, global npm link or shell PATH change**.

For the open PR #1 beta, clone its branch directly into the user-level T3 directory:

```sh
git clone -b feat/companion-runner-foundation https://github.com/truong51972/t3-companion.git ~/.t3/companion
node ~/.t3/companion/runner/bin/t3-runner.mjs start
```

After merge, a regular `git clone https://github.com/truong51972/t3-companion.git ~/.t3/companion` can be used instead. If the directory already exists, use `git -C ~/.t3/companion pull --ff-only` rather than cloning again.

Use **Runner → Status / Register project** in the Side Panel to finish setup. Or verify from the host terminal:

```sh
node ~/.t3/companion/runner/bin/t3-runner.mjs status
node ~/.t3/companion/runner/bin/t3-runner.mjs add /absolute/project/path
```

`~/.t3/companion/` contains the **cloned source**, while `~/.t3/runner/` remains the Runner's **data directory** (`projects.json`, log, lock). The extension invokes the script from the stable clone path if it exists, falling back to an existing global `t3-runner` command. This avoids the `zsh: command not found: t3-runner` error seen when the T3 terminal has a different npm global `PATH`.

Runner is detached and remains active after closing the browser/Side Panel, but does not automatically start after a WSL reboot. T3 itself must be available for dispatch; check `command -v node` and `command -v t3` in the **same environment** if execution fails. For optional reboot startup, use `systemd --user` later. See [file contract](docs/file-contract.md).

### One-pass browser acceptance checklist

1. Build, load `extension/dist/`, confirm popup shows version and recognizes `http://localhost:3773`.
2. Visit T3 through custom `https://<your-cloudflare-domain>/`; click the Companion icon, check **Detected** and open Side Panel. On unrelated HTTPS pages it must stay disabled.
3. Switch between T3 chats and verify Side Panel remains visible; choose another project from the dropdown.
4. Create a task with title/description/prompt/priority; refresh; verify it persisted in `.t3/tasks.json`.
5. Edit title, change column, delete a test task; ensure the board reflects the changes.
6. Queue a task with optional future time and `main` worktree; inspect `.t3/tasks.json` and check the Runner picks up only eligible requests.
7. Click a task without a recorded thread: Task Details should show its prompt and history. For a task with a recorded `threadId`, open an existing T3 thread first, then click the task: the existing T3 tab should navigate to the linked thread. Verify an older execution is available from Task Details.
8. From Runner, check Status/Start/Stop/Register/Unregister. Requires at least one T3 thread in that project, opened through T3 Code itself, and `t3-runner` available on the host.
9. Close browser; confirm `t3-runner status` on WSL still reports running, and the Runner continues dispatch.
10. Restart the Runner after interrupted work; confirm orphan `dispatching` becomes `needs_reconciliation`, never automatically relaunched.
11. Verify Check Updates/View Releases in the popup, and test on Edge and Chrome.
12. Test with T3 Connect separately; report results. The direct cookie bridge does **not** implement multiplexing to other environments from `app.t3.codes`.

### Safety and current limits

- DOM fingerprinting is read-only *detection*, **not authentication**. Every RPC request is authorized independently by T3 Code's existing session and permission system.
- No access to T3 client React/Zustand state, no cookie/token scraping, no Companion REST API.
- Runner persists `dispatching` before launching the agent and does not retry ambiguous launch results automatically.
- `projects.writeFile` in upstream T3 is **not atomic** and offers no CAS operation. Companion checks the latest task before saving, but editing one project in simultaneous Side Panels is unsafe. See [bridge notes](extension/src/bridge/README.md).
- A direct T3 Web server behind Cloudflare can use the browser cookie bridge. A hosted T3 Connect client controlling arbitrary remote environments may require its own supported integration; that portion is not complete.
- This is a beta implementation; live T3 integration and Edge/Chrome tests are to be performed on the user's host. Run local checks with `npm test`, `npm run typecheck:extension`, `npm run build:extension`.
