import { isSafeOrigin, isT3Web, looksLikeT3 } from '../shared/t3-site';
import { assertEnvironmentRoute, type EnvironmentDescriptor } from '../shared/environment-routing';
import { readableTerminalText, runnerShellCommand, type RunnerVerb } from '../shared/runner-shell';

export type Project = { id: string; title: string; workspaceRoot: string; defaultModelSelection?: { instanceId: string; model: string } | null };
export type Thread = { id: string; projectId: string; title: string; status: string; modelSelection?: { instanceId: string; model: string } };
export type Shell = { projects: Project[]; threads: Thread[] };

export async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active browser tab');
  return tab;
}

/** Read-only DOM + PWA fingerprint check. Never touches T3 React state or page storage. */
export async function detectTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.id || !isSafeOrigin(tab.url)) return false;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: async () => {
      const manifestNode = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      let manifest = false;
      if (manifestNode?.href) {
        try {
          const url = new URL(manifestNode.href, location.href);
          if (url.origin === location.origin) {
            const resp = await fetch(url.href, { credentials: 'same-origin', cache: 'force-cache' });
            if (resp.ok && /json/.test(resp.headers.get('content-type') || '')) {
              const value = await resp.json();
              manifest = value?.name === 'T3 Code' || value?.short_name === 'T3 Code';
            }
          }
        } catch { /* unavailable/unauthenticated */ }
      }
      const root = Boolean(document.getElementById('root'));
      const icon = Boolean(document.querySelector('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]'));
      const splash = Boolean(document.querySelector('#boot-shell[aria-label],#boot-shell-logo[alt="T3 Code"]'));
      const composer = Boolean(document.querySelector('[data-testid="composer-editor"]'));
      return { root, icon, manifest, splash, composer, title: /^T3 Code\b/i.test(document.title) || /\bT3 Code\b/.test(document.title) };
    }});
    const detected = looksLikeT3(result?.result || { root: false, icon: false, manifest: false, splash: false, composer: false, title: false });
    if (detected && tab.url) {
      const origin = new URL(tab.url).origin;
      const stored = await chrome.storage.local.get('verifiedOrigins');
      const verifiedOrigins = Array.isArray(stored.verifiedOrigins) ? stored.verifiedOrigins.filter((value): value is string => typeof value === 'string') : [];
      if (!verifiedOrigins.includes(origin)) await chrome.storage.local.set({ verifiedOrigins: [...verifiedOrigins, origin] });
    }
    return detected;
  } catch { return false; }
}

export async function isRecognizedTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.url || !isSafeOrigin(tab.url)) return false;
  if (await detectTab(tab)) return true;
  const { verifiedOrigins = [] } = await chrome.storage.local.get('verifiedOrigins');
  // Recognized origins remain available while the app is loading. This is not authentication.
  return (verifiedOrigins as string[]).includes(new URL(tab.url).origin) || isT3Web(tab.url);
}

/** The public server descriptor is the authority for a direct connection's environment ID. */
export async function describeEnvironment(tabId: number): Promise<EnvironmentDescriptor> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: async () => {
      try {
        const response = await fetch('/.well-known/t3/environment', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return null;
        const value = await response.json();
        if (typeof value?.environmentId !== 'string' || !value.environmentId.trim()) return null;
        return { environmentId: value.environmentId, label: typeof value.label === 'string' ? value.label : value.environmentId };
      } catch { return null; }
    },
  });
  if (!result?.result) throw new Error('This tab does not directly serve a T3 environment. Hosted T3 Connect connections require a supported upstream integration bridge.');
  assertEnvironmentRoute((await chrome.tabs.get(tabId)).url || '', result.result.environmentId);
  return result.result;
}

const METHOD_ALLOWLIST = new Set([
  'orchestration.subscribeShell', 'orchestration.launchThread', 'orchestration.dispatchCommand',
  'projects.readFile', 'projects.writeFile', 'terminal.open', 'terminal.write', 'terminal.observe', 'terminal.close',
]);

