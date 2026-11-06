import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { pageOperation } from './page-session.ts';

type Catalog = {
  targets: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  credentials: Record<string, unknown>[];
  remoteDpopTokens: Record<string, unknown>[];
};
const catalog = (): Catalog => ({ targets: [], profiles: [], credentials: [], remoteDpopTokens: [] });

function mockTab(data: Catalog, key: unknown = null, path = '/env-b/thread-1') {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const set = (name: string, value: unknown) => {
    if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  set('location', { pathname: path, origin: 'https://app.t3.codes' });
  const records = new Map<string, unknown>([
    ['t3code:connection-runtime:catalog:document', JSON.stringify(data)],
    ['t3code:cloud-auth:keys:relay-dpop-proof-key', key],
  ]);
  set('indexedDB', {
    open(dbName: string) {
      const request: any = { result: null, onsuccess: null, onerror: null };
      request.result = {
        objectStoreNames: { contains: (name: string) => ['catalog', 'keys'].includes(name) },
        close() {},
        transaction(store: string) {
          const tx: any = { oncomplete: null, onabort: null };
          tx.objectStore = () => ({
            get(id: string) {
              const getRequest: any = {
                onsuccess: null, onerror: null,
                result: records.get(dbName + ':' + store + ':' + id) ?? null,
              };
              queueMicrotask(() => {
                getRequest.onsuccess?.();
                queueMicrotask(() => tx.oncomplete?.());
              });
              return getRequest;
            },
          });
          return tx;
        },
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return {
    set,
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
}

function fakeSocket(mock: ReturnType<typeof mockTab>, urls: string[]) {
  class Socket {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(url: string | URL) {
      urls.push(String(url));
      queueMicrotask(() => this.onopen?.());
    }
    send(data: string) {
      const request = JSON.parse(data) as { id: string };
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify([{
          _tag: 'Chunk', requestId: request.id,
          values: [{ kind: 'snapshot', snapshot: { projects: [{ id: 'p-b' }], threads: [] } }],
        }]),
      }));
    }
    close() {}
  }
  mock.set('WebSocket', Socket);
}

test('lists multiple environments from one tab and selects a remote', async () => {
  const data = catalog();
  data.targets.push({ _tag: 'RelayConnectionTarget', environmentId: 'env-b', label: 'B' });
  data.targets.push({ _tag: 'RelayConnectionTarget', environmentId: 'env-c', label: 'C' });
  const mock = mockTab(data);
  try {
    mock.set('fetch', async () => json(404, {}));
    const list = await pageOperation('list', '', '', null, 1000);
    assert.equal(list.ok, true);
    assert.equal(list.routeEnvironmentId, 'env-b');
    assert.deepEqual(list.environments?.map(e => e.environmentId), ['env-b', 'env-c']);
    const described = await pageOperation('describe', 'env-c', '', null, 1000);
    assert.equal((described.value as { environmentId: string }).environmentId, 'env-c');
  } finally { mock.restore(); }
});

test('rejects a mismatched environment before sending authorization', async () => {
  const data = catalog();
  data.targets.push({ _tag: 'RelayConnectionTarget', environmentId: 'env-b' });
  data.remoteDpopTokens.push({
    environmentId: 'env-b', label: 'B',
    endpoint: { httpBaseUrl: 'https://remote.example/', wsBaseUrl: 'wss://remote.example/' },
    accessToken: 'SECRET', dpopThumbprint: 'thumb', expiresAtEpochMs: Date.now() + 120000,
  });
  const mock = mockTab(data);
  let authRequests = 0;
  try {
    mock.set('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') authRequests++;
      return url.startsWith('https://remote.example/') ?
        json(200, { environmentId: 'wrong-env' }) : json(404, {});
    });
    const result = await pageOperation('rpc', 'env-b', 'orchestration.subscribeShell', {}, 1000);
    assert.equal(result.ok, false);
    assert.match(result.error!, /different environment ID/);
    assert.equal(authRequests, 0);
  } finally { mock.restore(); }
});

test('uses bearer pairing without leaking credential or ticket to the Side Panel', async () => {
  const data = catalog();
  data.targets.push({ _tag: 'BearerConnectionTarget', environmentId: 'env-b', connectionId: 'paired' });
  data.profiles.push({
    _tag: 'BearerConnectionProfile', environmentId: 'env-b', connectionId: 'paired',
    httpBaseUrl: 'https://paired.example/', wsBaseUrl: 'wss://paired.example/',
  });
  data.credentials.push({ connectionId: 'paired', credential: { token: 'BEARER-SECRET' } });
  const mock = mockTab(data);
  const urls: string[] = [];
  let authorization = '';
  try {
    mock.set('fetch', async (url: string, init?: RequestInit) => {
      if (url === 'https://paired.example/.well-known/t3/environment')
        return json(200, { environmentId: 'env-b' });
      if (url === 'https://paired.example/api/auth/websocket-ticket/rpc') {
        authorization = new Headers(init?.headers).get('authorization') || '';
        return json(200, { ticket: 'ONE-TIME-TICKET' });
      }
      return json(404, {});
    });
    fakeSocket(mock, urls);
    const result = await pageOperation('rpc', 'env-b', 'orchestration.subscribeShell', {}, 1000);
    assert.equal(result.ok, true, result.error);
    assert.equal(authorization, 'Bearer BEARER-SECRET');
    assert.equal(new URL(urls[0]!).searchParams.get('wsTicket'), 'ONE-TIME-TICKET');
    assert.equal((result.value as any).projects[0].id, 'p-b');
    assert.ok(!JSON.stringify(result).includes('BEARER-SECRET'));
    assert.ok(!JSON.stringify(result).includes('ONE-TIME-TICKET'));
  } finally { mock.restore(); }
});

test('uses stored T3 DPoP signing key for ticket and WebSocket upgrade', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const key = {
    privateKey: pair.privateKey,
    publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    thumbprint: 'test-thumb',
  };
  const data = catalog();
  data.targets.push({ _tag: 'RelayConnectionTarget', environmentId: 'env-b' });
  data.remoteDpopTokens.push({
    environmentId: 'env-b', label: 'B',
    endpoint: { httpBaseUrl: 'https://relay.example/', wsBaseUrl: 'wss://relay.example/' },
    accessToken: 'DPOP-SECRET', dpopThumbprint: 'test-thumb',
    expiresAtEpochMs: Date.now() + 120000,
  });
  const mock = mockTab(data, key);
  const urls: string[] = [];
  let proof = '';
  try {
    mock.set('fetch', async (url: string, init?: RequestInit) => {
      if (url === 'https://relay.example/.well-known/t3/environment')
        return json(200, { environmentId: 'env-b' });
      if (url === 'https://relay.example/api/auth/websocket-ticket/rpc') {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('authorization'), 'DPoP DPOP-SECRET');
        proof = headers.get('dpop') || '';
        return json(200, { ticket: 'ONE-TIME-TICKET' });
      }
      return json(404, {});
    });
    fakeSocket(mock, urls);
    const result = await pageOperation('rpc', 'env-b', 'orchestration.subscribeShell', {}, 1000);
    assert.equal(result.ok, true, result.error);
    assert.equal(proof.split('.').length, 3);
    const url = new URL(urls[0]!);
    const upgrade = url.searchParams.get('dpop')!;
    const claims = JSON.parse(Buffer.from(upgrade.split('.')[1]!, 'base64url').toString()) as { ath: string };
    assert.equal(claims.ath, createHash('sha256').update('ONE-TIME-TICKET').digest('base64url'));
    assert.ok(!JSON.stringify(result).includes('DPOP-SECRET'));
    assert.ok(!JSON.stringify(result).includes('ONE-TIME-TICKET'));
  } finally { mock.restore(); }
});
