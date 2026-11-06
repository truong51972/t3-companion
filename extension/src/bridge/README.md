# Authenticated T3 RPC bridge (direct environment)

The browser extension does not scrape T3 tokens, inspect T3 JavaScript stores, modify the T3 DOM, or expose its own REST server.

1. When the extension icon is clicked, `chrome.scripting` with `activeTab` reads only the page's DOM and its same-origin PWA manifest to detect a T3 Code page, independent of hostname (supports Cloudflare custom domains).
2. The Side Panel invokes `chrome.scripting.executeScript({world:'MAIN'})` to create a **new same-origin** WebSocket connection to the existing T3 `/ws` Effect RPC transport. Chromium supplies the browser's existing HttpOnly session cookie. Extension storage never receives that credential.
3. A strict RPC method allowlist permits only shell/project/terminal methods needed for Companion. Authorization remains enforced by the T3 server.
4. Each RPC request is one-shot and has a timeout. Terminal commands run as a short-lived T3 terminal; Runner itself is a detached standalone process.

## Limitations requiring live validation

- This does not reuse T3 Web's in-memory RPC client; it creates an independent, cookie-authenticated connection to the **environment hosting the current page**.
- A hosted `app.t3.codes` client can be connected to multiple remote environments using bearer/DPoP tokens. Those remote credentials and routes are not exposed to an independent extension. **Remote T3 Connect multi-environment RPC is not implemented**; do not claim it works without a supported integration point.
- The T3 `/ws` JSON Effect RPC frames are based on current upstream contracts. Schema changes can require bridge updates. Test on localhost and Cloudflare proxy with an authenticated T3 browser session.
- `projects.writeFile` in upstream T3 currently uses truncating writes, without compare-and-swap or atomic rename. Companion re-reads the task before edits, but **simultaneous writes from multiple panels are not fully race-free**. Do not edit the same project simultaneously in two windows until T3 supplies a transactional file-write API.
- Browser UI access is only available while `activeTab` permission covers the T3 tab. Reopen the extension popup after a tab/origin change.
- Terminal control requires an existing T3 thread in the selected project and the `t3-runner` executable on the environment host PATH. The control terminal is closed after each command; the Runner's service remains independent.

## RPC contracts inspected

- `packages/contracts/src/rpc.ts`: `projects.readFile`, `projects.writeFile`, `terminal.open`, `terminal.write`, `terminal.observe`, `terminal.close`.
- `packages/contracts/src/orchestrationV2.ts`: `orchestration.subscribeShell`, `orchestration.launchThread`, `orchestration.dispatchCommand`.
- `packages/contracts/src/terminal.ts`: `TerminalOpenInput`, `TerminalWriteInput`, `TerminalAttachStreamEvent`.
- `docs/internals/environment-auth.md`: browser WebSocket upgrades can be authenticated by a session cookie.
- `apps/server/src/workspace/WorkspaceFileSystem.ts`: `projects.writeFile` is **not** atomic.
