import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { activeTab, describeEnvironment, isRecognizedTab, listSessionEnvironments, readProjectJson, runnerCommand, shell, writeProjectJson } from '../bridge/t3-bridge';
import { isSafeOrigin, isT3Web } from '../shared/t3-site';
import { environmentThreadUrl } from '../shared/environment-routing';
import type { Project, Thread } from '../bridge/t3-bridge';
import type { SessionEnvironment } from '../bridge/page-session';
import '../shared/styles.css';
import './sidepanel.css';

type Status = 'todo' | 'in_progress' | 'review' | 'done';
type Task = { id: string; title: string; description?: string; prompt: string; status: Status; priority?: number;
  executionRequests?: { requestId: string; notBefore?: string; worktree?: string }[] };
type Tasks = { version: 1; tasks: Task[] };
type Runtime = { version: 1; requests: Record<string, { taskId: string; status: string; threadId?: string | null; error?: string | null; startedAt?: string; finishedAt?: string }> };
type Page = 'kanban' | 'runner';
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
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [environmentLabel, setEnvironmentLabel] = useState('');
  const [manualTabId, setManualTabId] = useState<number | null>(null);
  const [tabChoices, setTabChoices] = useState<chrome.tabs.Tab[]>([]);
  const [sessionEnvironments, setSessionEnvironments] = useState<SessionEnvironment[]>([]);
  const [manualEnvironmentId, setManualEnvironmentId] = useState('');
  const scopedKey = useRef('');
  const refreshVersion = useRef(0);
  const [recognized, setRecognized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [projectId, setProjectId] = useState('');
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
  const [runnerResult, setRunnerResult] = useState('Not checked');
  const [runnerAutoStart, setRunnerAutoStart] = useState(true);
  const runnerAutoStartRef = useRef(true);
  const runnerActionInFlight = useRef(false);
  const runnerPollPaused = useRef(false);
  const currentProject = useMemo(() => projects.find(p => p.id === projectId) || null, [projects, projectId]);
  const visibleThreads = threads.filter(t => t.projectId === projectId);
  const detailsTask = tasks.tasks.find(t => t.id === detailsTaskId) || null;
  const runnerRunning = /"running"\s*:\s*(true|false)/.exec(runnerResult)?.[1];
  const runnerInstalled = /"installed"\s*:\s*(true|false)/.exec(runnerResult)?.[1];
  const runnerPid = /"pid"\s*:\s*(\d+)/.exec(runnerResult)?.[1];
  const runnerError = runnerResult.startsWith('Runner check failed: ') ? runnerResult.slice('Runner check failed: '.length) : '';
  const runnerHostAvailable = threads.some(t => projects.some(p => p.id === t.projectId));
  const runnerStopping = /"stopRequested"\s*:\s*true/.test(runnerResult) && runnerRunning === 'true';
  const runnerState = !runnerHostAvailable ? 'Needs session' : runnerError ? 'Error' : runnerInstalled === 'false'
    ? 'Not installed' : runnerStopping ? 'Stopping' : runnerRunning === 'true' ? 'Running' : runnerRunning === 'false' ? 'Stopped' : 'Checking';
  useEffect(() => { const dialog = editorDialog.current; if (!dialog) return; if (editing && !dialog.open) dialog.showModal(); else if (!editing && dialog.open) dialog.close(); }, [editing]);
  useEffect(() => { const dialog = queueDialog.current; if (!dialog) return; if (queueTarget && !dialog.open) dialog.showModal(); else if (!queueTarget && dialog.open) dialog.close(); }, [queueTarget]);
  useEffect(() => { const dialog = detailsDialog.current; if (!dialog) return; if (detailsTask && !dialog.open) dialog.showModal(); else if (!detailsTask && dialog.open) dialog.close(); }, [detailsTask]);
  // Success notices are transient; errors remain until the next action.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const menu = runnerProjectsMenu.current;
      if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = runnerProjectsMenu.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
      event.preventDefault();
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
    setProjects(next.projects); setThreads(next.threads);
    // Match a thread id from the authenticated shell to a complete URL segment.
    // The URL is an orientation hint, not authentication or a DOM-based guess.
    const segments = url ? new URL(url).pathname.split('/') : [];
    const activeThread = next.threads.find(t => segments.includes(t.id));
    setProjectId(old => {
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
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setBusy(true); setError('');
    try {
      // Tabs only supply candidate addresses. Their server descriptors supply identities.
      const [tabs, stored] = await Promise.all([
        chrome.tabs.query({ currentWindow: true }), chrome.storage.local.get('verifiedOrigins'),
      ]);
      const verified = new Set(Array.isArray(stored.verifiedOrigins) ? stored.verifiedOrigins as string[] : []);
      setTabChoices(tabs.filter(t => t.id !== undefined && t.url && isSafeOrigin(t.url) &&
        (isT3Web(t.url) || verified.has(new URL(t.url).origin))));
      const tab = manualTabId === null ? await activeTab() : await chrome.tabs.get(manualTabId);
      if (!tab.id || !tab.url || !await isRecognizedTab(tab)) throw new Error('Open and verify a T3 Web tab to connect.');
      // The selected T3 tab can contain multiple authenticated remote environments.
      const session = await listSessionEnvironments(tab.id);
      if (version !== refreshVersion.current) return;
      setSessionEnvironments(session.environments);
      const descriptor = await describeEnvironment(tab.id, manualEnvironmentId);
      if (version !== refreshVersion.current) return;
      const key = tab.id + ':' + descriptor.environmentId;
      if (scopedKey.current !== key) {
        scopedKey.current = key;
        ++filesVersion.current; ++shellVersion.current;
        manualProject.current = false;
        setProjects([]); setThreads([]); setProjectId('');
        setTasks(emptyTasks()); setRuntime(emptyRuntime());
        setDetailsTaskId(null); setEditing(null); setQueueTarget(null); setRunnerResult('Not checked'); setNotice('');
      }
      setTabId(tab.id); setTabUrl(tab.url); setEnvironmentId(descriptor.environmentId);
      setEnvironmentLabel(descriptor.label); setRecognized(true);
      await refreshShell(tab.id, tab.url, descriptor.environmentId);
    } catch (e) {
      if (version !== refreshVersion.current) return;
      ++filesVersion.current; ++shellVersion.current;
      setRecognized(false); setProjects([]); setThreads([]); setProjectId('');
      setTasks(emptyTasks()); setRuntime(emptyRuntime()); setRunnerResult('Not checked');
      setEnvironmentId(''); setEnvironmentLabel(''); setTabId(null); scopedKey.current = ''; setNotice('');
      setError(String(e));
    } finally { if (version === refreshVersion.current) setBusy(false); }
  }, [manualTabId, manualEnvironmentId, refreshShell]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    filesVersion.current++;
    setTasks(emptyTasks()); setRuntime(emptyRuntime());
    if (!tabId || !environmentId || !currentProject || !recognized) return;
    let active = true;
    const key = scopedKey.current;
    void refreshFiles(tabId, environmentId, currentProject).catch(e => { if (active && scopedKey.current === key) setError(String(e)); });
    return () => { active = false; filesVersion.current++; };
  }, [tabId, environmentId, projectId, recognized, refreshFiles, currentProject]);
  useEffect(() => {
    const changed = () => { if (manualTabId === null) void refresh(); };
    const updated = (id: number, change: { url?: string; status?: string }) => {
      if ((manualTabId === null ? id === tabId : id === manualTabId) && (change.url || change.status === 'complete')) void refresh();
    };
    chrome.tabs.onActivated.addListener(changed);
    chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(updated); };
  }, [refresh, manualTabId, tabId]);
  useEffect(() => {
    if (!tabId || !environmentId || !currentProject || !recognized || editing || queueTarget || busy) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const key = scopedKey.current;
        void refreshFiles(tabId, environmentId, currentProject).catch(e => { if (scopedKey.current === key) setError(String(e)); });
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [tabId, environmentId, currentProject, recognized, editing, queueTarget, busy, refreshFiles]);
  // Side Panel heartbeat: start an installed Runner while this panel is open.
  // Installation is a separate explicit action on the selected T3 environment.
  useEffect(() => {
    if (!tabId || !environmentId || !recognized) return;
    const host = threads.find(t => projects.some(p => p.id === t.projectId));
    const hostProject = host && projects.find(p => p.id === host.projectId);
    if (!host || !hostProject) return; // T3 Terminal RPC needs an existing thread.
    const scope = tabId + ':' + environmentId;
    const flag = 'runnerAutoStartDisabled:' + environmentId;
    let active = true;
    let checking = false;
    runnerPollPaused.current = false;
    const check = async () => {
      if (checking || !active || runnerActionInFlight.current || runnerPollPaused.current) return;
      checking = true;
      try {
        const saved = await chrome.storage.local.get(flag);
        const enabled = saved[flag] !== true;
        if (active && scopedKey.current === scope) { runnerAutoStartRef.current = enabled; setRunnerAutoStart(enabled); }
        const output = await runnerCommand(tabId, environmentId, hostProject, host.id, 'status');
        const status = JSON.parse(output) as { installed?: boolean; running?: boolean };
        if (!active || scopedKey.current !== scope) return;
        if (status.installed && !status.running && enabled && runnerAutoStartRef.current && !runnerActionInFlight.current) {
          const started = await runnerCommand(tabId, environmentId, hostProject, host.id, 'start');
          if (active && scopedKey.current === scope) setRunnerResult(started);
        } else {
          setRunnerResult(output);
        }
      } catch (error) {
        if (active && scopedKey.current === scope) {
          runnerPollPaused.current = true; // Avoid spawning another terminal every 15s on persistent failure.
          setRunnerResult('Runner check failed: ' + String(error));
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [tabId, environmentId, recognized, threads, projects]);

  useEffect(() => { setDetailsTaskId(null); }, [projectId]);
  async function action(f: () => Promise<void>) {
    if (!tabId || !environmentId || !currentProject) return;
    const key = scopedKey.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await f();
      if (scopedKey.current === key) await refreshFiles(tabId, environmentId, currentProject);
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
    if (scopedKey.current === key) setNotice('Saved to .t3/tasks.json');
  }
  function edit(task?: Task) { const value = task ? structuredClone(task) : blank(); setEditing(value); setDraft(value); }
  function requestExecution(task: Task) { setSchedule(''); setWorktree(''); setQueueTarget(task); }
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
      ? { ...t, executionRequests: [...(t.executionRequests || []), { requestId: crypto.randomUUID(), ...(when ? { notBefore: when } : {}), ...(worktree.trim() ? { worktree: worktree.trim() } : {}) }] }
      : t) }), task);
    setSchedule(''); setWorktree(''); setNotice('Request queued; Runner will dispatch when eligible.');
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
  async function openTask(task: Task) {
    const linked = taskLinkedThread(task);
    if (linked && await openLinkedThread(linked)) return;
    setDetailsTaskId(task.id);
  }
  async function manageRunner(verb: 'install' | 'status' | 'start' | 'stop' | 'add' | 'remove') {
    if (!tabId || !currentProject) return;
    const host = visibleThreads[0] || threads.find(t => projects.some(p => p.id === t.projectId));
    const hostProject = host && projects.find(p => p.id === host.projectId);
    if (!host || !hostProject) throw new Error('Open a T3 thread in this environment first; Terminal RPC requires a host thread.');
    const key = scopedKey.current;
    runnerActionInFlight.current = true;
    try {
      // Manual Stop must not be undone by the polling loop.
      if (verb === 'stop' || verb === 'start' || verb === 'install') {
        const enabled = verb !== 'stop';
        runnerAutoStartRef.current = enabled;
        await chrome.storage.local.set({ ['runnerAutoStartDisabled:' + environmentId]: !enabled });
        if (scopedKey.current === key) setRunnerAutoStart(enabled);
      }
      const result = await runnerCommand(tabId, environmentId, hostProject, host.id, verb,
        ['add', 'remove'].includes(verb) ? currentProject.workspaceRoot : undefined);
      if (scopedKey.current === key) {
        runnerPollPaused.current = false;
        setRunnerResult(result);
        if (verb !== 'status') setNotice(verb === 'install' ? 'Runner installed and started.' : 'Runner: ' + verb);
      }
    } catch (err) {
      if (scopedKey.current === key) setRunnerResult('Runner check failed: ' + String(err));
      throw err;
    } finally {
      runnerActionInFlight.current = false;
    }
  }
  async function selectEnvironmentTab(value: string) {
    if (value === 'auto') { setManualTabId(null); setManualEnvironmentId(''); return; }
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
    } catch (e) { setError(String(e)); }
  }
  return <main className="stack sidepanel">
    <header className="header">
      <div className="header-toolbar">
        <div className="brand"><span className="brand-mark">T3</span><strong>Companion</strong></div>
        <div className="header-actions">
          <span className={'connection ' + (recognized ? 'connected' : 'disconnected')} title={recognized ? 'T3 connected' : 'T3 offline'} aria-label={recognized ? 'T3 connected' : 'T3 offline'}><span className="status-dot"/></span>
          <button className="icon-button" type="button" aria-label="Refresh T3 connection" title="Refresh connection" disabled={busy} onClick={() => void refresh()}>↻</button>
        </div>
      </div>
      <div className="context-row" role="group" aria-label="T3 workspace context">
        <label className="context-field" htmlFor="environment">
          <span>Tab</span>
          <select id="environment" aria-label="T3 tab" disabled={busy} value={manualTabId === null ? 'auto' : String(manualTabId)}
            onChange={e => void selectEnvironmentTab(e.target.value)}>
            <option value="auto">Active T3 tab</option>
            {tabChoices.map(tab => <option key={tab.id} value={tab.id}>
              {new URL(tab.url!).host} · {tab.title?.slice(0, 38) || 'T3 Web'}
            </option>)}
          </select>
        </label>
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
    <nav className="section-tabs" aria-label="Companion sections">{(['kanban','runner'] as Page[]).map(p =>
      <button type="button" key={p} className={p === page ? 'selected' : ''} aria-current={p === page ? 'page' : undefined}
        onClick={() => setPage(p)}>
        {p === 'kanban' ? 'Board' : 'Runner'}
      </button>)}</nav>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!recognized ? <section className="empty-view">
      <h2>Connect to T3 Code</h2>
      <p className="muted">Open a T3 Web tab with an authenticated environment. Companion uses that tab's existing session; on the T3 home page, select an environment above.</p>
      <button onClick={() => void refresh()}>Retry detection</button>
    </section>
    : !currentProject || tabId === null ? <section className="empty-view"><p>No projects found in this T3 environment.</p></section>
    : page === 'kanban' ? <section className="kanban-view">
      <div className="view-header">
        <div className="view-title"><h2>Board</h2><span className="muted">{tasks.tasks.length} {tasks.tasks.length === 1 ? 'task' : 'tasks'}</span></div>
        <button className="primary compact" disabled={busy} onClick={() => edit()}>+ New task</button>
      </div>
      <div className="board-scroll">
        <div className="board">{columns.map(column => {
          const laneTasks = tasks.tasks.filter(t => t.status === column.key).sort((a,b) => (a.priority || 2) - (b.priority || 2));
          return <div className="lane" key={column.key}>
            <div className="lane-heading"><div className="lane-title"><span className={'lane-icon ' + column.key}/><strong>{column.name}</strong></div><span className="lane-count">{laneTasks.length}</span></div>
            <div className="lane-body">
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
    </section>
    : <section className="runner-view">
      <div className="view-header runner-heading">
        <div className="view-title"><h2>Runner</h2>
          <span className={'runner-state ' + (runnerError ? 'error' : runnerRunning === 'true' ? 'running' : runnerRunning === 'false' ? 'stopped' : '')} title={runnerError || undefined}>
            {runnerState}{runnerPid && runnerRunning === 'true' ? ' · PID ' + runnerPid : ''}
          </span>
        </div>
        <button type="button" className="runner-refresh" aria-label="Refresh Runner status" title="Refresh Runner status"
          disabled={busy || !runnerHostAvailable} onClick={() => void action(async () => manageRunner('status'))}>↻</button>
      </div>
      <div className="runner-section">
        {!runnerHostAvailable && <p className="runner-hint">Open a T3 thread in this environment to manage its Runner.</p>}
        {runnerError && <p className="runner-error" role="alert">{runnerError}</p>}
        <div className="runner-toolbar">
          {runnerInstalled === 'false' && <button className="primary" disabled={busy || !runnerHostAvailable}
            onClick={() => void action(async () => manageRunner('install'))}>Install & Start</button>}
          {runnerInstalled === 'true' && runnerRunning === 'false' && <button className="primary"
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
