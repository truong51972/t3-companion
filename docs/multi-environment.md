# Multi-environment integration decision

## Boundaries

T3 Code's web app can run against more than one environment. Its client-owned
`EnvironmentRegistry` resolves routes, creates authenticated connections and
renews credentials. The hosted `app.t3.codes` application is a **client**,
not an RPC relay for the remote environments shown in its UI.

Companion is not entitled to reuse a connection simply because a thread route
contains an environment ID. In particular, replacing `location.origin` with
another host, injecting bearer/DPoP tokens, reading localStorage or scraping
React/Effect internals is not a supported integration.

## Implemented: verified direct-host environments

- The selector lists candidate T3 browser tabs in the current window. In auto
  mode it follows the active tab; a manual selection sticks to a specific tab.
- A background tab is accessed only after the user grants Chrome host
  permission for **that specific origin**.
- `/.well-known/t3/environment` supplies the environment ID and label.
  The browser location alone is never the authority for identity.
- Each RPC rechecks the live host's descriptor and rejects an environment
  mismatch or a thread route pointing to a different environment.
- Project shell, `.t3/tasks.json`, `.t3/runtime.json`, Runner terminal and
  linked thread navigation all use the same verified tab/environment pair.
- Switching environment resets project selection, board, execution history and
  Runner status; stale in-flight file loads are ignored.
- Each physical host has its own `~/.t3/companion` and `~/.t3/runner`.
  Companion does not share Runner instances between environments.

A direct T3 host can be localhost or a custom HTTPS domain (including a
Cloudflare tunnel). It must serve T3 Web and its environment endpoints,
and the browser must already be authenticated there. A remote host reachable
directly through its own authenticated T3 Web tab follows the same rules.

## Explicitly blocked: hosted T3 Connect multiplexing

`app.t3.codes` may have remote connections in its internal client registry.
Those existing T3 Connect credentials are **not** authorized for export to
Companion. The public environment descriptor endpoint on the hosted UI origin
cannot authenticate RPC to any selected remote host. Companion rejects
this case instead of querying its own page origin for workspaces.

### Upstream integration contract needed

T3 Web would need an explicitly supported, permissioned extension interface:

1. Read-only enumerate: `[{ environmentId, label, connected, capabilities }]`.
2. User consent for the specific extension and environment (not a generic
   `window.postMessage` RPC endpoint exposed to arbitrary page scripts).
3. Execute only allowlisted RPC operations on an **explicit** `environmentId`
   through the existing client-runtime registry, under the existing session
   and server-side scope authorization; never return credentials.
4. Return structured errors on disconnect/revocation or permissions change.
5. Navigate using T3's own environment-scoped router.

T3's public `/mcp` OAuth interface is a supported alternative for a
**separately authorized** orchestration client. However, its current project
and thread toolkits do not expose the direct `projects.readFile`,
`projects.writeFile` and terminal operations required for Companion's
file-based backlog and Runner controls. It is therefore not a drop-in
replacement for this workflow.

This requires upstream T3 cooperation. Until then, a separate OAuth/DPoP
connection manager in Companion would duplicate a sensitive subsystem and
is intentionally not introduced in this MVP.

## Manual acceptance matrix

| Scenario | Expected |
| --- | --- |
| `localhost:3773`, authenticated | Descriptor verified; board, terminal and thread route target localhost environment |
| Same host through custom Cloudflare HTTPS | Descriptor verified; browser RPC upgrade and commands work (live smoke test required) |
| Two direct T3 hosts in separate tabs | Select each; grant permission to background tab; files and Runner state never leak between hosts |
| Change direct T3 tab to a thread belonging to another environment | RPC fails closed; no fallback to host environment |
| `app.t3.codes` with remote T3 Connect | Clear unsupported-integration message; no cross-environment RPC |
| Revoke host access or navigate tab to another website | Request fails; stale project data is cleared |
| Linked execution thread | Opens on verified environment's route, including when current tab is on home page |

Run `npm test`, `npm run typecheck:extension`, `npm run build:extension`
and then verify the manual cases in Chrome/Edge. CI cannot attest live T3
authentication, Cloudflare upgrade or a real T3 Connect account.
