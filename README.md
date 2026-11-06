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
| P5 — Releases checker and offline/manual setup | Implemented |
| P6 — Multi-environment direct hosts | Implemented: explicit host selector, descriptor validation, isolation guards; live multi-host test required |
| P7 — Hosted T3 Web session authorization | Experimental session adapter implemented; **real Chrome/Edge T3 Connect testing remains unverified** |

### Install extension

From the repository root:

```sh
npm install
npm run build:extension
```

Open `edge://extensions` or `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select **`extension/dist/`** (not the source `extension/`). Reload the extension after every rebuild. Open T3 Web (localhost or custom Cloudflare domain) and click the Companion icon. After DOM verification, open the Side Panel.

In the Side Panel, **T3 tab → Follow active T3 tab** and **Environment → Follow T3 thread** track the current browser tab and its selected environment. For another T3 host already open in the browser, select its tab and grant permission to that specific host (you may need to click the Companion icon once on a custom domain for initial verification). The separate Environment selector also lists environments saved in that tab's existing T3 Web session. Each remote descriptor is verified independently; project data and Runner controls are scoped to the selected environment. [Architecture and acceptance matrix](docs/multi-environment.md).

Choose a T3 project, manage tasks on the Kanban board, queue execution requests with optional `notBefore`/worktree, and control the installed Runner. **The standalone Sessions tab is removed:** click a backlog card to open its latest linked T3 thread in the existing T3 tab (using T3's own UI), or see Task Details and execution history when no navigable thread exists. A task can have multiple execution requests/threads; older linked threads are available in Task Details. Task columns (`todo`, `in_progress`, `review`, `done`) are deliberately separate from agent execution status.

**Link routing:** Companion selects the environment from the active T3 Web session and verifies its actual target server descriptor. It can open a linked thread from the host's home page; it never guesses the environment from a thread or moves a thread between hosts. The current Runner uses `t3 thread start --wait --json` and writes `threadId` only after the CLI returns. An in-progress execution may therefore appear without a clickable thread link.

### Runner setup — Windows, WSL and Linux

Runner needs Node.js **22.16+** and the `t3` CLI on the selected T3 environment host.

1. Open a T3 thread in the environment and select the project in Companion.
2. Open **Runner**. The Side Panel checks its status automatically.
3. If missing, click **Install & Start Runner**. Companion downloads only the four Runner source files from a **pinned commit** into the selected host's user-level `~/.t3/companion/` (Windows: `%USERPROFILE%\.t3\companion\`). No Git clone, npm install, global npm link, systemd or shell-specific setup is needed.
4. If installed but stopped, the Side Panel automatically starts it and checks again every **15 seconds** while open. Manual **Stop** disables auto-start for that environment until **Start** is used or the toggle is re-enabled.

Runtime state remains under `~/.t3/runner/` (Windows: `%USERPROFILE%\.t3\runner\`). Runner continues working after closing the Side Panel/browser; **automatic restart is not provided when the browser and Side Panel are closed**. This is deliberately not a boot service. Opening the panel again detects and starts the installed Runner.

Runner control reuses the selected environment's authenticated T3 Terminal RPC, requiring at least one T3 thread on that host. The extension neither installs nor executes anything on an unselected environment. If Node or the T3 CLI is missing from that host's execution environment, setup/start reports an error; install those prerequisites first.

**Known MVP limitation — shell history:** T3's currently exposed terminal RPC operates a PTY (`terminal.open` / `terminal.write` / `terminal.observe`), not a native non-interactive command-execution endpoint. Companion uses an isolated terminal session, but the host shell may still retain its internal Node commands in PowerShell/Bash/Zsh command history. The one-time installer can be lengthy; status polling uses a smaller command. We intentionally do not delete or modify the user's shell history. This remains a limitation until a native headless command API is available.

**Known browser limitation — Side Panel width:** Edge/Chromium owns the resizable Side Panel frame; extensions cannot read or set its width using `chrome.sidePanel`. Companion avoids redundant `setOptions()` calls, but switching away from a T3-enabled tab may still cause Edge to hide/recreate the tab-scoped panel and reset the resized width. This is not controlled by CSS or extension storage. A global/window-wide panel could change the lifecycle but would also change the T3-only visibility behavior.

The installer is intentionally version-pinned to the implementation included in PR #1, not `main` or a moving release. A later explicit update flow can replace this minimal bootstrap.

### One-pass browser acceptance checklist

1. Build, load `extension/dist/`, confirm popup shows version and recognizes `http://localhost:3773`.
2. Visit T3 through custom `https://<your-cloudflare-domain>/`; click the Companion icon, check **Detected** and open Side Panel. On unrelated HTTPS pages it must stay disabled.
3. Switch between T3 chats and verify Side Panel remains visible; choose another project from the dropdown.
4. Create a task with title/description/prompt/priority; refresh; verify it persisted in `.t3/tasks.json`.
5. Edit title, change column, delete a test task; ensure the board reflects the changes.
6. Queue a task with optional future time and `main` worktree; inspect `.t3/tasks.json` and check the Runner picks up only eligible requests.
7. Click a task without a recorded thread: Task Details should show its prompt and history. For a task with a recorded `threadId`, click it even from the host's home page: the selected verified T3 tab should navigate to the linked environment/thread route. Verify an older execution is available from Task Details.
8. From Runner, check Status/Start/Stop/Register/Unregister. Requires at least one T3 thread on that environment host and the Node.js prerequisite.
9. Close browser; confirm Runner continues dispatching. Reopen the Side Panel and verify status polling and automatic restart if stopped.
10. Restart the Runner after interrupted work; confirm orphan `dispatching` becomes `needs_reconciliation`, never automatically relaunched.
11. Verify Check Updates/View Releases in the popup, and test on Edge and Chrome.
12. Open two direct T3 hosts in distinct tabs; select each and grant scoped host permission. Verify disjoint projects/tasks/Runner status and correct linked-thread navigation; changes on the non-selected host must never mutate the selected host.
13. In `app.t3.codes`, open a remote T3 Connect thread and verify its shell, tasks, Runner, and linked navigation. Repeat with a second remote environment via the selector.
14. Check expired session credentials and mismatched remote descriptors. Companion must fail without falling back to the tab host; CI cannot verify authenticated browser scenarios.

### Safety and current limits

- DOM fingerprinting is read-only *detection*, **not authentication**. Every RPC request is authorized independently by T3 Code's existing session and permission system.
- No access to private React/Zustand state or Companion REST API. The page-context adapter reads existing browser session authorization, but never returns credentials or stores them in the extension or Runner.
- Runner persists `dispatching` before launching the agent and does not retry ambiguous launch results automatically.
- `projects.writeFile` in upstream T3 is **not atomic** and offers no CAS operation. Companion checks the latest task before saving, but editing one project in simultaneous Side Panels is unsafe. See [bridge notes](extension/src/bridge/README.md).
- Every request binds to the selected session environment and checks the actual target's `/.well-known/t3/environment` descriptor before sending credentials.
- Hosted T3 Connect saved authorization is reused via an internal IndexedDB/DPoP compatibility adapter, not T3's live WebSocket connection. T3 Web remains responsible for token refresh. See [multi-environment decision](docs/multi-environment.md).
- This is a beta implementation; live T3 integration and Edge/Chrome tests are to be performed on the user's host. Run local checks with `npm test`, `npm run typecheck:extension`, `npm run build:extension`.
