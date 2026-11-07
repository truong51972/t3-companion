import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installProjectSkill, isProjectSkillInstalled, isRecognizedTab, listSessionEnvironments, readProjectJson, runnerCommand, shell, writeProjectJson } from '../bridge/t3-bridge';
import { isSafeOrigin, isT3Web } from '../shared/t3-site';
import { environmentThreadUrl } from '../shared/environment-routing';
import { selectT3Tab } from '../shared/tab-selection';
import type { Project, Thread } from '../bridge/t3-bridge';
import type { SessionEnvironment } from '../bridge/page-session';
import { cacheKey, defaultPreferences, loadPreferences, parseCache, persistPreferences, scopeKey, type CompanionPreferences, type WorkspaceMode } from '../shared/preferences';
import '../shared/styles.css';
import './sidepanel.css';

type Status = 'todo' | 'in_progress' | 'review' | 'awaiting_merge' | 'done';
type Task = { id: string; title: string; description?: string; prompt: string; status: Status; statusOverride?: boolean; priority?: number;
  executionRequests?: { requestId: string; notBefore?: string; worktree?: string; workspace?: WorkspaceMode }[] };
type Tasks = { version: 1; tasks: Task[] };
type Runtime = { version: 1; requests: Record<string, {
  taskId: string; status: string; threadId?: string | null; error?: string | null;
  startedAt?: string; finishedAt?: string; workflowStage?: 'in_progress' | 'human_review' | 'awaiting_merge' | 'done';
  pendingRequestCount?: number; changeRequests?: {url: string; state: 'open' | 'closed' | 'merged' | 'unknown'}[];
  lastInspectedAt?: string;
}> };
type Page = 'kanban' | 'overview';
// Compact when either the panel is narrow or a tiled window is short.
// Keep this exact media query in sync with the CSS rules in sidepanel.css.
const COMPACT_BOARD_QUERY = '(max-width: 799px), (min-width: 800px) and (max-width: 1199px) and (max-height: 580px)';

