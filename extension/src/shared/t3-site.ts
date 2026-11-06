/** URL-level recognition only; it is not an authenticated T3 RPC handshake. */
export function isT3Web(raw?: string): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && (url.hostname === 'app.t3.codes' || url.hostname.endsWith('.t3.codes'))) return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '3773';
  } catch { return false; }
}
