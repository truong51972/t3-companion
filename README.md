# T3 Companion

**T3 Companion = Chromium Extension (Management UI) + independent local Runner (Automation) + T3 Code (agent runtime).** A lightweight, local-first design with no database or companion HTTP backend.

## Current implementation / phase status

| Phase | Status |
| --- | --- |
| P0 Chromium MV3 popup + Side Panel + T3 site detection | Implemented in source; Chrome/Edge manual smoke test still required |
| P1 Authenticated T3 Web RPC reuse | **PoC required**; RPC methods exist upstream, but browser authentication reuse is not verified |
| P2 Project file contract | Documented and implemented in Runner; extension CRUD awaits P1 |
| P3 Standalone polling Runner | Implemented with safe at-most-once dispatch, 3-worker limit |
| P4 Extension runner management via terminal RPC | Pending P1 |
| P5 Multi-environment verification, version checker | GitHub releases check implemented; multi-env testing pending |

### Extension (Chrome / Edge)

Requires Node.js and npm to build the extension UI. In the repo root:

```bash
npm install
npm run build:extension
```

Navigate to `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, select **Load unpacked**, and choose the generated `extension/dist/` directory. This uses Manifest V3, React + Vite + TypeScript. There is no content-script injection and no local backend. The popup detects supported T3 origins and opens a persistent Side Panel. In this P0 iteration the board and management controls remain disabled until the authenticated T3 bridge is validated; this is intentional, not a fully functional MVP.

The popup can check GitHub Releases and open the latest release page. No releases published yet is handled as a non-error.

### Runner (local to each T3 environment)

Requires **Node.js 22.16+** (`--experimental-strip-types`) and T3's official `t3` CLI available on the same host. Register the projects in T3 Code first. After `npm install` in the repository root, use `npx t3-runner` locally or `npm link --workspace runner` to install the CLI alias:

```bash
t3-runner add /absolute/project/path
t3-runner list
t3-runner start
t3-runner status
t3-runner stop
```

For a smoke test without the Extension bridge, enqueue a task via the CLI:

```bash
t3-runner task add /absolute/project/path --title 'Check tests' --prompt 'Fix failing tests' --worktree main
```

Runner scans `~/.t3/runner/projects.json` every 10 seconds. Tasks and execution state live in each project's `.t3/tasks.json` and `.t3/runtime.json` respectively; see [docs/file-contract.md](docs/file-contract.md). The Runner is not kept alive by a T3 terminal. For boot persistence use your OS service manager (systemd user in Linux/WSL); `start` is a detached process, not an installed service. Stop is graceful: running T3 turns finish.

### Safety and known boundaries

- No direct Extension ↔ Runner HTTP connection, extra auth server, native T3 patch, or DOM integration.
- T3 remains owner of agent sessions, approvals, worktrees and provider execution.
- `dispatching` is written before each T3 CLI call; a crash requires explicit reconciliation to prevent duplicate sessions.
- One Runner per registry; up to 3 concurrent requests. A plain project checkout is not processed concurrently with another plain request for the same project. Use T3-managed worktrees for isolated parallel runs.
- Never overwrite invalid `tasks.json` or `runtime.json`.
- Browser UI/sidepanel: P0 operational shell only; no claim of authenticated RPC functionality yet.

Run local Runner and site detection tests with `npm test`. Extension dependency installation, build and browser smoke tests have not been run in the offline development container.