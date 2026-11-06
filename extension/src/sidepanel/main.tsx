import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { activeTab, isRecognizedTab, launchThread, readProjectJson, rpc, runnerCommand, sendThread, shell, writeProjectJson } from '../bridge/t3-bridge';
import type { Project, Thread } from '../bridge/t3-bridge';
import '../shared/styles.css';
import './sidepanel.css';

type Status = 'todo' | 'in_progress' | 'review' | 'done';
type Task = { id: string; title: string; description?: string; prompt: string; status: Status; priority?: number;
  executionRequests?: { requestId: string; notBefore?: string; worktree?: string }[] };
type Tasks = { version: 1; tasks: Task[] };
type Runtime = { version: 1; requests: Record<string, { taskId: string; status: string; threadId?: string; error?: string }> };
type Page = 'kanban' | 'sessions' | 'runner';
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
  const [draft, setDraft] = useState<Task>(blank());
  const [schedule, setSchedule] = useState('');
  const [worktree, setWorktree] = useState('');
  const [sessionPrompt, setSessionPrompt] = useState('');
  const [selectedThread, setSelectedThread] = useState('');
  const [runnerResult, setRunnerResult] = useState('Not checked');
  const currentProject = useMemo(() => projects.find(p => p.id === projectId) || null, [projects, projectId]);
  const visibleThreads = threads.filter(t => t.projectId === projectId);

  const refreshShell = useCallback(async (id: number) => {
    const next = await shell(id);
    setProjects(next.projects); setThreads(next.threads);
    setProjectId(old => next.projects.some(p => p.id === old) ? old : next.projects[0]?.id || '');
  }, []);
  const refreshFiles = useCallback(async (id: number, project: Project) => {
    const [nextTasks, nextRuntime] = await Promise.all([
      readProjectJson<Tasks>(id, project.workspaceRoot, 'tasks.json', emptyTasks()),
      readProjectJson<Runtime>(id, project.workspaceRoot, 'runtime.json', emptyRuntime()),
    ]);
    setTasks(validateTasks(nextTasks)); setRuntime(validateRuntime(nextRuntime));
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const tab = await activeTab(); setTabId(tab.id || null); setTabUrl(tab.url || '');
      const detected = await isRecognizedTab(tab); setRecognized(detected);
      if (detected && tab.id) await refreshShell(tab.id);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [refreshShell]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!tabId || !currentProject || !recognized) return;
    let mounted = true;
    void refreshFiles(tabId, currentProject).catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; };
  }, [tabId, projectId, recognized, refreshFiles, currentProject]);
  useEffect(() => {
    const changed = () => void refresh();
    chrome.tabs.onActivated.addListener(changed);
    // Same T3 tab can navigate between threads without losing the Side Panel state.
    chrome.tabs.onUpdated.addListener(changed);
    return () => { chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(changed); };
  }, [refresh]);

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
  function edit(task?: Task) { setEditing(task || blank()); setDraft(task ? structuredClone(task) : blank()); setSchedule(''); setWorktree(''); }
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
  async function newThread() {
    if (!tabId || !currentProject || !sessionPrompt.trim()) return;
    const id = await launchThread(tabId, currentProject, sessionPrompt.trim(), visibleThreads[0]?.modelSelection);
    setSelectedThread(id); setSessionPrompt(''); await refreshShell(tabId);
    setNotice(`T3 thread started: ${id}`);
  }
  async function messageThread() {
    if (!tabId || !selectedThread || !sessionPrompt.trim()) return;
    await sendThread(tabId, selectedThread, sessionPrompt.trim()); setSessionPrompt('');
    setNotice('Message queued on existing T3 thread.');
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
    <header className="panel stack header"><div className="row"><div><h1>T3 Companion</h1><p className="caption">Project dashboard</p></div><span className={`tag ${recognized ? 'ok' : 'warn'}`}>{recognized ? 'T3 detected' : 'Disconnected'}</span></div>
      <div className="caption small-url" title={tabUrl}>{tabUrl}</div>
      <div className="row"><label className="muted" htmlFor="project">Project</label><button disabled={busy} onClick={() => void refresh()}>Refresh</button></div>
      <select id="project" value={projectId} disabled={busy || projects.length === 0} onChange={e => setProjectId(e.target.value)}>
        {projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.title} · {project.workspaceRoot}</option>) : <option value="">No project</option>}
      </select></header>
    <nav className="nav" aria-label="Dashboard sections">{(['kanban','sessions','runner'] as Page[]).map(p => <button key={p} className={p === page ? 'selected':''} onClick={() => setPage(p)}>{p === 'kanban' ? 'Kanban' : p === 'sessions' ? 'Sessions' : 'Runner'}</button>)}</nav>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice">{notice}</p>}
    {!recognized ? <section className="panel stack"><p>Open T3 Code on localhost or your Cloudflare domain, then click the extension icon to verify its DOM.</p><button onClick={() => void refresh()}>Retry detection</button></section>
      : !currentProject || tabId === null ? <p className="notice">No project found on the connected T3 environment.</p>
      : page === 'kanban' ? <section className="stack"><div className="row"><h2>Kanban</h2><button disabled={busy} onClick={() => edit()}>+ New task</button></div>
        <p className="caption">Task status is independent from agent execution status.</p>
        {editing && <div className="panel stack task-editor">
          <h3>{tasks.tasks.some(t => t.id === editing.id) ? 'Edit task' : 'New task'}</h3>
          <label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Description<textarea rows={2} value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
          <label>Agent prompt<textarea rows={4} value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })}/></label>
          <div className="row"><label>Priority<select value={draft.priority ?? 2} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select></label>
            <label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status })}>{columns.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label></div>
          <div className="buttons"><button disabled={busy} className="primary" onClick={() => void action(saveTask)}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></div></div>}
        <div className="board">{columns.map(column => <div className="lane" key={column.key}>
          <div className="row"><strong>{column.name}</strong><span className="tag">{tasks.tasks.filter(t => t.status === column.key).length}</span></div>
          {tasks.tasks.filter(t => t.status === column.key).sort((a,b) => (a.priority || 2) - (b.priority || 2)).map(task =>
            <article className="task-card stack" key={task.id}><div className="row"><strong>{task.title}</strong><span className="caption">P{task.priority || 2}</span></div>
              {task.description && <p className="caption">{task.description}</p>}
              {taskExecution(task) && <p className="caption">Execution: <strong>{taskExecution(task)?.status}</strong>{taskExecution(task)?.threadId && <span> · {taskExecution(task)?.threadId}</span>}</p>}
              <div className="row"><select aria-label={`Move ${task.title}`} value={task.status} onChange={e => void action(async () => mutateTask(task.id, d => ({ ...d, tasks: d.tasks.map(t => t.id === task.id ? { ...t, status: e.target.value as Status } : t) }), task))}>{columns.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
                <button onClick={() => edit(task)}>Edit</button><button onClick={() => { if (window.confirm('Delete this task?')) void action(async () => mutateTask(task.id, d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id) }), task)); }}>Delete</button></div>
              <div className="buttons"><button disabled={busy} onClick={() => void action(async () => enqueue(task))}>Queue execution</button></div>
            </article>)}
        </div>)}</div>
        <div className="panel stack"><h3>Next execution request</h3><label>Not before (optional)<input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)}/></label>
          <label>T3 worktree base ref (optional)<input placeholder="main" value={worktree} onChange={e => setWorktree(e.target.value)}/></label>
          <p className="caption">These values apply when pressing Queue execution on a task.</p></div>
      </section>
      : page === 'sessions' ? <section className="stack"><h2>T3 sessions</h2><div className="panel stack">
          <label>Choose thread<select value={selectedThread} onChange={e => setSelectedThread(e.target.value)}><option value="">New session</option>{visibleThreads.map(t => <option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}</select></label>
          <label>Message<textarea rows={4} value={sessionPrompt} onChange={e => setSessionPrompt(e.target.value)} placeholder="Describe work for T3 agent..."/></label>
          <div className="buttons"><button className="primary" disabled={busy || !sessionPrompt.trim()} onClick={() => void action(newThread)}>New session</button><button disabled={busy || !selectedThread || !sessionPrompt.trim()} onClick={() => void action(messageThread)}>Send to selected</button></div></div>
        {visibleThreads.map(t => <article key={t.id} className="task-card"><div className="row"><strong>{t.title}</strong><span className="tag">{t.status}</span></div><p className="caption">{t.id}</p><button onClick={() => setSelectedThread(t.id)}>Select thread</button></article>)}
      </section>
      : <section className="stack"><h2>Runner</h2><p className="caption">Commands execute through T3 Terminal RPC. The Runner keeps running when the browser closes.</p>
        <div className="panel stack"><div className="buttons">{(['status','start','stop','add','remove'] as const).map(verb => <button disabled={busy} key={verb} onClick={() => void action(async () => manageRunner(verb))}>{verb === 'add' ? 'Register project' : verb === 'remove' ? 'Unregister project' : verb[0].toUpperCase()+verb.slice(1)}</button>)}</div>
          <pre className="runner-result">{runnerResult}</pre>
          {!visibleThreads.length && <p className="notice">At least one T3 session in the selected project is needed as the temporary terminal host.</p>}
        </div></section>}
    <footer className="caption">Management UI · T3 authenticated RPC · file-based Runner</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
