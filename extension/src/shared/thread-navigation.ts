/**
 * T3 Web owns thread rendering. Companion only opens an already-linked thread,
 * using the route of the verified T3 tab. This does not infer environment IDs
 * from a thread ID or connect to a different environment.
 */
export function linkedThreadUrl(
  currentTabUrl: string,
  knownThreadIds: readonly string[],
  threadId: string,
): string | null {
  if (!threadId || !currentTabUrl) return null;
  try {
    const url = new URL(currentTabUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    // T3 Web route: /:environmentId/:threadId.
    if (segments.length !== 2 || !knownThreadIds.includes(decodeURIComponent(segments[1]!))) return null;
    const environmentId = decodeURIComponent(segments[0]!);
    if (!environmentId || environmentId === '.' || environmentId === '..') return null;
    return new URL(`/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`, url.origin).href;
  } catch {
    return null;
  }
}
