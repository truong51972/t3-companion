import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { activeTab, isRecognizedTab, readProjectJson, runnerCommand, shell, writeProjectJson } from '../bridge/t3-bridge';
import { linkedThreadUrl } from '../shared/thread-navigation';
import type { Project, Thread } from '../bridge/t3-bridge';
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
  const filesVersion = useRef(0);
  const shellVersion = useRef(0);
  const manualProject = useRef(false);
  const [draft, setDraft] = useState<Task>(blank());
  const [schedule, setSchedule] = useState('');
  const [worktree, setWorktree] = useState('');
  const [runnerResult, setRunnerResult] = useState('Not checked');
  const currentProject = useMemo(() => projects.find(p => p.id === projectId) || null, [projects, projectId]);
  const visibleThreads = threads.filter(t => t.projectId === projectId);
  const detailsTask = tasks.tasks.find(t => t.id === detailsTaskId) || null;
  const runnerRunning = /"running"\s*:\s*(true|false)/.exec(runnerResult)?.[1];
  const runnerPid = /"pid"\s*:\s*(\d+)/.exec(runnerResult)?.[1];
  useEffect(() => { const dialog = editorDialog.current; if (!dialog) return; if (editing && !dialog.open) dialog.showModal(); else if (!editing && dialog.open) dialog.close(); }, [editing]);
  useEffect(() => { const dialog = queueDialog.current; if (!dialog) return; if (queueTarget && !dialog.open) dialog.showModal(); else if (!queueTarget && dialog.open) dialog.close(); }, [queueTarget]);
  useEffect(() => { const dialog = detailsDialog.current; if (!dialog) return; if (detailsTask && !dialog.open) dialog.showModal(); else if (!detailsTask && dialog.open) dialog.close(); }, [detailsTask]);

  const refreshShell = useCallback(async (id: number, url: string) => {
    const version = ++shellVersion.current;
    const next = await shell(id);
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
  const refreshFiles = useCallback(async (id: number, project: Project) => {
    const version = ++filesVersion.current;
    const [nextTasks, nextRuntime] = await Promise.all([
      readProjectJson<Tasks>(id, project.workspaceRoot, 'tasks.json', emptyTasks()),
      readProjectJson<Runtime>(id, project.workspaceRoot, 'runtime.json', emptyRuntime()),
    ]);
    const checkedTasks = validateTasks(nextTasks), checkedRuntime = validateRuntime(nextRuntime);
    if (version !== filesVersion.current) return;
    setTasks(checkedTasks); setRuntime(checkedRuntime);
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const tab = await activeTab(); setTabId(tab.id || null); setTabUrl(tab.url || '');
      const detected = await isRecognizedTab(tab); setRecognized(detected);
      if (detected && tab.id) await refreshShell(tab.id, tab.url || '');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [refreshShell]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    filesVersion.current++;
    setTasks(emptyTasks()); setRuntime(emptyRuntime());
    if (!tabId || !currentProject || !recognized) return;
    let active = true;
    void refreshFiles(tabId, currentProject).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; filesVersion.current++; };
  }, [tabId, projectId, recognized, refreshFiles, currentProject]);
  useEffect(() => {
    const changed = () => void refresh();
    const updated = (_id: number, change: { url?: string; status?: string }) => {
      if (change.url || change.status === 'complete') void refresh();
    };
    chrome.tabs.onActivated.addListener(changed);
    chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(updated); };
  }, [refresh]);
  useEffect(() => {
    if (!tabId || !currentProject || !recognized || editing || queueTarget || busy) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshFiles(tabId, currentProject).catch(e => setError(String(e)));
    }, 10000);
    return () => clearInterval(interval);
  }, [tabId, currentProject, recognized, editing, queueTarget, busy, refreshFiles]);
  useEffect(() => { setDetailsTaskId(null); }, [projectId]);
  async function action(f: () => Promise<void>) {
    if (!tabId || !currentProject) return;
    setBusy(true); setError(''); setNotice('');
    try { await f(); await refreshFiles(tabId, currentProject); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function mutateTask(taskId: string, update: (old: Tasks) => Tasks, original?: Task) {
    if (!tabId || !currentProject) return;
    const fresh = validateTasks(await readProjectJson<Tasks>(tabId, currentProject.workspaceRoot, 'tasks.json', emptyTasks()));
    const current = fresh.tasks.find(t => t.id === taskId);
    if (original && JSON.stringify(original) !== JSON.stringify(current)) throw new Error('Task changed in another panel. Refresh before editing again.');
    const next = update(fresh);
    validateTasks(next);
    await writeProjectJson(tabId, currentProject.workspaceRoot, 'tasks.json', next);
    setNotice('Saved to .t3/tasks.json');
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
  const threadUrl = (threadId: string) => linkedThreadUrl(tabUrl, threads.map(t => t.id), threadId);

  async function openLinkedThread(threadId: string) {
    const url = threadUrl(threadId);
    if (!url || !tabId) return false;
    try {
      await chrome.tabs.update(tabId, { url });
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
  async function manageRunner(verb: 'status' | 'start' | 'stop' | 'add' | 'remove') {
    if (!tabId || !currentProject) return;
    const host = visibleThreads[0]?.id;
    if (!host) throw new Error('Create a T3 session in this project first; Terminal RPC requires a host thread.');
    const result = await runnerCommand(tabId, currentProject, host, verb,
      ['add', 'remove'].includes(verb) ? currentProject.workspaceRoot : undefined);
    setRunnerResult(result);
    setNotice(`Runner command: ${verb}`);
  }
  return <main className="stack sidepanel">
    <header className="header">
      <div className="row">
        <div className="brand"><span className="brand-mark">T3</span><strong>Companion</strong></div>
        <div className="header-actions">
          <span className={'connection ' + (recognized ? 'connected' : 'disconnected')}><span className="status-dot"/>{recognized ? 'Detected' : 'Offline'}</span>
          <button className="icon-button" type="button" aria-label="Refresh T3 connection" title="Refresh" disabled={busy} onClick={() => void refresh()}>↻</button>
        </div>
      </div>
      <div className="project-row">
        <label className="sr-only" htmlFor="project">Project</label>
        <select id="project" aria-label="Project" value={projectId} disabled={busy || projects.length === 0}
          onChange={e => { manualProject.current = true; setProjectId(e.target.value); }}>
          {projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>) : <option value="">No project</option>}
        </select>
        <span className="project-path" title={currentProject?.workspaceRoot || tabUrl}>{currentProject?.workspaceRoot || tabUrl}</span>
      </div>
    </header>
    <nav className="nav" aria-label="Dashboard sections">{(['kanban','runner'] as Page[]).map(p =>
      <button type="button" key={p} className={p === page ? 'selected' : ''} aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>
        {p === 'kanban' ? 'Board' : 'Runner'}
      </button>)}</nav>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!recognized ? <section className="empty-view">
      <h2>Connect to T3 Code</h2>
      <p className="muted">Open a T3 Code tab, then check the connection.</p>
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
      <div className="view-header"><div className="view-title"><h2>Runner</h2><span className={"runner-state " + (runnerRunning === "true" ? "running" : runnerRunning === "false" ? "stopped" : "")}>{runnerRunning === "true" ? "Running" : runnerRunning === "false" ? "Stopped" : "Not checked"}{runnerPid ? " · PID " + runnerPid : ""}</span></div></div>
      <div className="runner-section">
        <p className="muted">Commands use the selected T3 environment. The service runs independently of the browser.</p>
        <div className="runner-controls">{(['status','start','stop','add','remove'] as const).map(verb =>
          <button disabled={busy || !visibleThreads.length} key={verb} onClick={() => void action(async () => manageRunner(verb))}>
            {verb === 'add' ? 'Register project' : verb === 'remove' ? 'Unregister project' : verb[0].toUpperCase() + verb.slice(1)}
          </button>)}</div>
        {!visibleThreads.length && <p className="muted">Open a T3 session in this project to enable terminal commands.</p>}
        <details className="runner-output" open={runnerResult !== 'Not checked'}><summary>Command output</summary><pre className="runner-result">{runnerResult}</pre></details>
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
            <p className="muted">To open linked threads directly, navigate T3 Code to an existing thread in this environment first.</p>}
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
