const api = 'https://api.github.com/repos/truong51972/t3-companion/releases/latest';
export const releasesPage = 'https://github.com/truong51972/t3-companion/releases';
export type LatestRelease = { version: string; url: string } | null;
export async function checkLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('tag_name' in payload) || !('html_url' in payload) || typeof payload.tag_name !== 'string' || typeof payload.html_url !== 'string') {
    throw new Error('Unexpected GitHub release response');
  }
  return { version: payload.tag_name, url: payload.html_url };
}
export function newerVersion(latest: string, current: string) {
  const numbers = (v: string) => v.replace(/^v/, '').split('.').map(s => Number(s));
  const a = numbers(latest), b = numbers(current);
  if (a.length < 3 || b.length < 3 || [...a, ...b].some(x => !Number.isInteger(x))) return false;
  return a.some((x, i) => x !== (b[i] || 0) && a.slice(0, i).every((n, j) => n === b[j]) && x > (b[i] || 0));
}
