/**
 * Environment identity comes from the server's public descriptor, never from a
 * tab URL or from the T3 web client's private connection store.
 */
export type EnvironmentDescriptor = { environmentId: string; label: string };

export function selectedThreadEnvironment(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || ['settings', 'pair', 'guest', 'auth'].includes(parts[0]!)) return null;
    return decodeURIComponent(parts[0]!);
  } catch { return null; }
}

/** Never send a workspace RPC to the page host when T3 is showing another environment. */
export function assertEnvironmentRoute(rawUrl: string, serverEnvironmentId: string): void {
  if (!serverEnvironmentId) throw new Error('T3 environment identity is missing');
  const selected = selectedThreadEnvironment(rawUrl);
  if (selected !== null && selected !== serverEnvironmentId) {
    throw new Error('T3 is showing a different environment. Companion cannot reuse T3 Connect credentials without a supported upstream bridge.');
  }
}

/** Navigation uses an environment ID established by its actual server descriptor. */
export function environmentThreadUrl(rawUrl: string, environmentId: string, threadId: string): string | null {
  if (!environmentId || !threadId || /[\u0000-\u001f]/.test(environmentId + threadId)) return null;
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    assertEnvironmentRoute(rawUrl, environmentId);
    return new URL('/' + encodeURIComponent(environmentId) + '/' + encodeURIComponent(threadId), url.origin).href;
  } catch { return null; }
}
