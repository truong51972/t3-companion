/**
 * Environment identity comes from the server's public descriptor, never from a
 * tab URL alone. A tab's session catalog must also contain the environment.
 */
/** Navigation can switch to any explicitly selected environment verified in the T3 session. */
export function environmentThreadUrl(rawUrl: string, environmentId: string, threadId: string): string | null {
  if (!environmentId || !threadId || /[\u0000-\u001f]/.test(environmentId + threadId)) return null;
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return new URL('/' + encodeURIComponent(environmentId) + '/' + encodeURIComponent(threadId), url.origin).href;
  } catch { return null; }
}