/**
 * Runs a one-shot JSON Effect RPC request in the document's MAIN world, not an
 * extension origin. The browser sends the existing HttpOnly T3 session cookie
 * on the same-origin WebSocket handshake. No cookies/tokens are read or stored.
 * This targets only the explicitly selected environment after checking its public
 * descriptor. Remote T3 Connect connections need an upstream integration bridge.
 */
export async function rpc<T>(tabId: number, environmentId: string, method: string, payload: unknown, timeoutMs = 12000): Promise<T> {
  if (!METHOD_ALLOWLIST.has(method)) throw new Error(`T3 RPC method not allowed: ${method}`);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', args: [environmentId, method, payload, timeoutMs],
    func: async (expectedEnvironmentId: string, methodName: string, input: unknown, timeout: number) => {
      // Both the descriptor and the route must match the selected environment.
      // Never silently execute on app.t3.codes or on the wrong host.
      let descriptor: { environmentId?: string };
      try {
        const response = await fetch('/.well-known/t3/environment', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('missing descriptor');
        descriptor = await response.json();
      } catch {
        return { ok: false, error: 'The selected T3 environment is not directly served by this tab; T3 Connect needs a supported upstream bridge.' };
      }
      if (!expectedEnvironmentId || descriptor.environmentId !== expectedEnvironmentId)
        return { ok: false, error: 'T3 environment changed. Refresh the Companion environment selector before retrying.' };
      const segments = location.pathname.split('/').filter(Boolean);
      if (segments.length === 2 && !['settings', 'pair', 'guest', 'auth'].includes(segments[0]!) &&
          decodeURIComponent(segments[0]!) !== expectedEnvironmentId)
        return { ok: false, error: 'T3 is showing a different remote environment. Companion will not route RPC to the page host.' };
      const socketUrl = new URL('/ws', location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'));
      // T3 Code v2 requires this protocol negotiation during the WebSocket upgrade.
      // Without it the server returns HTTP 426 before authenticating RPC calls.
      socketUrl.searchParams.set('orchestrationProtocol', '2');
      const socket = new WebSocket(socketUrl);
      const id = crypto.randomUUID();
      return new Promise<{ ok: boolean; value?: unknown; error?: string }>(resolve => {
        let done = false;
        const finish = (value: { ok: boolean; value?: unknown; error?: string }) => {
          if (done) return;
          done = true; clearTimeout(timer);
          try { socket.close(); } catch { /* ignore */ }
          resolve(value);
        };
        const timer = setTimeout(() => finish({ ok: false, error: 'T3 RPC timed out' }), timeout);
        socket.onerror = () => finish({ ok: false, error: 'T3 WebSocket connection failed (check T3 login and proxy upgrade)' });
        socket.onclose = () => finish({ ok: false, error: 'T3 WebSocket closed before a response' });
        socket.onopen = () => socket.send(JSON.stringify({ _tag: 'Request', id, tag: methodName, payload: input, headers: [] }));
        socket.onmessage = (event) => {
          try {
            const frames = JSON.parse(event.data as string);
            for (const item of (Array.isArray(frames) ? frames : [frames])) {
              if (item.requestId !== id) continue;
              if (item._tag === 'Chunk' && item.values?.length) {
                const first = item.values[0];
                // subscribeShell returns snapshot as the first streamed item.
                if (methodName === 'orchestration.subscribeShell' && first?.kind === 'snapshot') {
                  finish({ ok: true, value: first.snapshot }); return;
                }
                if (methodName === 'terminal.observe') { finish({ ok: true, value: first }); return; }
              }
              if (item._tag === 'Exit') {
                finish(item.exit?._tag === 'Success' ? { ok: true, value: item.exit.value } :
                  { ok: false, error: JSON.stringify(item.exit?.cause || item.exit || 'T3 RPC failed').slice(0, 900) });
                return;
              }
            }
          } catch (e) { finish({ ok: false, error: `Invalid T3 RPC frame: ${String(e)}` }); }
        };
      });
    },
  });
  if (!result) throw new Error('No RPC result from T3 page');
  const data = result.result;
  if (!data?.ok) throw new Error(data?.error || 'T3 RPC failed');
  return data.value as T;
}

