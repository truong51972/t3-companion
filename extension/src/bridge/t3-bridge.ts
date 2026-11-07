import { isSafeOrigin, isT3Web, looksLikeT3 } from '../shared/t3-site';
import { describeSessionEnvironment, sessionRpc } from './page-session';
export { listSessionEnvironments } from './page-session';
import { readableTerminalText, runnerShellCommand, terminalSubmit, type RunnerVerb } from '../shared/runner-shell';
import { skillInstallShellCommand, SKILL_PATH } from '../shared/skill-shell';

export type Project = { id: string; title: string; workspaceRoot: string; defaultModelSelection?: { instanceId: string; model: string } | null };
export type Thread = { id: string; projectId: string; title: string; status: string; modelSelection?: { instanceId: string; model: string } };
export type Shell = { projects: Project[]; threads: Thread[] };

/** Read-only DOM + PWA fingerprint check. Session access happens only in the dedicated page adapter. */
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
  // A previously verified origin (or canonical T3 domain) needs no repeated DOM
  // injection and manifest HTTP fetch on every tab update.
  if (isT3Web(tab.url)) return true;
  const { verifiedOrigins = [] } = await chrome.storage.local.get('verifiedOrigins');
  if ((verifiedOrigins as string[]).includes(new URL(tab.url).origin)) return true;
  return detectTab(tab);
}

/** Resolve the T3 Web-selected environment, or an explicitly selected session environment. */
export async function describeEnvironment(tabId: number, preferredEnvironmentId = '') {
  return describeSessionEnvironment(tabId, preferredEnvironmentId);
}

const METHOD_ALLOWLIST = new Set([
  'orchestration.subscribeShell',
  'projects.readFile', 'projects.writeFile', 'vcs.listRefs', 'server.getConfig',
  'terminal.open', 'terminal.write', 'terminal.observe', 'terminal.close',
]);

/**
 * Reuses the authorization of the T3 Web tab, including its remote DPoP session.
 * Credentials and WebSocket tickets never leave the tab's MAIN world.
 */
export async function rpc<T>(tabId: number, environmentId: string, method: string, payload: unknown, timeoutMs = 12000): Promise<T> {
  if (!METHOD_ALLOWLIST.has(method)) throw new Error('T3 RPC method not allowed: ' + method);
  return sessionRpc<T>(tabId, environmentId, method, payload, timeoutMs);
}

