/** URL recognition is only a hint. Never use a URL alone as authentication evidence. */
export function isT3Web(raw?: string): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ((url.protocol === 'https:' && (url.hostname === 'app.t3.codes' || url.hostname.endsWith('.t3.codes'))) ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '3773'));
  } catch { return false; }
}
export function isSafeOrigin(raw?: string): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
/** The fingerprint intentionally does not depend on hostname, theme or CSS classes. */
export function looksLikeT3({ root, manifest, icon, splash, composer, title }:
  { root: boolean; manifest: boolean; icon: boolean; splash: boolean; composer: boolean; title: boolean }): boolean {
  return root && manifest && icon && (title || splash || composer);
}
