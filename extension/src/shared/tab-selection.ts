/**
 * Pick a T3 Web session source from candidate browser tabs.
 * Manual selection has priority; otherwise follow the active T3 tab, then
 * retain the last connected tab while the user browses unrelated pages.
 */
export type T3TabCandidate = { id?: number; active?: boolean };

export function selectT3Tab<T extends T3TabCandidate>(
  candidates: T[], manualId: number | null, previousId: number | null,
): T | undefined {
  if (manualId !== null) return candidates.find(tab => tab.id === manualId);
  return candidates.find(tab => tab.active)
    || candidates.find(tab => tab.id === previousId)
    || candidates[0];
}