export async function shell(tabId: number, environmentId: string): Promise<Shell> {
  const value = await rpc<any>(tabId, environmentId, 'orchestration.subscribeShell', {});
  const threads = Array.isArray(value?.threads) ? value.threads : Array.isArray(value?.activeThreads) ? value.activeThreads : [];
  return { projects: value?.projects || [], threads };
}
/** Read-only T3 source-control discovery; never call git on the browser's local machine. */
export interface T3GitRef {
  name: string;
  current: boolean;
  isDefault: boolean;
  isRemote?: boolean;
  worktreePath: string | null;
}
export async function exploreProjectRefs(tabId: number, environmentId: string, cwd: string): Promise<T3GitRef[]> {
  const refs: T3GitRef[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 3; page++) {
    const result: { isRepo: boolean; refs: T3GitRef[]; nextCursor: number | null } =
      await rpc(tabId, environmentId, 'vcs.listRefs',
        { cwd, limit: 200, ...(cursor === null ? {} : { cursor }) }, 16000);
    if (!result.isRepo || !Array.isArray(result.refs)) break;
    refs.push(...result.refs.filter(ref => typeof ref.name === 'string' && ref.name.length > 0));
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return [...new Map(refs.map(ref => [ref.name, ref] as const)).values()];
}

/** Explicit on-demand model discovery from T3's own provider catalog. */
export async function exploreEnvironmentModels(tabId: number, environmentId: string):
  Promise<{ instanceId: string; model: string; name: string; provider: string }[]> {
  const config = await rpc<{ providers: Array<{
    instanceId: string; displayName?: string; enabled: boolean; installed: boolean;
    availability?: 'available' | 'unavailable';
    models: Array<{ slug: string; name: string }>;
  }> }>(tabId, environmentId, 'server.getConfig', {}, 16000);
  const models = new Map<string, { instanceId: string; model: string; name: string; provider: string }>();
  for (const provider of config.providers || []) {
    if (!provider.enabled || !provider.installed || provider.availability === 'unavailable') continue;
    for (const model of provider.models || []) {
      if (!model.slug) continue;
      const key = JSON.stringify([provider.instanceId, model.slug]);
      models.set(key, { instanceId: provider.instanceId, model: model.slug,
        name: model.name || model.slug, provider: provider.displayName || provider.instanceId });
    }
  }
  return [...models.values()];
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
/** A single canonical read avoids opening five WebSocket RPCs per status check.
 * npx skills installs project skills to .agents/skills, with agent links as needed. */
export async function isProjectSkillInstalled(tabId: number, environmentId: string, cwd: string): Promise<boolean> {
  const result = await rpc<{contents: string; exists?: boolean; truncated: boolean}>(
    tabId, environmentId, 'projects.readFile', { cwd, relativePath: SKILL_PATH, allowMissing: true },
  );
  if (result.exists === false) return false;
  if (result.truncated) throw new Error('Skill metadata is truncated');
  return /^name:\s*t3-companion\s*$/m.test(result.contents || '');
}

/** Runs one bounded terminal operation in the selected T3 environment. */
async function terminalCommand(tabId: number, environmentId: string, project: Project, hostThreadId: string,
  commandFor: (marker: string) => string, timeoutMs: number): Promise<string> {
  const id = crypto.randomUUID();
  const marker = `COMPANION_${crypto.randomUUID().replaceAll('-', '')}`;
  const command = commandFor(marker);
  await rpc(tabId, environmentId, 'terminal.open', { threadId: hostThreadId, terminalId: id, cwd: project.workspaceRoot });
  try {
    // Do not blindly retry writes after an ambiguous RPC timeout: that could
    // execute a non-idempotent install/register command more than once.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rpc(tabId, environmentId, 'terminal.write', { threadId: hostThreadId, terminalId: id, data: terminalSubmit(command) });
        break;
      } catch (error) {
        const definitelyNotDelivered = /terminal.*(not ready|not found|not initialized|not open|starting)/i.test(String(error));
        if (!definitelyNotDelivered || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const deadline = Date.now() + timeoutMs;
    let observations = 0;
    while (Date.now() < deadline) {
      // Short first observation for fast local status commands; bound later polls.
      const delay = observations++ === 0 ? 120 : Math.min(200 + observations * 100, 600);
      await new Promise(resolve => setTimeout(resolve, delay));
      const event = await rpc<any>(tabId, environmentId, 'terminal.observe', { threadId: hostThreadId, terminalId: id }, 4000);
      const output = readableTerminalText(String(event?.snapshot?.history || event?.history || event?.data || ''));
      // Require a complete marker line. A command echoed by the PTY contains
      // the marker as an argument but must never be mistaken for completion.
      const end = new RegExp('(?:^|\\n)' + marker + ':(0|1)(?:\\n|$)').exec(output);
      if (!end) continue;
      const before = output.slice(0, end.index);
      const results = [...before.matchAll(/(?:^|\n)T3_COMPANION_RESULT:(\{[^\r\n]*\})/g)];
      const errors = [...before.matchAll(/(?:^|\n)T3_COMPANION_ERROR:([^\r\n]*)/g)];
      const result = results.at(-1)?.[1];
      const error = errors.at(-1)?.[1];
      if (end[1] !== '0') throw new Error(error ||
        'Companion command failed on T3 host: ' + before.slice(-500).replace(/\s+/g, ' ').trim());
      if (!result) throw new Error('Companion command did not return a structured result');
      return result;
    }
    throw new Error('Companion terminal command timed out. Check the T3 host before retrying.');
  } finally {
    await rpc(tabId, environmentId, 'terminal.close', { threadId: hostThreadId, terminalId: id }).catch(() => {});
  }
}

/** Update the Git checkout only after the running worker pool has drained.
 * CLI and data paths stay stable across installs and upgrades. */
export async function runnerCommand(tabId: number, environmentId: string, project: Project, hostThreadId: string,
  verb: RunnerVerb, target?: string): Promise<string> {
  const updatingCode = ['install', 'update', 'reinstall'].includes(verb);
  // T3 identifies the selected execution host, not the user's browser OS.
  const platform = updatingCode
    ? await rpc<{environment?: {platform?: {os?: string}}}>(
      tabId, environmentId, 'server.getConfig', {}, 12000)
    : null;
  const hostOs = platform?.environment?.platform?.os;
  if (updatingCode && !['windows', 'linux', 'darwin'].includes(hostOs || ''))
    throw new Error('Cannot determine T3 execution host OS for Git install/update.');
  const command = (action: RunnerVerb) => terminalCommand(tabId, environmentId, project, hostThreadId,
    marker => runnerShellCommand(action, target, marker,
      (hostOs || 'linux') as 'windows' | 'linux' | 'darwin'),
    ['install', 'update', 'reinstall'].includes(action) ? 150000 : action === 'status' ? 18000 : 38000);
  if (verb !== 'update' && verb !== 'reinstall') return command(verb);
  const before = JSON.parse(await command('status')) as {
    installed?: boolean; running?: boolean;
    checkoutDirty?: boolean; originTrusted?: boolean;
  };
  if (!before.installed) throw new Error('Runner is not installed; clone it from Overview first.');
  if (before.checkoutDirty) throw new Error('Runner checkout has local changes; resolve them before git pull.');
  if (before.originTrusted === false) throw new Error('Runner Git origin is not the trusted repository.');
  if (!before.running) return command(verb);
  await command('stop');
  let stopped = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const snapshot = JSON.parse(await command('status')) as { running?: boolean };
    if (!snapshot.running) { stopped = true; break; }
  }
  if (!stopped) throw new Error('Runner is still draining active tasks; Git checkout was not updated.');
  try { await command(verb); }
  catch (error) {
    // A rejected ff-only pull does not alter running tasks or their durable state.
    await command('start').catch(() => {});
    throw error;
  }
  return command('start');
}

/** The installer uses npx skills add with the selected project's cwd; no automatic install. */
export function installProjectSkill(tabId: number, environmentId: string, project: Project, hostThreadId: string,
  targetProjectRoot: string, action: 'install' | 'update' | 'reinstall' = 'install'): Promise<string> {
  return terminalCommand(tabId, environmentId, project, hostThreadId,
    marker => skillInstallShellCommand(targetProjectRoot, marker, action), 105000);
}