export async function shell(tabId: number, environmentId: string): Promise<Shell> {
  const value = await rpc<any>(tabId, environmentId, 'orchestration.subscribeShell', {});
  const threads = Array.isArray(value?.threads) ? value.threads : Array.isArray(value?.activeThreads) ? value.activeThreads : [];
  return { projects: value?.projects || [], threads };
}
export async function readProjectJson<T>(tabId: number, environmentId: string, cwd: string, file: string, fallback: T): Promise<T> {
  const result = await rpc<{contents: string; exists?: boolean; truncated: boolean}>(tabId, environmentId, 'projects.readFile',
    { cwd, relativePath: `.t3/${file}`, allowMissing: true });
  if (result.exists === false) return fallback;
  if (result.truncated) throw new Error(`${file} exceeds the T3 read limit. Refusing to overwrite.`);
  return JSON.parse(result.contents) as T;
}
export async function writeProjectJson(tabId: number, environmentId: string, cwd: string, file: string, data: unknown): Promise<void> {
  await rpc(tabId, environmentId, 'projects.writeFile', { cwd, relativePath: `.t3/${file}`, contents: `${JSON.stringify(data, null, 2)}\n` });
}
export async function launchThread(tabId: number, environmentId: string, project: Project, prompt: string, fallbackModel?: { instanceId: string; model: string }): Promise<string> {
  const model = project.defaultModelSelection || fallbackModel;
  if (!model) throw new Error('Select a default model in T3 project settings or open a T3 session first');
  const result = await rpc<{threadId: string}>(tabId, environmentId, 'orchestration.launchThread', {
    commandId: crypto.randomUUID(), creationSource: 'web', threadId: crypto.randomUUID(), projectId: project.id,
    title: prompt.slice(0, 80), modelSelection: model,
    runtimeMode: 'full-access', interactionMode: 'default', workspaceStrategy: { type: 'root' },
    initialMessage: { text: prompt, attachments: [] },
  });
  return result.threadId;
}
export async function sendThread(tabId: number, environmentId: string, threadId: string, prompt: string): Promise<void> {
  await rpc(tabId, environmentId, 'orchestration.dispatchCommand', {
    type: 'message.dispatch', commandId: crypto.randomUUID(), threadId, messageId: crypto.randomUUID(),
    text: prompt, attachments: [], createdBy: 'user', creationSource: 'web', dispatchMode: { type: 'queue_after_active' },
  });
}

/** Uses the T3 terminal only to run the installed t3-runner CLI; never keeps a runner alive through the terminal. */
export async function runnerCommand(tabId: number, environmentId: string, project: Project, hostThreadId: string, verb: RunnerVerb, target?: string): Promise<string> {
  const id = crypto.randomUUID();
  const command = runnerShellCommand(verb, target);
  const marker = `COMPANION_${crypto.randomUUID().replaceAll('-', '')}`;
  await rpc(tabId, environmentId, 'terminal.open', { threadId: hostThreadId, terminalId: id, cwd: project.workspaceRoot });
  try {
    // Use a one-shot command, with a marker to distinguish output from shell prompts.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rpc(tabId, environmentId, 'terminal.write', { threadId: hostThreadId, terminalId: id, data: `${command}; printf '\\n${marker}:%s\\n' "$?"\n` });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 350));
      const event = await rpc<any>(tabId, environmentId, 'terminal.observe', { threadId: hostThreadId, terminalId: id }, 4000);
      const text = readableTerminalText(String(event?.snapshot?.history || event?.history || event?.data || ''));
      const m = new RegExp(`${marker}:(\\d+)`).exec(text);
      if (m) {
        const output = text.slice(0, m.index).slice(-4000).trim();
        if (m[1] !== '0') {
          if (m[1] === '127' && output.includes('T3_COMPANION_RUNNER_NOT_INSTALLED')) {
            throw new Error('Runner is not installed on the T3 host. Open Runner → Quick setup to install it under ~/.t3/companion.');
          }
          throw new Error(`Runner CLI exit ${m[1]}: ${output.slice(-500)}`);
        }
        return output;
      }
    }
    throw new Error('Runner terminal command timed out. Inspect T3 terminal before retrying.');
  } finally {
    await rpc(tabId, environmentId, 'terminal.close', { threadId: hostThreadId, terminalId: id }).catch(() => {});
  }
}
