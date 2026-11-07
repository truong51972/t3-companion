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
| P8 — Overview + project Agent Skill | Board remains default; compact metrics, Runner/Skill expanders, project skill installer and task scripts; browser acceptance pending |

### Install extension

From the repository root:

```sh
npm install
npm run build:extension
```

Open `edge://extensions` or `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select **`extension/dist/`** (not the source `extension/`). Reload the extension after every rebuild. Open T3 Web (localhost or custom Cloudflare domain) and click the Companion icon. After DOM verification, open the Side Panel.

In the Side Panel, the main header now shows only **Environment** and **Project**. The extension automatically follows the active recognized T3 tab and retains the last connected tab when you browse unrelated sites. For manual tab selection, open **Connection settings (gear)** beside the connection indicator; a custom host may first need to be verified by clicking the Companion icon on its page. The Environment selector can still target another environment saved in the chosen T3 Web session. Each target descriptor is verified independently. [Architecture and acceptance matrix](docs/multi-environment.md).

Choose a T3 project, manage tasks on the default **Board** tab, and inspect **Overview** for project metrics plus **Runner** and **Agent Skill** controls. Both service sections start collapsed; expand to see one primary action (Install/Start/Stop), a consistent compact Refresh icon, and a **More** menu for Update, Re-install, project registration and other secondary operations. Queue execution requests with optional `notBefore`/worktree and control the installed Runner in the Overview expander. **The standalone Sessions tab is removed:** click a task card to open Task Details and execution history; use the explicit Open T3 thread action to navigate to linked sessions. A task can have multiple execution requests/threads; older linked threads are available in Task Details. Board lanes are To Do, In Progress, Human Review, Awaiting Merge and Done. Runner scans T3 thread metadata (pending input and linked PR/MR state) and derives the lane without requiring agents to update task status; user drag/drop overrides auto status.

**Link routing:** Companion selects the environment from the active T3 Web session and verifies its actual target server descriptor. It can open a linked thread from the host's home page; it never guesses the environment from a thread or moves a thread between hosts. The current Runner uses `t3 thread start --wait --json` and writes `threadId` only after the CLI returns. An in-progress execution may therefore appear without a clickable thread link.

### Runner setup — Windows, WSL and Linux

Runner needs Node.js **22.16+** and the `t3` CLI on the selected T3 environment host.

1. Open a T3 thread in the environment and select the project in Companion.
2. Open **Overview → Runner** (collapsed by default). The Side Panel checks its status automatically after the initial UI render. Expand Runner for Start/Stop and Refresh; less frequent maintenance commands are under **More**.
3. If missing, click **Install & Start Runner**. Companion first fetches a fixed control adapter from a pinned commit, then installs the Runner source files into the selected host's user-level `~/.t3/companion/` (Windows: `%USERPROFILE%\\.t3\\companion\\`). Existing Runner source files are retained. No Git clone, global npm link, service, or shell-specific setup is needed. A previously installed Runner without the adapter shows **Setup required**; choose **Set up Runner controls** once.
4. If installed but stopped, the Side Panel attempts to start it once on connection when Auto-start is enabled. There is **no Side Panel Runner status polling**. Use the Runner expander's **Refresh Runner** button to check again. Manual **Stop** disables auto-start for that environment until **Start** is used or the toggle is re-enabled.

Runtime state remains under `~/.t3/runner/` (Windows: `%USERPROFILE%\.t3\runner\`). Runner continues working after closing the Side Panel/browser; **automatic restart is not provided when the browser and Side Panel are closed**. This is deliberately not a boot service. Opening the panel again detects and starts the installed Runner.

Runner control reuses the selected environment's authenticated T3 Terminal RPC, requiring at least one T3 thread on that host. The extension neither installs nor executes anything on an unselected environment. If Node or the T3 CLI is missing from that host's execution environment, setup/start reports an error; install those prerequisites first.

**Known MVP limitation — shell history:** T3's available terminal RPC uses a PTY (`terminal.open` / `terminal.write` / `terminal.observe`), not a headless command endpoint. Companion invokes a short Node launcher for routine Runner actions and a fixed project-scoped `npx skills add` wrapper. Only target paths are encoded as inert base64url arguments; no executable JavaScript is base64-encoded or evaluated. The host shell may retain these commands in PowerShell/Bash/Zsh history; Companion never alters history.

**Side Panel lifecycle and width:** Companion now uses a **window-scoped** Side Panel instead of a tab-scoped panel. Switching to another tab should no longer trigger a tab-specific panel teardown; the UI keeps the last selected verified T3 session while browsing unrelated sites. Edge/Chromium still owns the resizable Side Panel frame; extensions cannot set its width via `chrome.sidePanel`, so actual width persistence remains browser-dependent.

The Runner controller resolves the repository's default branch to one immutable SHA for each explicit Install/Update/Re-install. Existing registry, runtime, tasks and worktrees remain untouched. **Overview → Runner** exposes a persistent Max Concurrent selector (1–3, default 3) stored under `~/.t3/runner/config.json`; Runner reloads it on each dispatch pass. No background update is performed.

### Agent Skill — project-scoped, optional

**Overview → Agent Skill** (collapsed by default) checks whether `t3-companion` is installed in the project's canonical `.agents/skills/t3-companion/SKILL.md` path. It performs **one read-only T3 RPC** when opening Overview or switching projects; use **Refresh** after an external install. No repeated polling, directory scanning, or terminal execution is needed for status.

Click **Install Skill** to execute the standard `npx skills add` command on the selected T3 environment **with the selected project as working directory**. An existing T3 thread on that environment is needed for the terminal RPC. Or install manually in the project:

```sh
npx skills add truong51972/t3-companion --skill t3-companion -y
```

The `skills` CLI currently requires **Node.js 22.20+** (Node.js 24 works); Runner itself keeps its existing Node.js 22.16+ requirement. No custom skill registry, version manager, or always-on helper is needed. The installer fetches the skill from the repository's default branch; for a not-yet-merged PR, use the branch-specific source if you need to preview it.

The installed `SKILL.md` teaches coding agents to use its bundled `scripts/tasks.mjs` to list, add, update, remove, or queue tasks in `.t3/tasks.json`. **Adding a backlog task never queues execution**; `queue` explicitly creates an execution request. The script uses Node.js built-ins and temporary-file atomic rename. It never edits Runner-owned `.t3/runtime.json`.

**Concurrent editing limitation:** the skill script detects changed file content immediately before writing, but this is not an atomic cross-writer lock. The T3 extension's upstream `projects.writeFile` still lacks CAS/atomic replace. Avoid simultaneous edits of one project's tasks from multiple Side Panels/agents until a shared write path exists.

### One-pass browser acceptance checklist

1. Build, load `extension/dist/`, confirm popup shows version and recognizes `http://localhost:3773`.
2. Visit T3 through custom `https://<your-cloudflare-domain>/`; click the Companion icon, check **Detected** and open Side Panel. The popup must not start a new connection from an unverified site; an already-open window Side Panel remains available when switching tabs.
3. Switch between T3 chats and unrelated tabs; verify that the window Side Panel stays mounted (no reload) and the selected T3 session is retained; choose another project from the dropdown.
4. Create a task with title/description/prompt/priority; refresh; verify it persisted in `.t3/tasks.json`.
5. Edit title, change column, delete a test task; ensure the board reflects the changes.
6. Queue a task using Auto Worktree (default for Git). Verify Runner creates isolated runs and respects Max Concurrent; scheduled requests wait until eligible.
7. Click any task to open Task Details; dismiss using backdrop/Escape. Use Open T3 thread to navigate. Verify Human Review for pending T3 input, Awaiting Merge for an open/unverified linked PR/MR, and Done only for verified merged PR/MRs or manual drag. A closed-unmerged PR/MR requires Human Review.
8. From Overview → Runner, check Status/Start/Stop/Register/Unregister. Requires at least one T3 thread on that environment host and the Node.js prerequisite.
9. From Overview → Agent Skill, check Not installed, use Install Skill, verify Installed for the selected project, switch projects and verify separate detection. Create a task via the bundled script (no automatic execution), then explicitly queue it. Close browser; confirm Runner continues dispatching. Reopen Side Panel: verify a one-shot Runner check and Auto-start if stopped, without repeated polling.
10. Restart the Runner after interrupted work; confirm orphan `dispatching` becomes `needs_reconciliation`, never automatically relaunched.
11. Verify Check Updates/View Releases in the popup, and test on Edge and Chrome.
12. Open two direct T3 hosts in distinct tabs; auto-select the active T3 tab, or use **Connection settings** to select another and grant scoped host permission. Switch to an unrelated website and verify the selected session stays connected. Verify disjoint projects/tasks/Runner status and safe linked-thread navigation.
13. In `app.t3.codes`, open a remote T3 Connect thread and verify its shell, tasks, Runner, and linked navigation. Repeat with a second remote environment via the selector.
14. Check expired session credentials and mismatched remote descriptors. Companion must fail without falling back to the tab host; CI cannot verify authenticated browser scenarios.

