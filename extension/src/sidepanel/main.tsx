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

type Status = 'todo' | 'in_progress' | 'review' | 'done';
type Task = { id: string; title: string; description?: string; prompt: string; status: Status; priority?: number;
  executionRequests?: { requestId: string; notBefore?: string; worktree?: string; workspace?: WorkspaceMode }[] };
type Tasks = { version: 1; tasks: Task[] };
type Runtime = { version: 1; requests: Record<string, { taskId: string; status: string; threadId?: string | null; error?: string | null; startedAt?: string; finishedAt?: string }> };
type Page = 'kanban' | 'overview';
const COMPACT_BOARD_QUERY = '(max-width: 599px)';

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
  { key: 'review', name: 'Review' }, { key: 'done', name: 'Done' },
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
  const [skillCacheAt, setSkillCacheAt] = useState<number | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<Status | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
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
    todo: true, in_progress: true, review: true, done: false,
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
  const runnerState = !runnerHostAvailable ? 'Needs session' : runnerError ? 'Error' : runnerBridgeMissing && runnerInstalled === 'true' ? 'Setup required' : runnerStarting ? 'Starting' : runnerInstalled === 'false'
    ? 'Not installed' : runnerStopping ? 'Stopping' : runnerRunning === 'true' ? 'Running' : runnerRunning === 'false' ? 'Stopped' : 'Checking';
  // Cache is only a display hint. Live RPC validation remains authoritative.
  useEffect(() => {
    if (!environmentId) return;
    let live = true;
    const key = cacheKey('runner', environmentId);
    void chrome.storage.local.get(key).then(data => {
      const cached = parseCache<string>(data[key], (v): v is string => typeof v === 'string' && v.startsWith('{'));
      if (live && cached) {
        setRunnerResult(current => current === 'Not checked' ? cached.value : current);
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
    const menus = () => [runnerProjectsMenu.current, connectionMenu.current];
    const closeOnOutsideClick = (event: PointerEvent) => {
      const path = event.composedPath();
      for (const menu of menus()) if (menu?.open && !path.includes(menu)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
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
        setDetailsTaskId(null); setEditing(null); setQueueTarget(null); setRunnerResult('Not checked'); setNotice('');
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

  // File data is read on connection, project changes, and explicit user actions.
  // No fixed-interval RPC polling; it caused repeated WebSocket timeouts.
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
        if (active && scopedKey.current === scope)
          setRunnerResult('Runner check failed: ' + String(error));
      } finally {
        runnerActionInFlight.current = false;
      }
    })(); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [tabId, environmentId, recognized, runnerHost?.id, runnerHostProject?.id]);

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
          setSkillState('error'); setSkillError(String(error));
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
    const when = schedule ? new Date(schedule).toISOString() : undefined;
    await mutateTask(task.id, document => ({ ...document, tasks: document.tasks.map(t => t.id === task.id
      ? { ...t, executionRequests: [...(t.executionRequests || []), { requestId: crypto.randomUUID(), ...(when ? { notBefore: when } : {}), ...(workspaceMode !== 'root' && worktree.trim() ? { worktree: worktree.trim() } : {}), workspace: workspaceMode }] }
      : t) }), task);
    setSchedule(''); setNotice('Request queued; Runner will dispatch when eligible.');
  }
  const taskExecution = (task: Task) => {
    const req = task.executionRequests?.at(-1); return req ? runtime.requests[req.requestId] : null;
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
      const updated = { ...task, status };
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
  async function manageRunner(verb: 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove') {
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
        ['add', 'remove'].includes(verb) ? currentProject.workspaceRoot : undefined);
      if (scopedKey.current === key) {
        setRunnerResult(result); setRunnerCacheAt(null);
        void chrome.storage.local.set({ [cacheKey('runner', environmentId)]: { value: result, verifiedAt: Date.now() } });
        if (verb !== 'status') setNotice(verb === 'install' ? 'Runner installed and started.' : 'Runner: ' + verb);
      }
    } catch (err) {
      if (scopedKey.current === key) setRunnerResult('Runner check failed: ' + String(err));
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
          const laneTasks = tasks.tasks.filter(t => t.status === column.key).sort((a,b) => (a.priority || 2) - (b.priority || 2));
          const expanded = !compactBoard || (laneTasks.length > 0 && expandedLanes[column.key]);
          const laneHeading = <>
            <div className="lane-title">
              {compactBoard && <span className="lane-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>}
              <span className={'lane-icon ' + column.key}/><strong>{column.name}</strong>
            </div>
            <span className="lane-count">{laneTasks.length}</span>
          </>;
          return <div className="lane" key={column.key}>
            {compactBoard && laneTasks.length > 0 ? (
              <button type="button" className="lane-heading lane-heading-toggle"
                aria-expanded={expanded} aria-controls={'lane-body-' + column.key}
                onClick={() => setExpandedLanes(current => ({ ...current, [column.key]: !current[column.key] }))}>
                {laneHeading}
              </button>
            ) : <div className="lane-heading">{laneHeading}</div>}
            <div id={'lane-body-' + column.key} className="lane-body" hidden={!expanded}>
              {laneTasks.length === 0 && <p className="lane-empty">No tasks</p>}
              {laneTasks.map(task => {
                const execution = taskExecution(task);
                const queued = task.executionRequests?.length && !execution;
                return <article className="task-card" key={task.id}>
                  <button className="task-open" type="button" aria-label={'Open ' + task.title} onClick={() => void openTask(task)}>
                    <span className="task-head"><strong>{task.title}</strong>{task.priority === 1 && <span className="priority-high" title="High priority">↑</span>}</span>
                    {task.description && <span className="task-description">{task.description}</span>}
                    <span className="task-meta">
                      <span className="priority-label">P{task.priority || 2}</span>
                      {(execution || queued) && <span className={'execution-status ' + (execution?.status || 'queued')}>{execution?.status?.replaceAll('_', ' ') || 'queued'}</span>}
                      {taskLinkedThread(task) && <span className="linked-label" title="Linked T3 thread">↗ Thread</span>}
                    </span>
                  </button>
                  <div className="task-footer">
                    <button className="queue-button" disabled={busy} onClick={() => requestExecution(task)}>Queue</button>
                    <details className="task-more">
                      <summary aria-label={'More actions for ' + task.title} title="More actions">•••</summary>
                      <div className="task-menu">
                        <label>Move to<select aria-label={'Move ' + task.title} value={task.status}
                          onChange={e => void action(async () => mutateTask(task.id, d => ({ ...d, tasks: d.tasks.map(t => t.id === task.id ? { ...t, status: e.target.value as Status } : t) }), task))}>
                          {columns.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
                        </select></label>
                        <div className="menu-actions">
                          <button onClick={() => edit(task)}>Edit</button>
                          <button className="danger" onClick={() => { if (window.confirm('Delete this task?')) void action(async () => mutateTask(task.id, d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id) }), task)); }}>Delete</button>
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
    compactBoard, expandedLanes,
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
            onChange={e => setManualEnvironmentId(e.target.value === 'auto' ? '' : e.target.value)}>
            <option value="auto">{environmentLabel ? 'Current · ' + environmentLabel : 'Follow T3 thread'}</option>
            {sessionEnvironments.map(env => <option key={env.environmentId} value={env.environmentId}>
              {env.label} · {env.source === 'direct' ? 'Direct' : 'T3 session'}
            </option>)}
          </select>
        </label>
        <label className="context-field" htmlFor="project">
          <span>Project</span>
          <select id="project" aria-label="Project" title={currentProject?.workspaceRoot || 'Select project'} value={projectId} disabled={busy || projects.length === 0}
            onChange={e => { manualProject.current = true; setProjectId(e.target.value); }}>
            {projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>) : <option value="">No project</option>}
          </select>
        </label>
      </div>
    </header>
    <nav className="section-tabs" aria-label="Companion sections">{(['kanban','overview'] as Page[]).map(p =>
      <button type="button" key={p} className={p === page ? 'selected' : ''} aria-current={p === page ? 'page' : undefined}
        onClick={() => setPage(p)}>
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
            const count = tasks.tasks.filter(task => task.status === column.key).length;
            return <div className="overview-breakdown-item" key={column.key}>
              <span className={'lane-icon ' + column.key}/><span>{column.name}</span><strong>{count}</strong>
            </div>;
          })}
        </div>
        <details className="overview-expander" open>
          <summary><span className="overview-expander-title">Runner</span>
            <span className={'runner-state ' + (runnerError ? 'error' : runnerRunning === 'true' ? 'running' : runnerRunning === 'false' ? 'stopped' : '')}
              title={runnerError || undefined}>{runnerState}{runnerPid && runnerRunning === 'true' ? ' · PID ' + runnerPid : ''}</span>
          </summary>
          <div className="overview-expander-body">
      <div className="runner-section">
        {!runnerHostAvailable && <p className="runner-hint">Open a T3 thread in this environment to manage its Runner.</p>}
        {runnerError && <p className="runner-error" role="alert">{runnerError}</p>}
        <div className="runner-toolbar">
          {(runnerInstalled === 'false' || runnerBridgeMissing) && <button className="primary" disabled={busy || !runnerHostAvailable}
            onClick={() => void action(async () => manageRunner('install'))}>{runnerBridgeMissing && runnerInstalled === 'true' ? 'Set up Runner controls' : 'Install & Start'}</button>}
          {runnerInstalled === 'true' && !runnerBridgeMissing && !runnerStarting && runnerRunning === 'false' && <button className="primary"
            disabled={busy || !runnerHostAvailable} onClick={() => void action(async () => manageRunner('start'))}>Start</button>}
          {runnerRunning === 'true' && <button disabled={busy || runnerStopping || !runnerHostAvailable}
            onClick={() => void action(async () => manageRunner('stop'))}>{runnerStopping ? 'Stopping…' : 'Stop'}</button>}
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
            <p className="overview-description">Allow agents to manage .t3/tasks.json using bundled scripts instead of editing JSON manually.</p>
            {skillError && <p className="runner-error" role="alert">{skillError}</p>}
            <div className="runner-toolbar">
              {skillState !== 'installed' && <button className="primary" disabled={busy || skillBusy || !runnerHostAvailable || skillState === 'checking'}
                onClick={() => void action(async () => manageSkill('install'))}>{skillBusy ? 'Installing…' : 'Install Skill'}</button>}
              <button type="button" disabled={busy || skillBusy} onClick={() => void action(async () => manageSkill('status'))}>Refresh</button>
            </div>
            <p className="runner-hint">Installs into the selected project via npx skills. Requires Node.js 22.20+ and an open T3 thread for one-click setup.</p>
            <code className="skill-command">npx skills add truong51972/t3-companion --skill t3-companion -y</code>
          </div>
        </details>
      </div>
    </section>}
    <dialog ref={detailsDialog} className="modal" onClose={() => setDetailsTaskId(null)}>
      <div className="modal-heading">
        <div><h2>{detailsTask?.title || 'Task details'}</h2><p className="muted">{detailsTask?.status.replaceAll('_', ' ')} · Priority {detailsTask?.priority || 2}</p></div>
        <button type="button" className="icon-button" aria-label="Close task details" onClick={() => setDetailsTaskId(null)}>×</button>
      </div>
      <div className="modal-content">
        {detailsTask?.description && <div className="detail-field"><strong>Description</strong><p>{detailsTask.description}</p></div>}
        <div className="detail-field"><strong>Agent prompt</strong><p className="task-prompt">{detailsTask?.prompt}</p></div>
        <div className="detail-field">
          <strong>Execution history</strong>
          {!detailsTask?.executionRequests?.length && <p className="muted">No execution requested yet.</p>}
          {detailsTask && taskRequests(detailsTask).map(({ request, execution }) => (
            <div className="request-row" key={request.requestId}>
              <div className="request-info">
                <span className="execution-status">{execution?.status?.replaceAll('_', ' ') || (request.notBefore ? 'scheduled / queued' : 'queued')}</span>
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
        <button onClick={() => { if (detailsTask) { const task = detailsTask; setDetailsTaskId(null); edit(task); } }}>Edit</button>
        <button className="primary" disabled={busy} onClick={() => { if (detailsTask) { const task = detailsTask; setDetailsTaskId(null); requestExecution(task); } }}>Queue execution</button>
      </div>
    </dialog>
    <dialog ref={editorDialog} className="modal" onClose={() => setEditing(null)}>
      <div className="modal-heading"><h2>{editing && tasks.tasks.some(t => t.id === editing.id) ? 'Edit task' : 'New task'}</h2>
        <button type="button" className="icon-button" aria-label="Close task editor" onClick={() => setEditing(null)}>×</button></div>
      <div className="modal-content">
        <label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <label>Description<textarea rows={2} value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <label>Agent prompt<textarea rows={6} value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })}/></label>
        <div className="field-pair">
          <label>Priority<select value={draft.priority ?? 2} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select></label>
          <label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status })}>{columns.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
        </div>
      </div>
      <div className="modal-actions"><button onClick={() => setEditing(null)}>Cancel</button>
        <button className="primary" disabled={busy || !draft.title.trim() || !draft.prompt.trim()} onClick={() => void action(saveTask)}>Save task</button></div>
    </dialog>
    <dialog ref={queueDialog} className="modal" onClose={() => setQueueTarget(null)}>
      <div className="modal-heading"><div><h2>Queue execution</h2><p className="muted">{queueTarget?.title}</p></div>
        <button type="button" className="icon-button" aria-label="Close execution dialog" onClick={() => setQueueTarget(null)}>×</button></div>
      <div className="modal-content">
        <label>Not before (optional)<input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)}/></label>
        <label>Worktree base ref (optional)<input placeholder="main" value={worktree} onChange={e => setWorktree(e.target.value)}/></label>
      </div>
      <div className="modal-actions"><button onClick={() => setQueueTarget(null)}>Cancel</button>
        <button className="primary" disabled={busy || !queueTarget} onClick={() => void action(async () => { if (queueTarget) { await enqueue(queueTarget); setQueueTarget(null); } })}>Queue request</button></div>
    </dialog>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
