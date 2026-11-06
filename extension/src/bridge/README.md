# T3 Web browser-session RPC adapter

`t3-bridge.ts` exposes typed project, terminal and shell helpers to the Side Panel.
`page-session.ts` contains the browser-context compatibility layer for direct
and remote environment authorization.

## Direct vs. remote

- Direct host: confirm the same-origin public descriptor and open its cookie-
  authenticated WebSocket.
- Remote environment: read the **current T3 Web tab's** saved connection
  catalog, select a remote endpoint by environment ID, confirm its public
  descriptor, and use its **already saved** bearer or DPoP authorization to
  mint a one-time RPC WebSocket ticket.
- For DPoP, only the T3 page's MAIN-world code accesses the existing
  non-extractable WebCrypto key. Neither tokens, tickets nor key objects are
  returned to the Side Panel, Runner, or extension storage.
- The Side Panel lists session environments in addition to browser tabs.
  Choosing an environment does not change the tab's T3 sign-in status.

Every RPC has an explicit environment ID, a strict method allowlist, a
timeout and T3's native server-side authorization. A mismatched descriptor
fails before credentials are sent. Linked threads navigate with the
environment-scoped T3 route.

## Current limitations

- This reuses T3 Web's **saved authorization**, not its live in-memory
  WebSocket or React/Effect connection registry.
- T3 does not expose this as a stable extension SDK. IndexedDB, DPoP and
  WebSocket ticket format changes may break the adapter; keep compatibility
  handling contained in `page-session.ts`.
- The adapter does not refresh expired tokens independently. Opening or
  refreshing the environment in T3 Web lets T3 refresh its session.
- Real multi-environment Chrome/Edge + T3 Connect smoke tests are required;
  CI confirms syntax/types/unit tests only.
- Concurrent writes to the same `.t3/tasks.json` can race because T3's
  `projects.writeFile` lacks CAS.
- Terminal/Runner control needs an existing thread in that project, and
  a Runner installed on the **environment host**.

See [multi-environment architecture](../../../docs/multi-environment.md).
