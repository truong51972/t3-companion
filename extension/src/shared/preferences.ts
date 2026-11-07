/** Extension-owned preferences and status snapshots. Never store T3 credentials here. */
export type WorkspaceMode = 'auto' | 'root' | 'worktree';
export type PagePreference = 'kanban' | 'overview';
export type WorkspacePreference = { mode: WorkspaceMode; baseRef: string };
export type CompanionPreferences = {
  page: PagePreference;
  manualEnvironmentId: string;
  projectByEnvironment: Record<string, string>;
  workspaceByProject: Record<string, WorkspacePreference>;
  expandedLanes: Record<string, boolean>;
};
export const PREFERENCES_KEY = 'companion:preferences:v1';
export const cacheKey = (type: 'runner' | 'skill', environmentId: string, projectRoot = '') =>
  'companion:cache:' + type + ':' + encodeURIComponent(environmentId) + ':' + encodeURIComponent(projectRoot);
export const scopeKey = (environmentId: string, projectRoot: string) =>
  environmentId + ':' + projectRoot;
export const defaultPreferences = (): CompanionPreferences => ({
  page: 'kanban',
  manualEnvironmentId: '',
  projectByEnvironment: {},
  workspaceByProject: {},
  expandedLanes: { todo: true, in_progress: true, review: true, awaiting_merge: true, done: false },
});
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, v]) =>
    typeof key === 'string' && typeof v === 'string' && key.length < 500 && v.length < 2000));
}
export function parsePreferences(value: unknown): CompanionPreferences {
  const defaults = defaultPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const input = value as Partial<CompanionPreferences>;
  const workspace: Record<string, WorkspacePreference> = {};
  if (input.workspaceByProject && typeof input.workspaceByProject === 'object') {
    for (const [key, data] of Object.entries(input.workspaceByProject)) {
      if (key.length > 1500 || !data || !['auto','root','worktree'].includes(data.mode)) continue;
      workspace[key] = { mode: data.mode, baseRef: typeof data.baseRef === 'string' ? data.baseRef.slice(0, 250) : '' };
    }
  }
  const expanded = { ...defaults.expandedLanes };
  if (input.expandedLanes && typeof input.expandedLanes === 'object') {
    for (const key of Object.keys(expanded)) {
      if (typeof input.expandedLanes[key] === 'boolean') expanded[key] = input.expandedLanes[key]!;
    }
  }
  return {
    page: input.page === 'overview' ? 'overview' : 'kanban',
    manualEnvironmentId: typeof input.manualEnvironmentId === 'string' ? input.manualEnvironmentId.slice(0, 500) : '',
    projectByEnvironment: stringRecord(input.projectByEnvironment),
    workspaceByProject: workspace,
    expandedLanes: expanded,
  };
}
export async function loadPreferences(): Promise<CompanionPreferences> {
  const stored = await chrome.storage.local.get(PREFERENCES_KEY);
  return parsePreferences(stored[PREFERENCES_KEY]);
}
export async function persistPreferences(value: CompanionPreferences): Promise<void> {
  await chrome.storage.local.set({ [PREFERENCES_KEY]: value });
}
export type CachedStatus<T> = { value: T; verifiedAt: number };
export function parseCache<T>(value: unknown, check: (v: unknown) => v is T): CachedStatus<T> | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<CachedStatus<unknown>>;
  if (typeof entry.verifiedAt !== 'number' || !Number.isFinite(entry.verifiedAt) ||
      entry.verifiedAt > Date.now() + 60_000 || !check(entry.value)) return null;
  return { value: entry.value, verifiedAt: entry.verifiedAt };
}