function useCompactBoard(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_BOARD_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_BOARD_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

const columns: { key: Status; name: string }[] = [
  { key: 'todo', name: 'To Do' }, { key: 'in_progress', name: 'In Progress' },
  { key: 'review', name: 'Human Review' }, { key: 'awaiting_merge', name: 'Awaiting Merge' }, { key: 'done', name: 'Done' },
];
const emptyTasks = (): Tasks => ({ version: 1, tasks: [] });
const emptyRuntime = (): Runtime => ({ version: 1, requests: {} });
const blank = (): Task => ({ id: crypto.randomUUID(), title: '', description: '', prompt: '', status: 'todo', priority: 2 });
function validateTasks(data: Tasks): Tasks {
  if (data?.version !== 1 || !Array.isArray(data.tasks) || !data.tasks.every(t => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.prompt === 'string' && columns.some(c => c.key === t.status))) {
    throw new Error('Invalid tasks.json; refusing to overwrite.');
  }
  return data;
}
function validateRuntime(data: Runtime): Runtime {
  if (data?.version !== 1 || !data.requests || typeof data.requests !== 'object' || Array.isArray(data.requests)) {
    throw new Error('Invalid runtime.json; refusing to show corrupted data');
  }
  return data;
}
function App() {
  const [page, setPage] = useState<Page>('kanban');
  const [preferences, setPreferences] = useState<CompanionPreferences>(defaultPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [runnerCacheAt, setRunnerCacheAt] = useState<number | null>(null);
  const [runnerStatusError, setRunnerStatusError] = useState('');
  const [skillCacheAt, setSkillCacheAt] = useState<number | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<Status | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string; description: string; confirmLabel: string; run: () => Promise<void>; dangerous?: boolean;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void loadPreferences().then(stored => {
      if (!live) return;
      setPreferences(stored);
      setPage(stored.page);
      setManualEnvironmentId(stored.manualEnvironmentId);
      setExpandedLanes({
        todo: stored.expandedLanes.todo !== false,
        in_progress: stored.expandedLanes.in_progress !== false,
        review: stored.expandedLanes.review !== false,
        awaiting_merge: stored.expandedLanes.awaiting_merge !== false,
        done: stored.expandedLanes.done === true,
      });
    }).catch(() => {}).finally(() => { if (live) setPreferencesReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (preferencesReady) void persistPreferences(preferences).catch(() => {});
  }, [preferencesReady, preferences]);
  const compactBoard = useCompactBoard();
  const [expandedLanes, setExpandedLanes] = useState<Record<Status, boolean>>({
    todo: true, in_progress: true, review: true, awaiting_merge: true, done: false,
  });
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [environmentLabel, setEnvironmentLabel] = useState('');
  const [manualTabId, setManualTabId] = useState<number | null>(null);
  const selectedTabRef = useRef<number | null>(null);
  const connectionMenu = useRef<HTMLDetailsElement>(null);
  const [tabChoices, setTabChoices] = useState<chrome.tabs.Tab[]>([]);
  const [sessionEnvironments, setSessionEnvironments] = useState<SessionEnvironment[]>([]);
  const [manualEnvironmentId, setManualEnvironmentId] = useState('');
  const scopedKey = useRef('');
  const shellReadyScope = useRef('');
  const shellSnapshot = useRef<{ projects: Project[]; threads: Thread[] }>({ projects: [], threads: [] });
  const refreshVersion = useRef(0);
  const [recognized, setRecognized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [projectId, setProjectId] = useState('');
  const projectSelectionRef = useRef(projectId);
  projectSelectionRef.current = projectId;
  const [tasks, setTasks] = useState<Tasks>(emptyTasks());
  const [runtime, setRuntime] = useState<Runtime>(emptyRuntime());
  const [editing, setEditing] = useState<Task | null>(null);
  const [queueTarget, setQueueTarget] = useState<Task | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);
  const editorDialog = useRef<HTMLDialogElement>(null);
  const queueDialog = useRef<HTMLDialogElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const runnerProjectsMenu = useRef<HTMLDetailsElement>(null);
  const filesVersion = useRef(0);
  const shellVersion = useRef(0);
  const manualProject = useRef(false);
  const [draft, setDraft] = useState<Task>(blank());
  const [schedule, setSchedule] = useState('');
  const [worktree, setWorktree] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('auto');
  const [queueAdvancedOpen, setQueueAdvancedOpen] = useState(false);
  const [runnerResult, setRunnerResult] = useState('Not checked');
  const runnerResultRef = useRef(runnerResult);
  runnerResultRef.current = runnerResult;
  const [skillState, setSkillState] = useState<'checking' | 'installed' | 'not_installed' | 'unavailable' | 'error'>('checking');
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [runnerAutoStart, setRunnerAutoStart] = useState(true);
  const runnerAutoStartRef = useRef(true);
  const runnerActionInFlight = useRef(false);
  const runnerCheckedScope = useRef('');
  const skillCheckedProject = useRef('');
  const currentProject = useMemo(() => projects.find(p => p.id === projectId) || null, [projects, projectId]);
  const visibleThreads = threads.filter(t => t.projectId === projectId);
  const detailsTask = tasks.tasks.find(t => t.id === detailsTaskId) || null;
  const visibleRequestIds = new Set(tasks.tasks.flatMap(task => (task.executionRequests || []).map(request => request.requestId)));
  const runnerRunning = /"running"\s*:\s*(true|false)/.exec(runnerResult)?.[1];
  const runnerInstalled = /"installed"\s*:\s*(true|false)/.exec(runnerResult)?.[1];
  const runnerBridgeMissing = /"bridgeMissing"\s*:\s*true/.test(runnerResult);
  const runnerStarting = /"starting"\s*:\s*true/.test(runnerResult);
  const runnerPid = /"pid"\s*:\s*(\d+)/.exec(runnerResult)?.[1];
  const runnerError = runnerResult.startsWith('Runner check failed: ') ? runnerResult.slice('Runner check failed: '.length) : '';
  const runnerHost = threads.find(t => projects.some(p => p.id === t.projectId));
  const runnerHostProject = runnerHost && projects.find(p => p.id === runnerHost.projectId);
  const runnerHostAvailable = Boolean(runnerHost && runnerHostProject);
  const runnerStopping = /"stopRequested"\s*:\s*true/.test(runnerResult) && runnerRunning === 'true';
  const runnerVersion = /"version"\s*:\s*"([^"]+)"/.exec(runnerResult)?.[1];
  const runnerMaxConcurrent = /"maxConcurrent"\s*:\s*([1-3])/.exec(runnerResult)?.[1] || '3';
  const runnerScanInterval = /"scanIntervalMs"\s*:\s*(\d+)/.exec(runnerResult)?.[1];
  const runnerState = !runnerHostAvailable ? 'Needs session' : runnerError ? 'Error' : runnerBridgeMissing && runnerInstalled === 'true' ? 'Setup required' : runnerStarting ? 'Starting' : runnerInstalled === 'false'
    ? 'Not installed' : runnerStopping ? 'Stopping' : runnerRunning === 'true' ? 'Running' : runnerRunning === 'false' ? 'Stopped' : 'Checking';
  // Cache is only a display hint. Live RPC validation remains authoritative.
  useEffect(() => {
    if (!environmentId) return;
    let live = true;
    const key = cacheKey('runner', environmentId);
    void chrome.storage.local.get(key).then(data => {
      const cached = parseCache<string>(data[key], (v): v is string => typeof v === 'string' && v.startsWith('{'));
      if (live && cached && runnerResultRef.current === 'Not checked') {
        setRunnerResult(cached.value);
        setRunnerCacheAt(cached.verifiedAt);
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [environmentId]);
  useEffect(() => {
    if (!environmentId || !currentProject) return;
    let live = true;
    const key = cacheKey('skill', environmentId, currentProject.workspaceRoot);
    setSkillCacheAt(null);
    setSkillState('checking');
    setSkillError('');
    skillCheckedProject.current = '';
    void chrome.storage.local.get(key).then(data => {
      const cached = parseCache<'installed' | 'not_installed'>(data[key],
        (v): v is 'installed' | 'not_installed' => v === 'installed' || v === 'not_installed');
      if (live && cached) {
        setSkillState(current => current === 'checking' ? cached.value : current);
        setSkillCacheAt(cached.verifiedAt);
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [environmentId, currentProject?.workspaceRoot]);
  useEffect(() => {
    const dialog = confirmationDialog.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) dialog.showModal();
    else if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);
  useEffect(() => { const dialog = clearDialog.current; if (!dialog) return; if (confirmClear && !dialog.open) dialog.showModal(); else if (!confirmClear && dialog.open) dialog.close(); }, [confirmClear]);
  useEffect(() => { const dialog = editorDialog.current; if (!dialog) return; if (editing && !dialog.open) dialog.showModal(); else if (!editing && dialog.open) dialog.close(); }, [editing]);
  useEffect(() => { const dialog = queueDialog.current; if (!dialog) return; if (queueTarget && !dialog.open) dialog.showModal(); else if (!queueTarget && dialog.open) dialog.close(); }, [queueTarget]);
  useEffect(() => { const dialog = detailsDialog.current; if (!dialog) return; if (detailsTask && !dialog.open) dialog.showModal(); else if (!detailsTask && dialog.open) dialog.close(); }, [detailsTask]);
  function onDialogBackdrop(event: React.MouseEvent<HTMLDialogElement>, close: () => void) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) close();
  }
  // Success notices are transient; errors remain until the next action.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const menus = () => [
      runnerProjectsMenu.current,
      connectionMenu.current,
      ...Array.from(document.querySelectorAll<HTMLDetailsElement>('.task-more[open]')),
    ];
    const closeOnOutsideClick = (event: PointerEvent) => {
      const path = event.composedPath();
      for (const menu of menus()) if (menu?.open && !path.includes(menu)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      for (const menu of menus()) if (menu?.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const refreshShell = useCallback(async (id: number, url: string, environmentId: string) => {
    const version = ++shellVersion.current;
    const next = await shell(id, environmentId);
    if (version !== shellVersion.current) return;
    shellSnapshot.current = next;
    setProjects(old => JSON.stringify(old) === JSON.stringify(next.projects) ? old : next.projects);
    setThreads(old => JSON.stringify(old) === JSON.stringify(next.threads) ? old : next.threads);
    // Match a thread id from the authenticated shell to a complete URL segment.
    // The URL is an orientation hint, not authentication or a DOM-based guess.
    const segments = url ? new URL(url).pathname.split('/') : [];
    const activeThread = next.threads.find(t => segments.includes(t.id));
    setProjectId(old => {
      const saved = preferencesRef.current.projectByEnvironment[environmentId];
      if (manualProject.current && saved && next.projects.some(p => p.id === saved)) return saved;
      if (!manualProject.current && activeThread && next.projects.some(p => p.id === activeThread.projectId)) return activeThread.projectId;
      return next.projects.some(p => p.id === old) ? old : next.projects[0]?.id || '';
    });
  }, []);
  const refreshFiles = useCallback(async (id: number, environmentId: string, project: Project) => {
    const key = id + ':' + environmentId;
    // An older action must not invalidate or overwrite a newer environment's data.
    if (scopedKey.current !== key) return;
    const version = ++filesVersion.current;
    const [nextTasks, nextRuntime] = await Promise.all([
      readProjectJson<Tasks>(id, environmentId, project.workspaceRoot, 'tasks.json', emptyTasks()),
      readProjectJson<Runtime>(id, environmentId, project.workspaceRoot, 'runtime.json', emptyRuntime()),
    ]);
    const checkedTasks = validateTasks(nextTasks), checkedRuntime = validateRuntime(nextRuntime);
    if (version !== filesVersion.current || scopedKey.current !== key) return;
    setTasks(checkedTasks); setRuntime(checkedRuntime);
  }, []);
  const refresh = useCallback(async (forceShell = false) => {
    const version = ++refreshVersion.current;
    setBusy(true); setError('');
    try {
      // Tabs only supply candidate addresses. Their server descriptors supply identities.
      const [tabs, stored] = await Promise.all([
        chrome.tabs.query({ currentWindow: true }), chrome.storage.local.get('verifiedOrigins'),
      ]);
      const verified = new Set(Array.isArray(stored.verifiedOrigins) ? stored.verifiedOrigins as string[] : []);
      const eligible = tabs.filter(t => t.id !== undefined && t.url && isSafeOrigin(t.url) &&
        (isT3Web(t.url) || verified.has(new URL(t.url).origin)));
      // Edge may recreate the tab-scoped Side Panel. Restore the last connected
      // T3 session from ephemeral browser storage when this panel remounts.
      const windowId = tabs[0]?.windowId;
      if (selectedTabRef.current === null && windowId !== undefined) {
        const storageKey = 'lastT3Tab:' + windowId;
        const saved = await chrome.storage.session.get(storageKey);
        if (Number.isInteger(saved[storageKey])) selectedTabRef.current = saved[storageKey] as number;
      }
      setTabChoices(eligible);
      // Prefer an active T3 tab, but keep the last selected T3 tab while browsing
      // unrelated pages. Manual tab selection always takes precedence.
      const tab = selectT3Tab(eligible, manualTabId, selectedTabRef.current);
      if (!tab?.id || !tab.url || !await isRecognizedTab(tab)) throw new Error('Open and verify a T3 Web tab to connect.');
      // One session snapshot supplies both environment choices and the current route.
      const session = await listSessionEnvironments(tab.id);
      if (version !== refreshVersion.current) return;
      setSessionEnvironments(old => JSON.stringify(old) === JSON.stringify(session.environments) ? old : session.environments);
      const selectedEnvironment = session.environments.some(item => item.environmentId === manualEnvironmentId) ? manualEnvironmentId : '';
      const target = selectedEnvironment || session.routeEnvironmentId ||
        session.environments.find(item => item.source === 'direct')?.environmentId ||
        (session.environments.length === 1 ? session.environments[0]!.environmentId : '');
      const descriptor = session.environments.find(item => item.environmentId === target);
      if (!descriptor) throw new Error('Select a T3 environment in Companion or open a T3 thread.');
      const key = tab.id + ':' + descriptor.environmentId;
      const scopeChanged = scopedKey.current !== key;
      if (scopeChanged) {
        scopedKey.current = key;
        ++filesVersion.current; ++shellVersion.current;
        manualProject.current = Boolean(preferencesRef.current.projectByEnvironment[descriptor.environmentId]);
        setProjects([]); setThreads([]); setProjectId('');
        setTasks(emptyTasks()); setRuntime(emptyRuntime()); setRunnerCacheAt(null); setSkillCacheAt(null);
        setDetailsTaskId(null); setEditing(null); setQueueTarget(null); setRunnerResult('Not checked'); setRunnerStatusError(''); setNotice('');
      }
      selectedTabRef.current = tab.id;
      if (tab.windowId !== undefined) {
        void chrome.storage.session.set({ ['lastT3Tab:' + tab.windowId]: tab.id });
      }
      setTabId(tab.id); setTabUrl(tab.url); setEnvironmentId(descriptor.environmentId);
      setEnvironmentLabel(descriptor.label); setRecognized(true);
      if (forceShell || scopeChanged || shellReadyScope.current !== key) {
        await refreshShell(tab.id, tab.url, descriptor.environmentId);
        if (version !== refreshVersion.current) return;
        shellReadyScope.current = key;
      } else if (!manualProject.current) {
        const segments = new URL(tab.url).pathname.split('/');
        const active = shellSnapshot.current.threads.find(thread => segments.includes(thread.id));
        if (active && shellSnapshot.current.projects.some(project => project.id === active.projectId))
          setProjectId(old => old === active.projectId ? old : active.projectId);
      }
    } catch (e) {
      if (version !== refreshVersion.current) return;
      ++filesVersion.current; ++shellVersion.current;
      shellReadyScope.current = ''; shellSnapshot.current = { projects: [], threads: [] };
      setRecognized(false); setProjects([]); setThreads([]); setProjectId('');
      setTasks(emptyTasks()); setRuntime(emptyRuntime()); setRunnerResult('Not checked');
      setEnvironmentId(''); setEnvironmentLabel(''); setTabId(null); scopedKey.current = ''; setNotice('');
      setError(String(e));
    } finally { if (version === refreshVersion.current) setBusy(false); }
  }, [manualTabId, manualEnvironmentId, refreshShell]);
  useEffect(() => { if (preferencesReady) void refresh(); }, [refresh, preferencesReady]);
  useEffect(() => {
    filesVersion.current++;
    setTasks(emptyTasks()); setRuntime(emptyRuntime());
    if (!tabId || !environmentId || !currentProject || !recognized) return;
    let active = true;
    const key = scopedKey.current;
    void refreshFiles(tabId, environmentId, currentProject).catch(e => { if (active && scopedKey.current === key) setError(String(e)); });
    return () => { active = false; filesVersion.current++; };
  }, [tabId, environmentId, projectId, recognized, refreshFiles, currentProject?.workspaceRoot]);
  useEffect(() => {
    const changed = ({ tabId: activeId }: chrome.tabs.OnActivatedInfo) => {
      if (manualTabId !== null || activeId === selectedTabRef.current) return;
      // An unrelated website is not a reason to discard an authenticated T3 session.
      void (async () => {
        try {
          const tab = await chrome.tabs.get(activeId);
          if (!tab.url || !isSafeOrigin(tab.url)) return;
          const stored = await chrome.storage.local.get('verifiedOrigins');
          const verified = Array.isArray(stored.verifiedOrigins) ? stored.verifiedOrigins as string[] : [];
          if (isT3Web(tab.url) || verified.includes(new URL(tab.url).origin)) await refresh();
        } catch { /* tab closed during activation */ }
      })();
    };
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const updated = (id: number, change: { url?: string; status?: string }) => {
      if (id !== (manualTabId ?? selectedTabRef.current) || (!change.url && change.status !== 'complete')) return;
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => { updateTimer = null; void refresh(); }, 180);
    };
    const removed = (id: number) => {
      if (id === manualTabId) setManualTabId(null);
      else if (id === selectedTabRef.current) {
        selectedTabRef.current = null;
        void refresh();
      }
    };
    chrome.tabs.onActivated.addListener(changed);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    return () => {
      chrome.tabs.onActivated.removeListener(changed);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      if (updateTimer) clearTimeout(updateTimer);
    };
  }, [refresh, manualTabId]);

  // Project task definitions are read only on user action or context change.
  // Active execution metadata alone may be polled, avoiding expensive task re-reads.
  // This is bounded and stops when all requests settle or repeated RPCs fail.
  // Runner status is also checked only once per selected environment.
  useEffect(() => {
    if (!tabId || !environmentId || !recognized) return;
    if (!runnerHost || !runnerHostProject) return; // T3 terminal RPC needs a thread.
    const scope = tabId + ':' + environmentId;
    if (runnerCheckedScope.current === scope) return;
    runnerCheckedScope.current = scope;
    const flag = 'runnerAutoStartDisabled:' + environmentId;
    let active = true;
    const timer = setTimeout(() => { void (async () => {
      try {
        const saved = await chrome.storage.local.get(flag);
        const enabled = saved[flag] !== true;
        if (!active || scopedKey.current !== scope || runnerActionInFlight.current) return;
        runnerAutoStartRef.current = enabled;
        setRunnerAutoStart(enabled);
        runnerActionInFlight.current = true;
        const output = await runnerCommand(tabId, environmentId, runnerHostProject, runnerHost.id, 'status');
        if (!active || scopedKey.current !== scope) return;
        const status = JSON.parse(output) as { installed?: boolean; running?: boolean; bridgeMissing?: boolean };
        setRunnerCacheAt(null);
        setRunnerStatusError('');
        void chrome.storage.local.set({ [cacheKey('runner', environmentId)]: { value: output, verifiedAt: Date.now() } });
        if (status.installed && !status.bridgeMissing && !status.running && enabled && runnerAutoStartRef.current) {
          const started = await runnerCommand(tabId, environmentId, runnerHostProject, runnerHost.id, 'start');
          if (active && scopedKey.current === scope) {
            setRunnerResult(started);
            void chrome.storage.local.set({ [cacheKey('runner', environmentId)]: { value: started, verifiedAt: Date.now() } });
          }
        } else {
          setRunnerResult(output);
        }
      } catch (error) {
        if (active && scopedKey.current === scope) {
          setRunnerStatusError(String(error));
          setRunnerResult(current => current.startsWith('{') ? current : 'Runner check failed: ' + String(error));
        }
      } finally {
        runnerActionInFlight.current = false;
      }
    })(); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [tabId, environmentId, recognized, runnerHost?.id, runnerHostProject?.id]);

  // Lightweight live-status refresh only while there are outstanding executions.
  // No project/Runner/Skill polling during idle browsing.
  useEffect(() => {
    if (!tabId || !environmentId || !currentProject || !recognized || page !== 'kanban') return;
    const hasOutstanding = tasks.tasks.some(task => (task.executionRequests || []).some(request => {
      const status = runtime.requests[request.requestId]?.status;
      return !status || status === 'dispatching';
    }));
    if (!hasOutstanding) return;
    let failures = 0;
    let pending = false;
    const key = scopedKey.current, project = currentProject, selected = projectId;
    const timer = setInterval(() => {
      if (pending || document.visibilityState !== 'visible' || scopedKey.current !== key) return;
      pending = true;
      void readProjectJson<Runtime>(tabId, environmentId, project.workspaceRoot, 'runtime.json', emptyRuntime())
        .then(data => {
          if (scopedKey.current !== key || projectSelectionRef.current !== selected) return;
          const valid = validateRuntime(data);
          failures = 0;
          setRuntime(old => JSON.stringify(old) === JSON.stringify(valid) ? old : valid);
        })
        .catch(() => { if (++failures >= 2) clearInterval(timer); })
        .finally(() => { pending = false; });
    }, 15000);
    return () => clearInterval(timer);
  }, [tabId, environmentId, currentProject?.workspaceRoot, projectId, recognized, page, tasks, runtime]);

  // Skill checks are read-only project RPC calls; avoid extra terminal history.
  useEffect(() => {
    if (page !== 'overview') return;
    if (!tabId || !environmentId || !currentProject || !recognized) {
      setSkillState('unavailable');
      return;
    }
    let active = true;
    const key = scopedKey.current;
    const projectKey = key + ':' + currentProject.workspaceRoot;
    if (skillCheckedProject.current === projectKey) return;
    setSkillState('checking'); setSkillError('');
    void isProjectSkillInstalled(tabId, environmentId, currentProject.workspaceRoot)
      .then(installed => {
        if (active && scopedKey.current === key && projectSelectionRef.current === projectId) {
          skillCheckedProject.current = projectKey;
          setSkillCacheAt(null);
          const state = installed ? 'installed' : 'not_installed';
          setSkillState(state);
          void chrome.storage.local.set({ [cacheKey('skill', environmentId, currentProject.workspaceRoot)]: { value: state, verifiedAt: Date.now() } });
        }
      })
      .catch(error => {
        if (active && scopedKey.current === key && projectSelectionRef.current === projectId) {
          skillCheckedProject.current = projectKey;
          setSkillState(current => current === 'installed' || current === 'not_installed' ? current : 'error');
          setSkillError(String(error));
        }
      });
    return () => { active = false; };
  }, [page, tabId, environmentId, projectId, currentProject?.workspaceRoot, recognized]);

  useEffect(() => { setDetailsTaskId(null); }, [projectId]);
  async function refreshProjectData() {
    if (!tabId || !environmentId || !currentProject) return;
    const key = scopedKey.current;
    const selectedProjectId = projectId;
    setBusy(true); setError('');
    try { await refreshFiles(tabId, environmentId, currentProject); }
    catch (e) {
      if (scopedKey.current === key && projectSelectionRef.current === selectedProjectId) setError(String(e));
    } finally {
      if (scopedKey.current === key && projectSelectionRef.current === selectedProjectId) setBusy(false);
    }
  }
  async function action(f: () => Promise<void>) {
    if (!tabId || !environmentId || !currentProject) return;
    const key = scopedKey.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await f();
      // The action already updates its own state; avoid redundant project reads.
    } catch (e) { if (scopedKey.current === key) setError(String(e)); }
    finally { if (scopedKey.current === key) setBusy(false); }
  }
  async function mutateTask(taskId: string, update: (old: Tasks) => Tasks, original?: Task) {
    if (!tabId || !environmentId || !currentProject) return;
    const fresh = validateTasks(await readProjectJson<Tasks>(tabId, environmentId, currentProject.workspaceRoot, 'tasks.json', emptyTasks()));
    const current = fresh.tasks.find(t => t.id === taskId);
    if (original && JSON.stringify(original) !== JSON.stringify(current)) throw new Error('Task changed in another panel. Refresh before editing again.');
    const next = update(fresh);
    validateTasks(next);
    const key = scopedKey.current;
    await writeProjectJson(tabId, environmentId, currentProject.workspaceRoot, 'tasks.json', next);
    if (scopedKey.current === key && projectSelectionRef.current === projectId) {
      ++filesVersion.current; // invalidate older asynchronous file refreshes
      setTasks(next);
      setNotice('Saved to .t3/tasks.json');
    }
  }
  function edit(task?: Task) { const value = task ? structuredClone(task) : blank(); setEditing(value); setDraft(value); }
  function requestExecution(task: Task) {
    setSchedule('');
    const saved = preferencesRef.current.workspaceByProject[scopeKey(environmentId, currentProject?.workspaceRoot || '')];
    setWorkspaceMode(saved?.mode || 'auto');
    setWorktree(saved?.baseRef || '');
    setQueueAdvancedOpen(false);
    setQueueTarget(task);
  }
  function rememberWorkspace(mode: WorkspaceMode, baseRef: string) {
    if (!currentProject) return;
    setPreferences(p => ({ ...p, workspaceByProject: {
      ...p.workspaceByProject, [scopeKey(environmentId, currentProject.workspaceRoot)]: { mode, baseRef },
    } }));
  }
  async function saveTask() {
    if (!draft.title.trim() || !draft.prompt.trim()) throw new Error('Title and prompt are required');
    const original = tasks.tasks.find(t => t.id === draft.id);
    await mutateTask(draft.id, document => ({ ...document, tasks: original
      ? document.tasks.map(t => t.id === draft.id ? structuredClone(draft) : t)
      : [...document.tasks, structuredClone(draft)] }), original);
    setEditing(null);
  }
  async function enqueue(task: Task) {
    // Automatically register before persisting work; otherwise newly queued
    // project tasks can remain forever invisible to an installed Runner.
    // Registration is idempotent and happens only for a verified installation.
    if (runnerInstalled === 'true' && !runnerBridgeMissing && runnerHostAvailable)
      await manageRunner('add');
    const when = schedule ? new Date(schedule).toISOString() : undefined;
    await mutateTask(task.id, document => ({ ...document, tasks: document.tasks.map(t => t.id === task.id
      ? { ...t, status: 'todo' as Status, statusOverride: false, executionRequests: [...(t.executionRequests || []), { requestId: crypto.randomUUID(), ...(when ? { notBefore: when } : {}), ...(workspaceMode !== 'root' && worktree.trim() ? { worktree: worktree.trim() } : {}), workspace: workspaceMode }] }
      : t) }), task);
    setSchedule('');
    const ready = runnerInstalled === 'true' && runnerRunning === 'true' && runnerHostAvailable;
    setNotice(ready ? 'Queued. Runner will dispatch when eligible.' :
      'Queued. Open Overview to verify Runner setup and project registration before execution.');
  }
  const taskExecution = (task: Task) => {
    const req = task.executionRequests?.at(-1); return req ? runtime.requests[req.requestId] : null;
  };
  const taskColumn = (task: Task): Status => {
    if (task.statusOverride || task.status === 'done' || task.status === 'review' || task.status === 'awaiting_merge') return task.status;
    const execution = taskExecution(task);
    if (execution?.workflowStage === 'done') return 'done';
    if (execution?.workflowStage === 'awaiting_merge') return 'awaiting_merge';
    if (execution?.workflowStage === 'human_review') return 'review';
    if (execution?.workflowStage === 'in_progress') return 'in_progress';
    const status = execution?.status;
    if (status === 'dispatching') return 'in_progress';
    if (status === 'completed' || status === 'blocked' || status === 'failed' || status === 'needs_reconciliation')
      return 'review';
    return task.status;
  };
  const taskRequests = (task: Task) => [...(task.executionRequests || [])].reverse().map(request => ({
    request,
    execution: runtime.requests[request.requestId],
  }));
  const taskLinkedThread = (task: Task) => taskRequests(task)
    .map(item => item.execution?.threadId)
    .find((id): id is string => typeof id === 'string' && id.length > 0);
  const threadUrl = (threadId: string) => environmentThreadUrl(tabUrl, environmentId, threadId);

  async function openLinkedThread(threadId: string) {
    const url = threadUrl(threadId);
    if (!url || !tabId) return false;
    try {
      await chrome.tabs.update(tabId, { url, active: true });
      setDetailsTaskId(null);
      return true;
    } catch (e) {
      setError(`Cannot open T3 thread: ${String(e)}`);
      return false;
    }
  }
  function openTask(task: Task) { setDetailsTaskId(task.id); }
  async function moveTask(task: Task, status: Status, beforeTaskId?: string) {
    if (beforeTaskId === task.id) return;
    await mutateTask(task.id, document => {
      const updated = { ...task, status, statusOverride: true };
      const remaining = document.tasks.filter(t => t.id !== task.id);
      const at = beforeTaskId ? remaining.findIndex(t => t.id === beforeTaskId) : -1;
      remaining.splice(at === -1 ? remaining.length : at, 0, updated);
      return { ...document, tasks: remaining };
    }, task);
  }
  function beginTaskDrag(event: React.DragEvent, taskId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
    setDragTaskId(taskId);
  }
  function dropTask(event: React.DragEvent, status: Status, beforeTaskId?: string) {
    event.preventDefault(); event.stopPropagation();
    const taskId = dragTaskId || event.dataTransfer.getData('text/plain');
    setDragTaskId(null); setDragTarget(null);
    const task = tasks.tasks.find(item => item.id === taskId);
    if (task) void action(() => moveTask(task, status, beforeTaskId));
  }
  async function clearBrowserData() {
    // Chrome extension storage is isolated from T3's site cookies and project files.
    // Clear both durable preferences/caches and ephemeral last-tab selection.
    await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]);
    setConfirmClear(false);
    window.location.reload();
  }
  async function manageRunner(verb: 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove' | 'configure', target?: string) {
    if (!tabId || !currentProject) return;
    const host = visibleThreads[0] || threads.find(t => projects.some(p => p.id === t.projectId));
    const hostProject = host && projects.find(p => p.id === host.projectId);
    if (!host || !hostProject) throw new Error('Open a T3 thread in this environment first; Terminal RPC requires a host thread.');
    const key = scopedKey.current;
    runnerActionInFlight.current = true;
    try {
      // Respect manual Stop by disabling future one-shot auto-start.
      if (verb === 'stop' || verb === 'start' || verb === 'install') {
        const enabled = verb !== 'stop';
        runnerAutoStartRef.current = enabled;
        await chrome.storage.local.set({ ['runnerAutoStartDisabled:' + environmentId]: !enabled });
        if (scopedKey.current === key) setRunnerAutoStart(enabled);
      }
      const result = await runnerCommand(tabId, environmentId, hostProject, host.id, verb,
        verb === 'configure' ? target : ['add', 'remove'].includes(verb) ? currentProject.workspaceRoot : undefined);
      if (scopedKey.current === key) {
        setRunnerResult(result); setRunnerCacheAt(null); setRunnerStatusError('');
        void chrome.storage.local.set({ [cacheKey('runner', environmentId)]: { value: result, verifiedAt: Date.now() } });
        if (verb !== 'status') setNotice(verb === 'install' ? 'Runner installed and started.' : 'Runner: ' + verb);
      }
    } catch (err) {
      if (scopedKey.current === key) {
        setRunnerStatusError(String(err));
        setRunnerResult(current => current.startsWith('{') ? current : 'Runner check failed: ' + String(err));
      }
      throw err;
    } finally {
      runnerActionInFlight.current = false;
    }
  }
  async function manageSkill(verb: 'status' | 'install' | 'update' | 'reinstall') {
    if (!tabId || !environmentId || !currentProject) return;
    const key = scopedKey.current;
    const selectedProjectId = projectId;
    setSkillBusy(true); setSkillError('');
    try {
      if (verb !== 'status') {
        const host = visibleThreads[0] || threads.find(t => projects.some(p => p.id === t.projectId));
        const hostProject = host && projects.find(p => p.id === host.projectId);
        if (!host || !hostProject) throw new Error('Open a T3 thread in this environment before installing the skill.');
        await installProjectSkill(tabId, environmentId, hostProject, host.id, currentProject.workspaceRoot, verb);
      }
      const installed = await isProjectSkillInstalled(tabId, environmentId, currentProject.workspaceRoot);
      if (verb !== 'status' && !installed) throw new Error('Installer completed but no project skill was found. Check the terminal output or install manually.');
      if (scopedKey.current === key && projectSelectionRef.current === selectedProjectId) {
        skillCheckedProject.current = key + ':' + currentProject.workspaceRoot;
        const state = installed ? 'installed' : 'not_installed';
        setSkillState(state); setSkillCacheAt(null);
        void chrome.storage.local.set({ [cacheKey('skill', environmentId, currentProject.workspaceRoot)]: { value: state, verifiedAt: Date.now() } });
        if (verb !== 'status') setNotice('Agent Skill: ' + verb + ' completed.');
        if (verb === 'install') setNotice('Agent skill installed for this project.');
      }
    } catch (error) {
      if (scopedKey.current === key && projectSelectionRef.current === selectedProjectId) {
        setSkillState('error'); setSkillError(String(error));
      }
      throw error;
    } finally {
      setSkillBusy(false);
    }
  }
  async function selectEnvironmentTab(value: string) {
    if (value === 'auto') {
      setManualTabId(null); setManualEnvironmentId('');
      connectionMenu.current?.removeAttribute('open');
      return;
    }
    const id = Number(value);
    const tab = tabChoices.find(t => t.id === id);
    if (!tab?.url || !isSafeOrigin(tab.url)) return;
    try {
      // A per-origin permission grants MAIN-world execution on a non-active tab.
      // This is permission to reach that site, not a T3 authentication credential.
      const site = new URL(tab.url);
      const origin = site.protocol + '//' + site.hostname + '/*';
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error('Browser permission for the selected T3 host was declined.');
      setManualTabId(id);
      setManualEnvironmentId('');
      connectionMenu.current?.removeAttribute('open');
    } catch (e) { setError(String(e)); }
  }
  // Memoize the entire Board tree so editing a draft does not reconcile every
  // task card on each keystroke; dependency changes still update active controls.
  const board = useMemo(() => (<section className="kanban-view">
      <div className="view-header">
        <div className="view-title"><h2>Board</h2><span className="muted">{tasks.tasks.length} {tasks.tasks.length === 1 ? 'task' : 'tasks'}</span></div>
        <div className="board-actions">
          <button type="button" className="runner-refresh" aria-label="Refresh project tasks" title="Refresh tasks" disabled={busy}
            onClick={() => void refreshProjectData()}>↻</button>
          <button className="primary compact" disabled={busy} onClick={() => edit()}>+ New task</button>
        </div>
      </div>
      {tasks.tasks.length === 0 ? (
        <div className="board-empty">
          <div className="board-empty-mark" aria-hidden="true">☷</div>
          <h3>No tasks yet</h3>
          <p>Create your first task to start organizing work.</p>
          <button type="button" className="primary compact" disabled={busy} onClick={() => edit()}>+ New task</button>
        </div>
      ) : (
      <div className="board-scroll">
        <div className="board">{columns.map(column => {
          const laneTasks = tasks.tasks.filter(t => taskColumn(t) === column.key);
          const expanded = !compactBoard || (laneTasks.length > 0 && expandedLanes[column.key]);
          const laneHeading = <>
            <div className="lane-title">
              {compactBoard && <span className="lane-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>}
              <span className={'lane-icon ' + column.key}/><strong>{column.name}</strong>
            </div>
            <span className="lane-count">{laneTasks.length}</span>
          </>;
          return <div className={'lane' + (dragTarget === column.key ? ' lane-drop-target' : '')} key={column.key}
            onDragOver={event => { if (dragTaskId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragTarget(column.key); } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTarget(null); }}
            onDrop={event => dropTask(event, column.key)}>
            {compactBoard && laneTasks.length > 0 ? (
              <button type="button" className="lane-heading lane-heading-toggle"
                aria-expanded={expanded} aria-controls={'lane-body-' + column.key}
                onClick={() => setExpandedLanes(current => {
                  const next = { ...current, [column.key]: !current[column.key] };
                  setPreferences(p => ({ ...p, expandedLanes: next }));
                  return next;
                })}>
                {laneHeading}
              </button>
            ) : <div className="lane-heading">{laneHeading}</div>}
            <div id={'lane-body-' + column.key} className="lane-body" hidden={!expanded}>
              {laneTasks.length === 0 && <p className="lane-empty">No tasks</p>}
              {laneTasks.map(task => {
                const execution = taskExecution(task);
                const queued = task.executionRequests?.length && !execution;
                const latestRequest = execution?.changeRequests?.[0];
                return <article className={'task-card' + (dragTaskId === task.id ? ' task-dragging' : '')} key={task.id}
                  onDragOver={event => { if (dragTaskId) { event.preventDefault(); event.stopPropagation(); setDragTarget(column.key); } }}
                  onDrop={event => dropTask(event, column.key, task.id)}>
                  <button type="button" className="drag-handle" draggable aria-label={'Drag ' + task.title}
                    title="Drag to move or reorder" onDragStart={event => beginTaskDrag(event, task.id)}
                    onDragEnd={() => { setDragTaskId(null); setDragTarget(null); }}>⠿</button>
                  <button className="task-open" type="button" aria-label={'View details for ' + task.title} onClick={() => openTask(task)}>
                    <span className="task-head"><strong>{task.title}</strong>{task.priority === 1 && <span className="priority-high" title="High priority">↑</span>}</span>
                    {task.description && <span className="task-description">{task.description}</span>}
                    <span className="task-meta">
                      <span className="priority-label">P{task.priority || 2}</span>
                      {(execution || queued) && <span className={'execution-status ' + (execution?.workflowStage || execution?.status || 'queued')}>
                        {execution?.workflowStage === 'human_review' ? 'Needs input / review'
                          : execution?.workflowStage?.replaceAll('_', ' ') || execution?.status?.replaceAll('_', ' ') || 'queued'}
                      </span>}
                      {latestRequest && <span className="linked-label" title={latestRequest.url}>{latestRequest.state === 'merged' ? 'Merged' : latestRequest.state === 'open' ? 'PR/MR open' : 'PR/MR linked'}</span>}
                      {taskLinkedThread(task) && <span className="linked-label" title="Linked T3 thread">Thread linked</span>}
                    </span>
                  </button>
                  <div className="task-footer">
                    <button className="queue-button" disabled={busy} onClick={() => requestExecution(task)}>Run / Queue</button>
                    <details className="task-more">
                      <summary aria-label={'More actions for ' + task.title} title="More actions">•••</summary>
                      <div className="task-menu">
                        <label>Move to<select aria-label={'Move ' + task.title} value={task.status}
                          onChange={e => {
                            e.currentTarget.closest('details')?.removeAttribute('open');
                            const status = e.target.value as Status;
                            void action(async () => mutateTask(task.id, d => ({
                              ...d, tasks: d.tasks.map(t => t.id === task.id ? { ...t, status, statusOverride: true } : t),
                            }), task));
                          }}>
                          {columns.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
                        </select></label>
                        <div className="menu-actions">
                          <button onClick={event => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            edit(task);
                          }}>Edit</button>
                          <button className="danger" onClick={event => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setConfirmation({
                        title: 'Delete task?',
                        description: 'This removes the task from Companion Board. It does not delete T3 threads or Git worktrees.',
                        confirmLabel: 'Delete task', dangerous: true,
                        run: async () => mutateTask(task.id, d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id) }), task),
                            });
                          }}>Delete</button>
                        </div>
                      </div>
                    </details>
                  </div>
                </article>;
              })}
            </div>
          </div>;
        })}</div>
      </div>
      )}
    </section>), [
    tasks, runtime, busy, projectId, tabId, environmentId, tabUrl, threads, projects, currentProject?.workspaceRoot,
    compactBoard, expandedLanes, dragTaskId, dragTarget,
  ]);
  return <main className="stack sidepanel">
    <header className="header">
      <div className="header-toolbar">
        <div className="brand"><span className="brand-mark">T3</span><strong>Companion</strong></div>
        <div className="header-actions">
          <span className={'connection ' + (recognized ? 'connected' : 'disconnected')} title={recognized ? 'T3 connected' : 'T3 offline'} aria-label={recognized ? 'T3 connected' : 'T3 offline'}><span className="status-dot"/></span>
          <details className="connection-settings" ref={connectionMenu}>
            <summary className="icon-button" aria-label="Connection settings" title="Connection settings">⚙</summary>
            <div className="connection-menu">
              <label htmlFor="source-tab">T3 Web session tab
                <select id="source-tab" aria-label="T3 Web session tab" disabled={busy}
                  value={manualTabId === null ? 'auto' : String(manualTabId)}
                  onChange={e => void selectEnvironmentTab(e.target.value)}>
                  <option value="auto">Auto (active T3 tab)</option>
                  {tabChoices.map(tab => <option key={tab.id} value={tab.id}>
                    {new URL(tab.url!).host} · {tab.title?.slice(0, 38) || 'T3 Web'}
                  </option>)}
                </select>
              </label>
              <p className="runner-hint">Uses the active T3 tab, or keeps the last connection when browsing other sites. Select a tab here to override.</p>
              {recognized && <p className="runner-hint">Connected via {tabUrl ? new URL(tabUrl).host : 'T3 Web'}</p>}
            </div>
          </details>
          <button className="icon-button" type="button" aria-label="Refresh T3 connection" title="Refresh connection" disabled={busy} onClick={() => void refresh(true)}>↻</button>
        </div>
      </div>
      <div className="context-row" role="group" aria-label="T3 workspace context">
        <label className="context-field" htmlFor="session-environment">
          <span>Environment</span>
          <select id="session-environment" aria-label="T3 session environment" disabled={busy || sessionEnvironments.length === 0}
            value={manualEnvironmentId || 'auto'} title={environmentLabel || 'Follow current T3 thread'}
            onChange={e => {
              const selected = e.target.value === 'auto' ? '' : e.target.value;
              setManualEnvironmentId(selected);
              setPreferences(p => ({ ...p, manualEnvironmentId: selected }));
            }}>
            <option value="auto">{environmentLabel ? 'Current · ' + environmentLabel : 'Follow T3 thread'}</option>
            {sessionEnvironments.map(env => <option key={env.environmentId} value={env.environmentId}>
              {env.label} · {env.source === 'direct' ? 'Direct' : 'T3 session'}
            </option>)}
          </select>
        </label>
        <label className="context-field" htmlFor="project">
          <span>Project</span>
          <select id="project" aria-label="Project" title={currentProject?.workspaceRoot || 'Select project'} value={projectId} disabled={busy || projects.length === 0}
            onChange={e => {
              manualProject.current = true;
              setProjectId(e.target.value);
              setPreferences(p => ({ ...p, projectByEnvironment: { ...p.projectByEnvironment, [environmentId]: e.target.value } }));
            }}>
            {projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>) : <option value="">No project</option>}
          </select>
        </label>
      </div>
    </header>
    <nav className="section-tabs" aria-label="Companion sections">{(['kanban','overview'] as Page[]).map(p =>
      <button type="button" key={p} className={p === page ? 'selected' : ''} aria-current={p === page ? 'page' : undefined}
        onClick={() => { setPage(p); setPreferences(prev => ({ ...prev, page: p })); }}>
        {p === 'kanban' ? 'Board' : 'Overview'}
      </button>)}</nav>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!recognized ? <section className="empty-view">
      <h2>Connect to T3 Code</h2>
      <p className="muted">Open a T3 Web tab with an authenticated environment. Companion uses that tab's existing session; on the T3 home page, select an environment above.</p>
      <button onClick={() => void refresh()}>Retry detection</button>
    </section>
    : !currentProject || tabId === null ? <section className="empty-view"><p>No projects found in this T3 environment.</p></section>
    : page === 'kanban' ? board : <section className="overview-view">
      <div className="view-header">
        <div className="view-title"><h2>Overview</h2><span className="muted">{currentProject.title}</span></div>
        <button type="button" className="runner-refresh" aria-label="Refresh project overview" title="Refresh overview" disabled={busy}
          onClick={() => void refreshProjectData()}>↻</button>
      </div>
      <div className="overview-content">
        <div className="overview-metrics">
          {[
            { label: 'Tasks', value: tasks.tasks.length },
            { label: 'Queued', value: tasks.tasks.reduce((sum, task) => sum +
              (task.executionRequests || []).filter(request => !runtime.requests[request.requestId]).length, 0) },
            { label: 'Running', value: Object.entries(runtime.requests).filter(([id, entry]) => visibleRequestIds.has(id) && entry.status === 'dispatching').length },
            { label: 'Attention', value: Object.entries(runtime.requests).filter(([id, entry]) => visibleRequestIds.has(id) &&
              ['blocked', 'failed', 'needs_reconciliation'].includes(entry.status)).length },
          ].map(metric => <div className="overview-metric" key={metric.label}>
            <strong>{metric.value}</strong><span>{metric.label}</span>
          </div>)}
        </div>
        <div className="overview-breakdown" aria-label="Task status breakdown">
          {columns.map(column => {
            const count = tasks.tasks.filter(task => taskColumn(task) === column.key).length;
            return <div className="overview-breakdown-item" key={column.key}>
              <span className={'lane-icon ' + column.key}/><span>{column.name}</span><strong>{count}</strong>
            </div>;
          })}
        </div>
        <details className="overview-expander" open>
          <summary><span className="overview-expander-title">Runner</span>
            <span className={'runner-state ' + (runnerError ? 'error' : runnerRunning === 'true' ? 'running' : runnerRunning === 'false' ? 'stopped' : '')}
              title={runnerError || undefined}>{runnerState}{runnerCacheAt ? ' · Cached' : ''}{runnerPid && runnerRunning === 'true' ? ' · PID ' + runnerPid : ''}</span>
          </summary>
          <div className="overview-expander-body">
      <div className="runner-section">
        {!runnerHostAvailable && <p className="runner-hint">Open a T3 thread in this environment to manage its Runner.</p>}
        {(runnerStatusError || runnerError) && <p className="runner-error" role="alert">Could not verify Runner: {runnerStatusError || runnerError}{runnerCacheAt ? ' (showing last known status)' : ''}</p>}
        {runnerInstalled === 'true' && <p className="runner-hint">Version: {runnerVersion ? runnerVersion.slice(0, 10) : 'Legacy · not recorded'}{runnerCacheAt ? ' · Last verified ' + new Date(runnerCacheAt).toLocaleTimeString() : ''}</p>}
        {runnerInstalled === 'true' && !runnerBridgeMissing && <div className="runner-config" role="group" aria-label="Runner scheduler settings">
          <label>Max concurrent
            <select aria-label="Max concurrent Runner tasks" value={runnerMaxConcurrent}
              disabled={busy || !runnerHostAvailable || !runnerScanInterval}
              onChange={event => {
                const count = event.target.value;
                void action(async () => manageRunner('configure', count));
              }}>
              <option value="1">1 worker</option>
              <option value="2">2 workers</option>
              <option value="3">3 workers</option>
            </select>
          </label>
          <span className="runner-hint">Global worker pool · scan every {runnerScanInterval ? Math.round(Number(runnerScanInterval) / 1000) + 's' : '10s'} · applies on next cycle</span>
        </div>}
        <div className="runner-toolbar">
          {(runnerInstalled === 'false' || runnerBridgeMissing) && <button className="primary" disabled={busy || !runnerHostAvailable}
            onClick={() => void action(async () => manageRunner('install'))}>{runnerBridgeMissing && runnerInstalled === 'true' ? 'Set up Runner controls' : 'Install & Start'}</button>}
          {runnerInstalled === 'true' && !runnerBridgeMissing && !runnerStarting && runnerRunning === 'false' && <button className="primary"
            disabled={busy || !runnerHostAvailable} onClick={() => void action(async () => manageRunner('start'))}>Start</button>}
          {runnerRunning === 'true' && <button disabled={busy || runnerStopping || !runnerHostAvailable}
            onClick={() => void action(async () => manageRunner('stop'))}>{runnerStopping ? 'Stopping…' : 'Stop'}</button>}
          {runnerInstalled === 'true' && !runnerBridgeMissing && <>
            <button disabled={busy || !runnerHostAvailable} onClick={() => void action(async () => manageRunner('update'))}>Update</button>
            <button disabled={busy || !runnerHostAvailable}
              onClick={() => setConfirmation({
                title: 'Re-install Runner?',
                description: 'Runner will drain active tasks, replace its executable files, and restart if it was running. Project registration, tasks and execution history are preserved.',
                confirmLabel: 'Re-install', run: async () => manageRunner('reinstall'),
              })}>Re-install</button>
          </>}
          {runnerInstalled === 'true' && <details ref={runnerProjectsMenu} className="runner-more">
            <summary aria-label="Manage Runner projects">Projects <span aria-hidden="true">⌄</span></summary>
            <div className="runner-menu">
              <button disabled={busy || !runnerHostAvailable} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void action(async () => manageRunner('add')); }}>Register current project</button>
              <button disabled={busy || !runnerHostAvailable} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void action(async () => manageRunner('remove')); }}>Unregister current project</button>
            </div>
          </details>}
          {runnerInstalled === 'true' && <label className="runner-autostart">
            <input type="checkbox" checked={runnerAutoStart} disabled={!environmentId}
              onChange={event => {
                const enabled = event.target.checked;
                runnerAutoStartRef.current = enabled;
                setRunnerAutoStart(enabled);
                void chrome.storage.local.set({ ['runnerAutoStartDisabled:' + environmentId]: !enabled });
              }}/>
            <span>Auto-start</span>
          </label>}
        </div>
        <details className="runner-output"><summary>Diagnostics</summary>
          <pre className="runner-result">{runnerResult}</pre>
        </details>
      </div>
            <button type="button" className="runner-refresh" aria-label="Refresh Runner status" title="Refresh Runner status"
              disabled={busy || !runnerHostAvailable} onClick={() => void action(async () => manageRunner('status'))}>↻ Refresh Runner</button>
          </div>
        </details>
        <details className="overview-expander" open>
          <summary><span className="overview-expander-title">Agent Skill</span>
            <span className={'skill-state ' + (skillState === 'installed' ? 'installed' : '')}>
              {skillState === 'installed' ? 'Installed' : skillState === 'not_installed' ? 'Not installed'
                : skillState === 'checking' ? 'Checking…' : skillState === 'error' ? 'Error' : 'Unavailable'}
            </span>
          </summary>
          <div className="overview-expander-body">
            <p className="overview-description">Manage project tasks using the installed agent skill. Installation is scoped to this project.</p>
            {skillCacheAt && <p className="runner-hint">Cached · Last verified {new Date(skillCacheAt).toLocaleTimeString()}</p>}
            {skillError && <p className="runner-error" role="alert">{skillError}</p>}
            <div className="runner-toolbar">
              {skillState !== 'installed' && <button className="primary" disabled={busy || skillBusy || !runnerHostAvailable || skillState === 'checking'}
                onClick={() => void action(async () => manageSkill('install'))}>{skillBusy ? 'Installing…' : 'Install Skill'}</button>}
              {skillState === 'installed' && <>
                <button disabled={busy || skillBusy || !runnerHostAvailable} onClick={() => void action(async () => manageSkill('update'))}>Update</button>
                <button disabled={busy || skillBusy || !runnerHostAvailable}
                  onClick={() => setConfirmation({
                    title: 'Re-install Agent Skill?',
                    description: 'The Agent Skill will be re-installed in the current project. Existing task files are preserved.',
                    confirmLabel: 'Re-install', run: async () => manageSkill('reinstall'),
                  })}>Re-install</button>
              </>}
              <button type="button" disabled={busy || skillBusy} onClick={() => void action(async () => manageSkill('status'))}>Refresh</button>
            </div>
            <p className="runner-hint">Installs into the selected project via npx skills. Requires Node.js 22.20+ and an open T3 thread for one-click setup.</p>
            <code className="skill-command">npx skills add truong51972/t3-companion --skill t3-companion -y</code>
          </div>
        </details>
        <details className="overview-expander data-settings">
          <summary><span className="overview-expander-title">Browser Data</span><span className="muted">Preferences & cache</span></summary>
          <div className="overview-expander-body">
            <p className="overview-description">Reset Companion's browser preferences, selected environments/projects and cached Runner/Skill statuses. Tasks, worktrees and T3 sign-in are not affected.</p>
            <div className="runner-toolbar"><button className="danger-action" onClick={() => setConfirmClear(true)}>Clear browser data…</button></div>
          </div>
        </details>
      </div>
    </section>}
    <dialog ref={confirmationDialog} className="modal confirm-dialog" aria-label="Confirm action"
      onCancel={() => setConfirmation(null)} onClose={() => setConfirmation(null)}
      onClick={event => onDialogBackdrop(event, () => setConfirmation(null))}>
      <div className="modal-heading"><div><h2>{confirmation?.title}</h2></div>
        <button type="button" className="icon-button" aria-label="Cancel action" onClick={() => setConfirmation(null)}>×</button>
      </div>
      <div className="modal-content"><p className="modal-intro">{confirmation?.description}</p></div>
      <div className="modal-actions">
        <button type="button" onClick={() => setConfirmation(null)}>Cancel</button>
        <button type="button" className={confirmation?.dangerous ? 'danger-action' : 'primary'} disabled={busy}
          onClick={() => {
            const next = confirmation?.run;
            setConfirmation(null);
            if (next) void action(next);
          }}>{confirmation?.confirmLabel}</button>
      </div>
    </dialog>
    <dialog ref={clearDialog} className="modal confirm-dialog" aria-label="Clear browser data"
      onCancel={() => setConfirmClear(false)} onClose={() => setConfirmClear(false)}
      onClick={event => onDialogBackdrop(event, () => setConfirmClear(false))}>
      <div className="modal-heading"><div><h2>Clear Companion browser data?</h2><p className="muted">This cannot be undone.</p></div>
        <button className="icon-button" aria-label="Close confirmation" onClick={() => setConfirmClear(false)}>×</button></div>
      <div className="modal-content"><p className="modal-intro">This removes saved UI preferences, environment/project selections, recognized host list and cached statuses. It does not delete project files, Runner, Agent Skill, T3 threads or T3 cookies.</p></div>
      <div className="modal-actions">
        <button onClick={() => setConfirmClear(false)}>Cancel</button>
        <button className="danger-action" disabled={busy} onClick={() => void action(clearBrowserData)}>Clear data</button>
      </div>
    </dialog>
    <dialog ref={detailsDialog} className="modal task-details-dialog" aria-label="Task details" onCancel={() => setDetailsTaskId(null)}
      onClick={event => onDialogBackdrop(event, () => setDetailsTaskId(null))} onClose={() => setDetailsTaskId(null)}>
      <div className="modal-heading">
        <div><h2>{detailsTask?.title || 'Task details'}</h2><p className="muted">{detailsTask?.status.replaceAll('_', ' ')} · Priority {detailsTask?.priority || 2}</p></div>
        <button type="button" className="icon-button" aria-label="Close task details" onClick={() => setDetailsTaskId(null)}>×</button>
      </div>
      <div className="modal-content">
        {detailsTask?.description && <div className="detail-field"><strong>Description</strong><p>{detailsTask.description}</p></div>}
        <div className="detail-field"><strong>Agent Prompt</strong><p className="task-prompt">{detailsTask?.prompt}</p></div>
        <div className="detail-field">
          <strong>Execution history</strong>
          {!detailsTask?.executionRequests?.length && <p className="muted">No execution requested yet.</p>}
          {detailsTask && taskRequests(detailsTask).map(({ request, execution }) => (
            <div className="request-row" key={request.requestId}>
              <div className="request-info">
                <span className="execution-status">{execution?.workflowStage === 'human_review' ? 'Human review'
                  : execution?.workflowStage?.replaceAll('_', ' ') || execution?.status?.replaceAll('_', ' ') || (request.notBefore ? 'scheduled / queued' : 'queued')}</span>
                {execution?.pendingRequestCount ? <span className="request-error">Waiting for {execution.pendingRequestCount} answer(s) in T3</span> : null}
                {execution?.changeRequests?.map(pr => <a key={pr.url} href={pr.url} target="_blank" rel="noopener noreferrer">
                  {pr.url} · {pr.state}
                </a>)}
                {request.worktree && <span className="muted">Worktree: {request.worktree}</span>}
                {request.notBefore && <span className="muted">Not before: {new Date(request.notBefore).toLocaleString()}</span>}
                {execution?.error && <span className="request-error">{execution.error}</span>}
              </div>
              {execution?.threadId && threadUrl(execution.threadId) && <button className="compact" onClick={() => void openLinkedThread(execution.threadId!)}>Open thread ↗</button>}
              {execution?.threadId && !threadUrl(execution.threadId) && <span className="muted" title={execution.threadId}>Thread linked</span>}
            </div>
          ))}
          {detailsTask && taskLinkedThread(detailsTask) && !threadUrl(taskLinkedThread(detailsTask)!) &&
            <p className="muted">This thread cannot be opened safely from the selected environment.</p>}
          {detailsTask && taskRequests(detailsTask).some(({ execution }) => execution?.status === 'dispatching' && !execution.threadId) &&
            <p className="muted">Runner records a thread ID after the T3 CLI returns. An active execution may not have a link yet.</p>}
        </div>
      </div>
      <div className="modal-actions">
        {detailsTask && taskLinkedThread(detailsTask) && threadUrl(taskLinkedThread(detailsTask)!) &&
          <button onClick={() => { void openLinkedThread(taskLinkedThread(detailsTask)!); }}>Open T3 thread ↗</button>}
        <button onClick={() => { if (detailsTask) { const task = detailsTask; setDetailsTaskId(null); edit(task); } }}>Edit</button>
        <button className="primary" disabled={busy} onClick={() => { if (detailsTask) { const task = detailsTask; setDetailsTaskId(null); requestExecution(task); } }}>Queue execution</button>
      </div>
    </dialog>
    <dialog ref={editorDialog} className="modal task-editor-dialog" aria-label="Task editor" onCancel={() => setEditing(null)}
      onClick={event => onDialogBackdrop(event, () => setEditing(null))} onClose={() => setEditing(null)}>
      <div className="modal-heading"><h2>{editing && tasks.tasks.some(t => t.id === editing.id) ? 'Edit task' : 'New task'}</h2>
        <button type="button" className="icon-button" aria-label="Close task editor" onClick={() => setEditing(null)}>×</button></div>
      <div className="modal-content">
        <label>Task Title<input autoFocus maxLength={180} placeholder="Short, actionable task name" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <label>Description <span className="optional-label">Optional · shown on the card</span><textarea rows={2} placeholder="Context or acceptance criteria" value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <label>Agent Prompt <span className="optional-label">Sent to T3; separate from task title</span><textarea rows={7} placeholder="Tell the coding agent what to investigate, change and verify…" value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })}/></label>
        <div className="field-pair">
          <label>Priority<select value={draft.priority ?? 2} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select></label>
          <label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status, statusOverride: true })}>{columns.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
        </div>
      </div>
      <div className="modal-actions"><button onClick={() => setEditing(null)}>Cancel</button>
        <button className="primary" disabled={busy || !draft.title.trim() || !draft.prompt.trim()} onClick={() => void action(saveTask)}>Save task</button></div>
    </dialog>
    <dialog ref={queueDialog} className="modal queue-dialog" aria-label="Queue execution" onCancel={() => setQueueTarget(null)}
      onClick={event => onDialogBackdrop(event, () => setQueueTarget(null))} onClose={() => setQueueTarget(null)}>
      <div className="modal-heading"><div><h2>Queue execution</h2><p className="muted">{queueTarget?.title}</p></div>
        <button type="button" className="icon-button" aria-label="Close execution dialog" onClick={() => setQueueTarget(null)}>×</button></div>
      <div className="modal-content">
        <p className="modal-intro">This creates an execution request. The task title stays on the Board; only its Agent Prompt is sent to T3.</p>
        {runnerRunning !== 'true' && <p className="queue-warning">Runner is not confirmed running in this environment. Requests remain queued until Runner starts and the project is registered.</p>}
        <label>Workspace
          <select value={workspaceMode} onChange={e => {
            const mode = e.target.value as WorkspaceMode;
            setWorkspaceMode(mode); rememberWorkspace(mode, worktree);
          }}>
            <option value="auto">Auto · isolated worktree for Git projects</option>
            <option value="worktree">Always create worktree</option>
            <option value="root">Shared project checkout (serial)</option>
          </select>
        </label>
        <details className="advanced-options" open={queueAdvancedOpen} onToggle={event => setQueueAdvancedOpen(event.currentTarget.open)}>
          <summary>Advanced options</summary>
          <div className="advanced-fields">
            {workspaceMode !== 'root' && <label>Base branch (optional)
              <input placeholder="Auto-detect current Git branch" value={worktree} onChange={e => {
                setWorktree(e.target.value); rememberWorkspace(workspaceMode, e.target.value);
              }}/>
            </label>}
            <label>Not before (optional)<input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)}/></label>
          </div>
        </details>
      </div>
      <div className="modal-actions"><button onClick={() => setQueueTarget(null)}>Cancel</button>
        <button className="primary" disabled={busy || !queueTarget} onClick={() => void action(async () => { if (queueTarget) { await enqueue(queueTarget); setQueueTarget(null); } })}>Queue request</button></div>
    </dialog>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
