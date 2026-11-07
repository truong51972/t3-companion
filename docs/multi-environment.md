# Multi-environment browser-session compatibility

## Strategy

The extension reuses **authorization already held by the selected T3 Web tab**.
T3 does not expose a supported extension-facing RPC interface. Companion
maintains its **own** page-world WebSocket connection per selected environment,
reusing the tab's saved authorization only when establishing/reconnecting.
Multiple requests are multiplexed on that socket; it is not T3 Web's own socket.

The compatibility adapter lives entirely in extension/src/bridge/page-session.ts,
separate from the Side Panel and standalone Runner.

## Flow

1. The Side Panel automatically selects the active recognized T3 tab and retains
   its last connected tab while browsing unrelated sites. Manual source selection
   remains available under Connection settings; the selected tab still supplies
   its native thread route and saved environments.
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
   After connection, reuse the authenticated socket for concurrent RPC requests
   until it fails, the environment changes, or it is idle for 90 seconds.
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
- This is session credential reuse and reuse of **Companion's own** WebSocket,
  not reuse or interception of T3 Web's live connection. There is no
  React/Effect runtime monkeypatch or storage mutation.
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
| Switch environment during a refresh | No stale board/Runner data or cross-environment writes; old Companion socket is closed |
| Repeated file RPCs | One Companion WebSocket reused; concurrent responses mapped to the correct request |
| Switch tabs with the Side Panel open | Window-scoped panel remains mounted; previous verified T3 session remains selected |
| Expired token or disconnected remote | Clear error; never fallback to the tab's local host |
| Remote endpoint identity differs | Reject **before** sending bearer/DPoP authorization |
| Linked thread navigation | Open the chosen environment's native T3 thread route |

Run npm test, npm run typecheck:extension and npm run build:extension,
then perform the browser acceptance cases manually with a real T3 account.
