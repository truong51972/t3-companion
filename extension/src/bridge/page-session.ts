/**
 * Session-backed T3 RPC adapter. The injected function is self-contained because Chrome
 * serializes it into the T3 tab's MAIN world. No credential, URL containing a ticket,
 * or CryptoKey is ever returned to the extension/Runner.
 *
 * This reuses T3 Web's saved authorization, NOT its in-memory WebSocket connection.
 * Storage/protocol details are intentionally limited to this compatibility adapter.
 */
export type SessionEnvironment = { environmentId: string; label: string; source: 'direct' | 'session' };
type PageResult = {
  ok: boolean;
  error?: string;
  value?: unknown;
  environments?: SessionEnvironment[];
  routeEnvironmentId?: string | null;
};

async function pageOperation(
  operation: 'list' | 'describe' | 'rpc',
  preferredEnvironmentId: string,
  method: string,
  payload: unknown,
  timeoutMs: number,
): Promise<PageResult> {
  const fail = (error: string): PageResult => ({ ok: false, error });
  const reserved = new Set(['settings', 'pair', 'guest', 'auth', 'welcome', 'usage', 'connect']);
  const pathname = location.pathname.split('/').filter(Boolean);
  let routeEnvironmentId: string | null = null;
  try {
    if (pathname.length === 2 && !reserved.has(pathname[0]!)) routeEnvironmentId = decodeURIComponent(pathname[0]!);
    if (pathname.length === 3 && pathname[0] === 'threads') routeEnvironmentId = decodeURIComponent(pathname[1]!);
  } catch { /* not an environment route */ }

  function checkHttpOrigin(value: string): URL {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('Untrusted T3 session endpoint');
    }
    return url;
  }
  function checkWsOrigin(value: string): URL {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'wss:' &&
      !(url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('Untrusted T3 WebSocket endpoint');
    }
    return url;
  }
  async function readStore(dbName: string, store: string, key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(new Error('T3 browser session store is unavailable'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); resolve(null); return; }
        let done = false;
        try {
          const tx = db.transaction(store, 'readonly');
          const get = tx.objectStore(store).get(key);
          get.onsuccess = () => { if (!done) { done = true; resolve(get.result ?? null); } };
          get.onerror = () => { if (!done) { done = true; reject(new Error('Cannot read T3 session')); } };
          tx.oncomplete = () => db.close();
          tx.onabort = () => { db.close(); if (!done) reject(new Error('T3 session read aborted')); };
        } catch { db.close(); reject(new Error('T3 session storage changed')); }
      };
    });
  }

  type Catalog = {
    targets?: Array<{ _tag?: string; environmentId?: string; label?: string; connectionId?: string }>;
    profiles?: Array<{ _tag?: string; connectionId?: string; environmentId?: string; httpBaseUrl?: string; wsBaseUrl?: string; authorization?: string; label?: string }>;
    credentials?: Array<{ connectionId?: string; credential?: { token?: string } }>;
    remoteDpopTokens?: Array<{ environmentId?: string; label?: string; endpoint?: { httpBaseUrl?: string; wsBaseUrl?: string }; accessToken?: string; expiresAtEpochMs?: number; dpopThumbprint?: string }>;
  };
  let catalog: Catalog = {};
  try {
    const raw = await readStore('t3code:connection-runtime', 'catalog', 'document');
    catalog = typeof raw === 'string' ? JSON.parse(raw) as Catalog : {};
  } catch {
    if (operation !== 'list') return fail('Unable to read the current T3 Web session catalog.');
  }
  const targets = Array.isArray(catalog.targets) ? catalog.targets : [];
  const profiles = Array.isArray(catalog.profiles) ? catalog.profiles : [];
  const tokens = Array.isArray(catalog.remoteDpopTokens) ? catalog.remoteDpopTokens : [];

  let direct: { environmentId: string; label: string } | null = null;
  try {
    const response = await fetch('/.well-known/t3/environment', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (response.ok) {
      const parsed: unknown = await response.json();
      const value = parsed as { environmentId?: unknown; label?: unknown };
      if (typeof value?.environmentId === 'string' && value.environmentId) {
        direct = { environmentId: value.environmentId, label: typeof value.label === 'string' ? value.label : value.environmentId };
      }
    }
  } catch { /* Hosted T3 Web has no local execution environment. */ }

  const environments: SessionEnvironment[] = [];
  if (direct) environments.push({ ...direct, source: 'direct' });
  for (const target of targets) {
    if (typeof target.environmentId !== 'string' || !target.environmentId) continue;
    if (environments.some(item => item.environmentId === target.environmentId)) continue;
    const token = tokens.find(item => item.environmentId === target.environmentId);
    const profile = profiles.find(item => item.connectionId && item.connectionId === target.connectionId);
    environments.push({
      environmentId: target.environmentId,
      label: token?.label || profile?.label || target.label || target.environmentId,
      source: 'session',
    });
  }
  if (operation === 'list') return { ok: true, environments, routeEnvironmentId };

  // An explicit user choice overrides the URL. Auto mode follows the routed thread.
  const selected = preferredEnvironmentId || routeEnvironmentId || direct?.environmentId ||
    (environments.length === 1 ? environments[0]!.environmentId : '');
  if (!selected) return fail('Select a T3 environment in Companion or open a T3 thread.');
  const known = environments.find(item => item.environmentId === selected);
  if (!known) return fail('This environment is not present in the current T3 Web session.');
  if (operation === 'describe') return { ok: true, value: known, environments, routeEnvironmentId };

  if (!method) return fail('RPC method is missing');
  let socketUrl: URL;
  try {
    if (direct?.environmentId === selected) {
      socketUrl = new URL('/ws', location.origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'));
    } else {
      const token = tokens.find(item => item.environmentId === selected);
      const target = targets.find(item => item.environmentId === selected);
      const profile = profiles.find(item => item.connectionId && item.connectionId === target?.connectionId);
      const credential = (catalog.credentials || []).find(item => item.connectionId === target?.connectionId)?.credential?.token;

      const useDpop = !!token && !!token.endpoint && !!token.accessToken;
      if (!useDpop && (!profile || !credential || profile.authorization === 't3-connect')) {
        return fail('T3 Web has no reusable authorization for this environment. Open the environment in T3 Web and retry.');
      }
      const http = checkHttpOrigin(useDpop ? token!.endpoint!.httpBaseUrl! : profile!.httpBaseUrl!);
      const ws = checkWsOrigin(useDpop ? token!.endpoint!.wsBaseUrl! : profile!.wsBaseUrl!);
      if (http.hostname !== ws.hostname || http.port !== ws.port ||
        (http.protocol === 'https:' && ws.protocol !== 'wss:') ||
        (http.protocol === 'http:' && ws.protocol !== 'ws:')) {
        return fail('T3 session endpoints disagree; refusing to forward authentication.');
      }

      const descriptorResponse = await fetch(new URL('/.well-known/t3/environment', http).href,
        { credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!descriptorResponse.ok) return fail('Remote T3 environment descriptor is unavailable.');
      const descriptor = await descriptorResponse.json() as { environmentId?: string };
      if (descriptor.environmentId !== selected) return fail('Remote endpoint has a different environment ID.');

      let proof: ((verb: 'GET' | 'POST', url: string, accessToken: string) => Promise<string>) | undefined;
      if (useDpop) {
        if (!token || !token.accessToken || !token.dpopThumbprint ||
          typeof token.expiresAtEpochMs !== 'number' || token.expiresAtEpochMs <= Date.now() + 5000) {
          return fail('T3 Web session token expired. Open the remote environment in T3 and retry.');
        }
        const record = await readStore('t3code:cloud-auth', 'keys', 'relay-dpop-proof-key') as
          { privateKey?: CryptoKey; publicJwk?: { crv?: string; kty?: string; x?: string; y?: string }; thumbprint?: string } | null;
        if (!record?.privateKey || !record.publicJwk || record.thumbprint !== token.dpopThumbprint ||
          record.publicJwk.kty !== 'EC' || record.publicJwk.crv !== 'P-256') {
          return fail('T3 Web DPoP key is missing or no longer matches the active session.');
        }
        const bytes = (value: Uint8Array): string => btoa(Array.from(value, n => String.fromCharCode(n)).join(''))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const encode = (value: unknown): string => bytes(new TextEncoder().encode(JSON.stringify(value)));
        proof = async (verb, url, accessToken) => {
          const targetUrl = new URL(url);
          const htu = targetUrl.origin + targetUrl.pathname;
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
          const header = encode({ typ: 'dpop+jwt', alg: 'ES256', jwk: record.publicJwk });
          const claims = encode({
            htm: verb, htu, jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000),
            ath: bytes(new Uint8Array(digest)),
          });
          const input = header + '.' + claims;
          const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
            record.privateKey!, new TextEncoder().encode(input));
          return input + '.' + bytes(new Uint8Array(signature));
        };
      }

      const authorizeTicket = async (path: string): Promise<Response> => {
        const url = new URL(path, http).href;
        return fetch(url, {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: useDpop ? {
            Authorization: 'DPoP ' + token!.accessToken!,
            DPoP: await proof!('POST', url, token!.accessToken!),
          } : { Authorization: 'Bearer ' + credential! },
        });
      };
      let ticketResponse = await authorizeTicket('/api/auth/websocket-ticket/rpc');
      if (ticketResponse.status === 404) ticketResponse = await authorizeTicket('/api/auth/websocket-ticket');
      if (!ticketResponse.ok) return fail('T3 session denied WebSocket authorization (' + ticketResponse.status + ').');
      const ticket = await ticketResponse.json() as { ticket?: string };
      if (!ticket.ticket) return fail('T3 returned an invalid WebSocket ticket.');

      socketUrl = new URL(ws.href);
      if (!socketUrl.pathname || socketUrl.pathname === '/') socketUrl.pathname = '/ws';
      if (useDpop) {
        const httpSocket = socketUrl.protocol === 'wss:' ? 'https://' : 'http://';
        socketUrl.searchParams.set('dpop', await proof!('GET', httpSocket + socketUrl.host + socketUrl.pathname, ticket.ticket));
      }
      socketUrl.searchParams.set('wsTicket', ticket.ticket);
      // Ticket and DPoP proof remain in this page-context closure, never in extension messages.
    }
  } catch (error) {
    return fail('T3 session RPC setup failed: ' + (error instanceof Error ? error.message : 'unknown error'));
  }
  socketUrl.searchParams.set('orchestrationProtocol', '2');
  const requestId = crypto.randomUUID();
  return new Promise<PageResult>(resolve => {
    const socket = new WebSocket(socketUrl);
    let finished = false;
    const timer = setTimeout(() => finish(fail('T3 RPC timed out')), timeoutMs);
    function finish(value: PageResult) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* closed */ }
      resolve(value);
    }
    socket.onerror = () => finish(fail('T3 environment WebSocket failed (check session/remote availability).'));
    socket.onclose = () => finish(fail('T3 environment WebSocket closed before responding.'));
    socket.onopen = () => socket.send(JSON.stringify({ _tag: 'Request', id: requestId, tag: method, payload, headers: [] }));
    socket.onmessage = event => {
      try {
        const decoded = JSON.parse(String(event.data));
        for (const frame of (Array.isArray(decoded) ? decoded : [decoded])) {
          if (frame.requestId !== requestId) continue;
          if (frame._tag === 'Chunk' && frame.values?.length) {
            const item = frame.values[0];
            if (method === 'orchestration.subscribeShell' && item?.kind === 'snapshot') {
              finish({ ok: true, value: item.snapshot }); return;
            }
            if (method === 'terminal.observe') { finish({ ok: true, value: item }); return; }
          }
          if (frame._tag === 'Exit') {
            finish(frame.exit?._tag === 'Success'
              ? { ok: true, value: frame.exit.value }
              : fail(JSON.stringify(frame.exit?.cause || frame.exit || 'T3 RPC failed').slice(0, 900)));
            return;
          }
        }
      } catch { finish(fail('Invalid T3 RPC response')); }
    };
  });
}

async function executeInT3Tab<T>(
  tabId: number,
  operation: 'list' | 'describe' | 'rpc',
  environmentId = '',
  method = '',
  payload: unknown = null,
  timeoutMs = 12000,
): Promise<T> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: pageOperation,
    args: [operation, environmentId, method, payload, timeoutMs],
  });
  const outcome = result?.result as PageResult | undefined;
  if (!outcome?.ok) throw new Error(outcome?.error || 'No T3 Web session response');
  return outcome as T;
}

export function listSessionEnvironments(tabId: number) {
  return executeInT3Tab<{ environments: SessionEnvironment[]; routeEnvironmentId: string | null }>(tabId, 'list');
}
export async function describeSessionEnvironment(tabId: number, preferredEnvironmentId = '') {
  const result = await executeInT3Tab<{ value: SessionEnvironment }>(tabId, 'describe', preferredEnvironmentId);
  return result.value;
}
export async function sessionRpc<T>(tabId: number, environmentId: string, method: string, payload: unknown, timeoutMs = 12000) {
  const result = await executeInT3Tab<{ value: T }>(tabId, 'rpc', environmentId, method, payload, timeoutMs);
  return result.value;
}
