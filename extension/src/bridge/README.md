# P1: Authenticated T3 RPC bridge — PoC required

T3 has the RPC methods used in the plan, but a *separate Chromium extension page* does not automatically inherit the T3 Web app's internal RPC session. We must validate the bridge with both direct localhost and T3 Connect, multiple environments, and T3's permission boundaries before enabling filesystem/terminal/session actions.

Do **not** scrape auth tokens from localStorage/IndexedDB, monkey-patch WebSocket constructors, replace the T3 DOM, or invent a local HTTP backend. No content scripts are registered in P0. A tested bridge should expose a narrow allowlist of calls only on recognized T3 tabs and should reject messages from other page origins. `projects.readFile` and `projects.writeFile` require `{cwd,relativePath}` with the latter workspace-relative; the T3 client must supply the owning environment and authenticated session.

Verified upstream contracts (pingdotgg/t3code):
- `packages/contracts/src/rpc.ts`: `projects.readFile`, `projects.writeFile`, `terminal.open`, `terminal.write`.
- `packages/contracts/src/orchestrationV2.ts`: `orchestration.launchThread`, `orchestration.subscribeShell`, `orchestration.dispatchCommand`.
- `packages/contracts/src/project.ts`: `ProjectReadFileInput` / `ProjectWriteFileInput` (both use `cwd` and `relativePath`).

No working bridge is claimed in this stage. P0 deliberately shows disconnected UI instead of fake task/session data.

## Verified blocker: non-atomic T3 file writes

In upstream `apps/server/src/workspace/WorkspaceFileSystem.ts`, `projects.writeFile` currently writes directly to the destination with `O_TRUNC` (see `WorkspaceFileSystem.writeFile`), rather than temporary file + rename. Consequently **it does not satisfy the agreed atomic-write requirement for `.t3/tasks.json`**. Do not enable extension task CRUD by directly calling `projects.writeFile` until an atomic file-update path is proven. A separate writer process/service is *not* the default solution; investigate a supported authenticated T3 Terminal RPC operation or other existing atomic operation, validate permissions, and keep the design backend-free. Concurrent editing also requires protection against lost updates, independently of atomic replacement.

Upstream source: https://github.com/pingdotgg/t3code/blob/main/apps/server/src/workspace/WorkspaceFileSystem.ts