### Safety and current limits

- DOM fingerprinting is read-only *detection*, **not authentication**. Every RPC request is authorized independently by T3 Code's existing session and permission system.
- No access to private React/Zustand state or Companion REST API. The page-context adapter reads existing browser session authorization, but never returns credentials or stores them in the extension or Runner.
- Runner persists `dispatching` before launching the agent and does not retry ambiguous launch results automatically.
- The **standalone Runner** scans registered projects with the configured interval (10s default), and periodically inspects T3 thread metadata, without transcript scraping. The Side Panel refreshes `runtime.json` only while active work or review/merge tracking is outstanding; Runner/Skill status still use explicit verification and cached display.
- `projects.writeFile` in upstream T3 is **not atomic** and offers no CAS operation. Companion checks the latest task before saving, but editing one project in simultaneous Side Panels is unsafe. See [bridge notes](extension/src/bridge/README.md).
- Every request binds to the selected session environment and checks the actual target's `/.well-known/t3/environment` descriptor before sending credentials.
- Hosted T3 Connect saved authorization is reused via an internal IndexedDB/DPoP compatibility adapter, not T3's live WebSocket connection. T3 Web remains responsible for token refresh. See [multi-environment decision](docs/multi-environment.md).
- This is a beta implementation; live T3 integration and Edge/Chrome tests are to be performed on the user's host. Run local checks with `npm test`, `npm run typecheck:extension`, `npm run build:extension`.

### Responsiveness and diagnostics

The Side Panel now avoids repeated Shell RPCs when the selected tab/environment is unchanged, coalesces navigation-triggered refreshes, and updates Board state after successful task writes instead of immediately re-reading both JSON files. A window-scoped panel retains UI state while changing tabs. Its page-world adapter multiplexes requests over one reusable WebSocket per selected environment, closes failed connections, and idles out unused sockets after 90 seconds; no ticket or credential is copied into extension storage. Runner status remains a one-shot terminal operation, deferred until the initial UI has rendered.

To profile real browser behavior, open DevTools for **the Side Panel** (Edge/Chrome extensions page → inspect views). Record time from panel open to Board interaction and test switching tabs, projects, editing a task, opening Overview, and refreshing Runner. Also inspect the T3 Web tab's Network → WS to verify repeated file RPCs reuse a single connection; one new WebSocket after idle timeout or environment switch is expected. Compare localhost and remote T3 with the same task data, and check that failures/timeouts recover after the next action. Automated tests cover socket sharing and connection isolation, but CI does not measure interactive browser latency.
