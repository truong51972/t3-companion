# Multi-environment browser-session compatibility

## Strategy

The extension reuses **authorization already held by the selected T3 Web tab**.
This is not an in-memory WebSocket reuse: T3 does not expose a supported
extension-facing RPC interface. Companion issues separate, short-lived RPC
connections using the tab's saved authorization.

The compatibility adapter lives entirely in extension/src/bridge/page-session.ts,
separate from the Side Panel and standalone Runner.

## Flow

1. Choose a verified T3 browser tab. By default follow its native thread route;
   optionally select another environment saved in the same tab.
2. Execute a self-contained script in that tab's MAIN world. Read the existing
   browser connection catalog (IndexedDB t3code:connection-runtime,
   store catalog, key document) without modifying it.
3. Direct host: verify /.well-known/t3/environment and use the same-origin
   cookie-authenticated WebSocket.
4. Remote host: find the persisted session for the chosen environment. Read
   its existing bearer or DPoP token; for DPoP, access the non-extractable
   WebCrypto signing key (IndexedDB t3code:cloud-auth, store keys,
   key relay-dpop-proof-key).
5. Verify the remote endpoint's public environment descriptor **before**
   sending authorization, then mint a one-time WebSocket RPC ticket using
   POST /api/auth/websocket-ticket/rpc and open the remote host's /ws.
6. Return **only the RPC result** to the extension. Tokens, key objects and
   WebSocket URLs containing tickets never leave the page context.

Companion maintains the RPC allowlist; T3 still enforces session scopes.

## Boundaries and risks

- No T3 fork or Companion server; no credentials are copied to extension
  storage, logs, or the Node Runner.
- Connection selection is scoped by environmentId and the stored endpoint.
  Outside loopback, use HTTPS/WSS only. Redirects are disabled on authenticated
  requests. The descriptor must match the requested identity.
- This uses **private T3 Web storage formats**. It is a compatibility layer,
  not an official stable extension SDK; a T3 update may require an adapter fix.
- T3 Web owns access-token renewal. The adapter only reuses fresh tokens
  already persisted in the tab; it cannot renew a signed-out or expired T3
  Connect session. Open that environment in T3 Web and retry.
- This is session credential reuse, not reuse of T3's live WebSocket connection.
  There is no React/Effect runtime monkeypatch, storage mutation or socket
  interception.
- Every edit still uses upstream projects.writeFile, which offers no CAS.
  Concurrent modifications from multiple panels can race.
- CI cannot simulate a real authenticated T3 Connect browser session. The
  remote flow is **experimental** until tested in Chrome and Edge.

## Browser acceptance matrix

| Scenario | Required result |
| --- | --- |
| Localhost direct host | Same-origin cookie RPC, correct projects/tasks/Runner |
| Cloudflare direct HTTPS | Descriptor verified and WebSocket upgrade succeeds |
| Hosted T3 Web with one remote | Remote shell, file RPC and Runner act on remote host |
| Hosted T3 Web with two remotes | Follow T3 thread, or manually select any saved environment |
| Switch environment during a refresh | No stale board/Runner data or cross-environment writes |
| Expired token or disconnected remote | Clear error; never fallback to the tab's local host |
| Remote endpoint identity differs | Reject **before** sending bearer/DPoP authorization |
| Linked thread navigation | Open the chosen environment's native T3 thread route |

Run npm test, npm run typecheck:extension and npm run build:extension,
then perform the browser acceptance cases manually with a real T3 account.
