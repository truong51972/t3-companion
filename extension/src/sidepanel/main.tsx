import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  installProjectSkill,
  isProjectSkillInstalled,
  isRecognizedTab,
  listSessionEnvironments,
  readProjectJson,
  runnerCommand,
  shell,
  writeProjectJson,
  type Project,
  type Thread,
} from '../bridge/t3-bridge';
import { isSafeOrigin, isT3Web } from '../shared/t3-site';
import { environmentThreadUrl } from '../shared/environment-routing';
import { selectT3Tab } from '../shared/tab-selection';
import type { SessionEnvironment } from '../bridge/page-session';
import {
  cacheKey,
  defaultPreferences,
  loadPreferences,
  parseCache,
  persistPreferences,
  scopeKey,
  type CompanionPreferences,
  type WorkspaceMode,
} from '../shared/preferences';
import { moveBoardItem } from '../shared/board-move';
import {
  emptyTasks,
  emptyRuntime,
  blankTask,
  validateTasks,
  validateRuntime,
  getTaskColumn,
  parseRunnerState,
  type Task,
  type TasksDocument,
  type RuntimeDocument,
  type TaskStatus,
} from '../shared/domain-types';
import { Header } from './components/Header';
import { BoardView } from './components/Kanban/BoardView';
import { OverviewView } from './components/Overview/OverviewView';
import {
  ConfirmModal,
  ClearBrowserDataModal,
  type ConfirmDialogState,
} from './components/Modals/ConfirmModal';
import { TaskEditorModal } from './components/Modals/TaskEditorModal';
import { QueueModal } from './components/Modals/QueueModal';
import { TaskDetailsModal } from './components/Modals/TaskDetailsModal';
import { useCompactBoard } from './hooks/useCompactBoard';
import { useMenuDismissal } from './hooks/useMenuDismissal';
import { useBoardDragDrop } from './hooks/useBoardDragDrop';
import '../shared/styles.css';
import './sidepanel.css';

type Page = 'kanban' | 'overview';

function App() {
  const [page, setPage] = useState<Page>('kanban');
  const [preferences, setPreferences] = useState<CompanionPreferences>(defaultPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [preferencesReady, setPreferencesReady] = useState(false);

  const [expandedLanes, setExpandedLanes] = useState<Record<TaskStatus, boolean>>({
    todo: true,
    in_progress: true,
    review: true,
    awaiting_merge: true,
    done: false,
  });

  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [environmentLabel, setEnvironmentLabel] = useState('');
  const [manualTabId, setManualTabId] = useState<number | null>(null);
  const selectedTabRef = useRef<number | null>(null);
  const [tabChoices, setTabChoices] = useState<chrome.tabs.Tab[]>([]);
  const [sessionEnvironments, setSessionEnvironments] = useState<SessionEnvironment[]>([]);
  const [manualEnvironmentId, setManualEnvironmentId] = useState('');

  const scopedKey = useRef('');
  const shellReadyScope = useRef('');
  const shellSnapshot = useRef<{ projects: Project[]; threads: Thread[] }>({
    projects: [],
    threads: [],
  });
  const refreshVersion = useRef(0);
  const filesVersion = useRef(0);
  const shellVersion = useRef(0);
  const manualProject = useRef(false);

  const [recognized, setRecognized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [projectId, setProjectId] = useState('');
  const projectSelectionRef = useRef(projectId);
  projectSelectionRef.current = projectId;

  const [tasks, setTasks] = useState<TasksDocument>(emptyTasks());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [runtime, setRuntime] = useState<RuntimeDocument>(emptyRuntime());

  // Modal dialog states
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [queueTarget, setQueueTarget] = useState<Task | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmDialogState | null>(null);

  // Runner state
  const [runnerResult, setRunnerResult] = useState('Not checked');
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [runnerCacheAt, setRunnerCacheAt] = useState<number | null>(null);
  const [runnerStatusError, setRunnerStatusError] = useState('');
  const [runnerAutoStart, setRunnerAutoStart] = useState(true);
  const runnerAutoStartRef = useRef(true);
  const runnerActionInFlight = useRef(false);
  const runnerCheckedScope = useRef('');

  // Skill state
  const [skillState, setSkillState] = useState<
    'checking' | 'installed' | 'not_installed' | 'unavailable' | 'error'
  >('checking');
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [skillCacheAt, setSkillCacheAt] = useState<number | null>(null);
  const skillCheckedProject = useRef('');

  const compactBoard = useCompactBoard();
  useMenuDismissal();

  const currentProject = useMemo(
    () => projects.find(p => p.id === projectId) || null,
    [projects, projectId]
  );
  const visibleThreads = threads.filter(t => t.projectId === projectId);
  const runnerHost = threads.find(t => projects.some(p => p.id === t.projectId));
  const runnerHostProject = runnerHost && projects.find(p => p.id === runnerHost.projectId);
  const runnerHostAvailable = Boolean(runnerHost && runnerHostProject);

  const parsedRunner = useMemo(
    () => parseRunnerState(runnerResult, runnerHostAvailable),
    [runnerResult, runnerHostAvailable]
  );

  const detailsTask = tasks.tasks.find(t => t.id === detailsTaskId) || null;

  // Preferences loading and persistence
  useEffect(() => {
    let live = true;
    void loadPreferences()
      .then(stored => {
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
      })
      .catch(() => {})
      .finally(() => {
        if (live) setPreferencesReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (preferencesReady) void persistPreferences(preferences).catch(() => {});
  }, [preferencesReady, preferences]);

  // Transient notice timer
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Load cached runner status
  useEffect(() => {
    if (!environmentId) return;
    let live = true;
    const key = cacheKey('runner', environmentId);
    void chrome.storage.local
      .get(key)
      .then(data => {
        const cached = parseCache<string>(
          data[key],
          (v): v is string => typeof v === 'string' && v.startsWith('{')
        );
        if (live && cached && runnerResult === 'Not checked') {
          setRunnerResult(cached.value);
          setRunnerCacheAt(cached.verifiedAt);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [environmentId, runnerResult]);

  // Load cached skill status
  useEffect(() => {
    if (!environmentId || !currentProject) return;
    let live = true;
    const key = cacheKey('skill', environmentId, currentProject.workspaceRoot);
    setSkillCacheAt(null);
    setSkillState('checking');
    setSkillError('');
    skillCheckedProject.current = '';
    void chrome.storage.local
      .get(key)
      .then(data => {
        const cached = parseCache<'installed' | 'not_installed'>(
          data[key],
          (v): v is 'installed' | 'not_installed' => v === 'installed' || v === 'not_installed'
        );
        if (live && cached) {
          setSkillState(current => (current === 'checking' ? cached.value : current));
          setSkillCacheAt(cached.verifiedAt);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [environmentId, currentProject?.workspaceRoot]);

  // Shell and file refreshes
  const refreshShell = useCallback(async (id: number, url: string, envId: string) => {
    const version = ++shellVersion.current;
    const next = await shell(id, envId);
    if (version !== shellVersion.current) return;
    shellSnapshot.current = next;
    setProjects(old => (JSON.stringify(old) === JSON.stringify(next.projects) ? old : next.projects));
    setThreads(old => (JSON.stringify(old) === JSON.stringify(next.threads) ? old : next.threads));

    const segments = url ? new URL(url).pathname.split('/') : [];
    const activeThread = next.threads.find(t => segments.includes(t.id));
    setProjectId(old => {
      const saved = preferencesRef.current.projectByEnvironment[envId];
      if (manualProject.current && saved && next.projects.some(p => p.id === saved)) return saved;
      if (
        !manualProject.current &&
        activeThread &&
        next.projects.some(p => p.id === activeThread.projectId)
      )
        return activeThread.projectId;
      return next.projects.some(p => p.id === old) ? old : next.projects[0]?.id || '';
    });
  }, []);

  const refreshFiles = useCallback(async (id: number, envId: string, project: Project) => {
    const key = id + ':' + envId;
    if (scopedKey.current !== key) return;
    const version = ++filesVersion.current;
    const [nextTasks, nextRuntime] = await Promise.all([
      readProjectJson<TasksDocument>(id, envId, project.workspaceRoot, 'tasks.json', emptyTasks()),
      readProjectJson<RuntimeDocument>(
        id,
        envId,
        project.workspaceRoot,
        'runtime.json',
        emptyRuntime()
      ),
    ]);
    const checkedTasks = validateTasks(nextTasks);
    const checkedRuntime = validateRuntime(nextRuntime);
    if (version !== filesVersion.current || scopedKey.current !== key) return;
    setTasks(checkedTasks);
    setRuntime(checkedRuntime);
  }, []);

  const refresh = useCallback(
    async (forceShell = false) => {
      const version = ++refreshVersion.current;
      setBusy(true);
      setError('');
      try {
        const [tabs, stored] = await Promise.all([
          chrome.tabs.query({ currentWindow: true }),
          chrome.storage.local.get('verifiedOrigins'),
        ]);
        const verified = new Set(
          Array.isArray(stored.verifiedOrigins) ? (stored.verifiedOrigins as string[]) : []
        );
        const eligible = tabs.filter(
          t =>
            t.id !== undefined &&
            t.url &&
            isSafeOrigin(t.url) &&
            (isT3Web(t.url) || verified.has(new URL(t.url).origin))
        );

        const windowId = tabs[0]?.windowId;
        if (selectedTabRef.current === null && windowId !== undefined) {
          const storageKey = 'lastT3Tab:' + windowId;
          const saved = await chrome.storage.session.get(storageKey);
          if (Number.isInteger(saved[storageKey]))
            selectedTabRef.current = saved[storageKey] as number;
        }
        setTabChoices(eligible);

        const tab = selectT3Tab(eligible, manualTabId, selectedTabRef.current);
        if (!tab?.id || !tab.url || !(await isRecognizedTab(tab)))
          throw new Error('Open and verify a T3 Web tab to connect.');

        const session = await listSessionEnvironments(tab.id);
        if (version !== refreshVersion.current) return;
        setSessionEnvironments(old =>
          JSON.stringify(old) === JSON.stringify(session.environments) ? old : session.environments
        );
        const selectedEnvironment = session.environments.some(
          item => item.environmentId === manualEnvironmentId
        )
          ? manualEnvironmentId
          : '';
        const target =
          selectedEnvironment ||
          session.routeEnvironmentId ||
          session.environments.find(item => item.source === 'direct')?.environmentId ||
          (session.environments.length === 1 ? session.environments[0]!.environmentId : '');
        const descriptor = session.environments.find(item => item.environmentId === target);
        if (!descriptor)
          throw new Error('Select a T3 environment in Companion or open a T3 thread.');

        const key = tab.id + ':' + descriptor.environmentId;
        const scopeChanged = scopedKey.current !== key;
        if (scopeChanged) {
          scopedKey.current = key;
          ++filesVersion.current;
          ++shellVersion.current;
          manualProject.current = Boolean(
            preferencesRef.current.projectByEnvironment[descriptor.environmentId]
          );
          setProjects([]);
          setThreads([]);
          setProjectId('');
          setTasks(emptyTasks());
          setRuntime(emptyRuntime());
          setRunnerCacheAt(null);
          setSkillCacheAt(null);
          setDetailsTaskId(null);
          setEditingTask(null);
          setQueueTarget(null);
          setRunnerResult('Not checked');
          setRunnerStatusError('');
          setNotice('');
        }
        selectedTabRef.current = tab.id;
        if (tab.windowId !== undefined) {
          void chrome.storage.session.set({ ['lastT3Tab:' + tab.windowId]: tab.id });
        }
        setTabId(tab.id);
        setTabUrl(tab.url);
        setEnvironmentId(descriptor.environmentId);
        setEnvironmentLabel(descriptor.label);
        setRecognized(true);

        if (forceShell || scopeChanged || shellReadyScope.current !== key) {
          await refreshShell(tab.id, tab.url, descriptor.environmentId);
          if (version !== refreshVersion.current) return;
          shellReadyScope.current = key;
        } else if (!manualProject.current) {
          const segments = new URL(tab.url).pathname.split('/');
          const active = shellSnapshot.current.threads.find(thread =>
            segments.includes(thread.id)
          );
          if (
            active &&
            shellSnapshot.current.projects.some(project => project.id === active.projectId)
          )
            setProjectId(old => (old === active.projectId ? old : active.projectId));
        }
      } catch (e) {
        if (version !== refreshVersion.current) return;
        ++filesVersion.current;
        ++shellVersion.current;
        shellReadyScope.current = '';
        shellSnapshot.current = { projects: [], threads: [] };
        setRecognized(false);
        setProjects([]);
        setThreads([]);
        setProjectId('');
        setTasks(emptyTasks());
        setRuntime(emptyRuntime());
        setRunnerResult('Not checked');
        setEnvironmentId('');
        setEnvironmentLabel('');
        setTabId(null);
        scopedKey.current = '';
        setNotice('');
        setError(String(e));
      } finally {
        if (version === refreshVersion.current) setBusy(false);
      }
    },
    [manualTabId, manualEnvironmentId, refreshShell]
  );

  useEffect(() => {
    if (preferencesReady) void refresh();
  }, [refresh, preferencesReady]);

  // Project file refresh
  useEffect(() => {
    filesVersion.current++;
    setTasks(emptyTasks());
    setRuntime(emptyRuntime());
    if (!tabId || !environmentId || !currentProject || !recognized) return;
    let active = true;
    const key = scopedKey.current;
    void refreshFiles(tabId, environmentId, currentProject).catch(e => {
      if (active && scopedKey.current === key) setError(String(e));
    });
    return () => {
      active = false;
      filesVersion.current++;
    };
  }, [tabId, environmentId, projectId, recognized, refreshFiles, currentProject?.workspaceRoot]);

  // Tab change events
  useEffect(() => {
    const changed = ({ tabId: activeId }: chrome.tabs.OnActivatedInfo) => {
      if (manualTabId !== null || activeId === selectedTabRef.current) return;
      void (async () => {
        try {
          const tab = await chrome.tabs.get(activeId);
          if (!tab.url || !isSafeOrigin(tab.url)) return;
          const stored = await chrome.storage.local.get('verifiedOrigins');
          const verified = Array.isArray(stored.verifiedOrigins)
            ? (stored.verifiedOrigins as string[])
            : [];
          if (isT3Web(tab.url) || verified.includes(new URL(tab.url).origin)) await refresh();
        } catch {}
      })();
    };
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const updated = (id: number, change: { url?: string; status?: string }) => {
      if (
        id !== (manualTabId ?? selectedTabRef.current) ||
        (!change.url && change.status !== 'complete')
      )
        return;
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = null;
        void refresh();
      }, 180);
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

  // One-shot runner check and autostart
  useEffect(() => {
    if (!tabId || !environmentId || !recognized) return;
    if (!runnerHost || !runnerHostProject) return;
    const scope = tabId + ':' + environmentId;
    if (runnerCheckedScope.current === scope) return;
    runnerCheckedScope.current = scope;
    const flag = 'runnerAutoStartDisabled:' + environmentId;
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const saved = await chrome.storage.local.get(flag);
          const enabled = saved[flag] !== true;
          if (!active || scopedKey.current !== scope || runnerActionInFlight.current) return;
          runnerAutoStartRef.current = enabled;
          setRunnerAutoStart(enabled);
          runnerActionInFlight.current = true;
          const output = await runnerCommand(
            tabId,
            environmentId,
            runnerHostProject,
            runnerHost.id,
            'status'
          );
          if (!active || scopedKey.current !== scope) return;
          const status = JSON.parse(output) as {
            installed?: boolean;
            running?: boolean;
            bridgeMissing?: boolean;
          };
          setRunnerCacheAt(null);
          setRunnerStatusError('');
          void chrome.storage.local.set({
            [cacheKey('runner', environmentId)]: { value: output, verifiedAt: Date.now() },
          });
          if (
            status.installed &&
            !status.bridgeMissing &&
            !status.running &&
            enabled &&
            runnerAutoStartRef.current
          ) {
            const started = await runnerCommand(
              tabId,
              environmentId,
              runnerHostProject,
              runnerHost.id,
              'start'
            );
            if (active && scopedKey.current === scope) {
              setRunnerResult(started);
              void chrome.storage.local.set({
                [cacheKey('runner', environmentId)]: { value: started, verifiedAt: Date.now() },
              });
            }
          } else {
            setRunnerResult(output);
          }
        } catch (err) {
          if (active && scopedKey.current === scope) {
            setRunnerStatusError(String(err));
            setRunnerResult(current =>
              current.startsWith('{') ? current : 'Runner check failed: ' + String(err)
            );
          }
        } finally {
          runnerActionInFlight.current = false;
        }
      })();
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tabId, environmentId, recognized, runnerHost?.id, runnerHostProject?.id]);

  // Bounded background polling for runtime.json during active executions
  useEffect(() => {
    if (!tabId || !environmentId || !currentProject || !recognized || page !== 'kanban') return;
    const hasOutstanding = tasks.tasks.some(task => {
      const latest = task.executionRequests?.at(-1);
      if (!latest || task.statusOverride || task.status === 'done') return false;
      const entry = runtime.requests[latest.requestId];
      return (
        !entry ||
        entry.status === 'dispatching' ||
        (Boolean(entry.threadId) &&
          ['human_review', 'awaiting_merge', 'in_progress'].includes(entry.workflowStage || ''))
      );
    });
    if (!hasOutstanding) return;
    let failures = 0;
    let pending = false;
    const key = scopedKey.current;
    const project = currentProject;
    const selected = projectId;
    const timer = setInterval(() => {
      if (pending || document.visibilityState !== 'visible' || scopedKey.current !== key) return;
      pending = true;
      void readProjectJson<RuntimeDocument>(
        tabId,
        environmentId,
        project.workspaceRoot,
        'runtime.json',
        emptyRuntime()
      )
        .then(data => {
          if (scopedKey.current !== key || projectSelectionRef.current !== selected) return;
          const valid = validateRuntime(data);
          failures = 0;
          setRuntime(old => (JSON.stringify(old) === JSON.stringify(valid) ? old : valid));
        })
        .catch(() => {
          if (++failures >= 2) clearInterval(timer);
        })
        .finally(() => {
          pending = false;
        });
    }, 15000);
    return () => clearInterval(timer);
  }, [
    tabId,
    environmentId,
    currentProject?.workspaceRoot,
    projectId,
    recognized,
    page,
    tasks,
    runtime,
  ]);

  // Skill check on overview page
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
    setSkillState('checking');
    setSkillError('');
    void isProjectSkillInstalled(tabId, environmentId, currentProject.workspaceRoot)
      .then(installed => {
        if (active && scopedKey.current === key && projectSelectionRef.current === projectId) {
          skillCheckedProject.current = projectKey;
          setSkillCacheAt(null);
          const state = installed ? 'installed' : 'not_installed';
          setSkillState(state);
          void chrome.storage.local.set({
            [cacheKey('skill', environmentId, currentProject.workspaceRoot)]: {
              value: state,
              verifiedAt: Date.now(),
            },
          });
        }
      })
      .catch(err => {
        if (active && scopedKey.current === key && projectSelectionRef.current === projectId) {
          skillCheckedProject.current = projectKey;
          setSkillState(current =>
            current === 'installed' || current === 'not_installed' ? current : 'error'
          );
          setSkillError(String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [page, tabId, environmentId, projectId, currentProject?.workspaceRoot, recognized]);

  useEffect(() => {
    setDetailsTaskId(null);
  }, [projectId]);

  async function action(f: () => Promise<void>) {
    if (!tabId || !environmentId || !currentProject) return;
    const key = scopedKey.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await f();
    } catch (e) {
      if (scopedKey.current === key) setError(String(e));
    } finally {
      if (scopedKey.current === key) setBusy(false);
    }
  }

  async function mutateTask(
    taskId: string,
    update: (old: TasksDocument) => TasksDocument,
    original?: Task
  ) {
    if (!tabId || !environmentId || !currentProject) return;
    const fresh = validateTasks(
      await readProjectJson<TasksDocument>(
        tabId,
        environmentId,
        currentProject.workspaceRoot,
        'tasks.json',
        emptyTasks()
      )
    );
    const current = fresh.tasks.find(t => t.id === taskId);
    if (original && JSON.stringify(original) !== JSON.stringify(current))
      throw new Error('Task changed in another panel. Refresh before editing again.');
    const next = update(fresh);
    validateTasks(next);
    const key = scopedKey.current;
    await writeProjectJson(tabId, environmentId, currentProject.workspaceRoot, 'tasks.json', next);
    if (scopedKey.current === key && projectSelectionRef.current === projectId) {
      ++filesVersion.current;
      setTasks(next);
      setNotice('Saved to .t3/tasks.json');
    }
  }

  async function saveTask(draft: Task) {
    if (!draft.title.trim() || !draft.prompt.trim())
      throw new Error('Title and prompt are required');
    const original = tasks.tasks.find(t => t.id === draft.id);
    await mutateTask(
      draft.id,
      document => ({
        ...document,
        tasks: original
          ? document.tasks.map(t => (t.id === draft.id ? structuredClone(draft) : t))
          : [...document.tasks, structuredClone(draft)],
      }),
      original
    );
    setIsEditorOpen(false);
    setEditingTask(null);
  }

  async function moveTask(task: Task, status: TaskStatus, beforeTaskId?: string) {
    if (beforeTaskId === task.id && getTaskColumn(task, runtime) === status) return;
    await mutateTask(
      task.id,
      document => ({
        ...document,
        tasks: moveBoardItem(document.tasks, task.id, status, beforeTaskId, t =>
          getTaskColumn(t, runtime)
        ),
      }),
      task
    );
  }

  async function enqueue(
    task: Task,
    workspaceMode: WorkspaceMode,
    worktree: string,
    schedule: string
  ) {
    if (parsedRunner.installed && !parsedRunner.bridgeMissing && runnerHostAvailable)
      await manageRunner('add');
    const when = schedule ? new Date(schedule).toISOString() : undefined;
    await mutateTask(
      task.id,
      document => ({
        ...document,
        tasks: document.tasks.map(t =>
          t.id === task.id
            ? {
                ...t,
                status: 'todo' as TaskStatus,
                statusOverride: false,
                executionRequests: [
                  ...(t.executionRequests || []),
                  {
                    requestId: crypto.randomUUID(),
                    ...(when ? { notBefore: when } : {}),
                    ...(workspaceMode !== 'root' && worktree.trim()
                      ? { worktree: worktree.trim() }
                      : {}),
                    workspace: workspaceMode,
                  },
                ],
              }
            : t
        ),
      }),
      task
    );
    // Remember workspace settings
    if (currentProject) {
      setPreferences(p => ({
        ...p,
        workspaceByProject: {
          ...p.workspaceByProject,
          [scopeKey(environmentId, currentProject.workspaceRoot)]: {
            mode: workspaceMode,
            baseRef: worktree,
          },
        },
      }));
    }
    const ready = parsedRunner.installed && parsedRunner.running && runnerHostAvailable;
    setNotice(
      ready
        ? 'Queued. Runner will dispatch when eligible.'
        : 'Queued. Open Overview to verify Runner setup and project registration before execution.'
    );
  }

  async function manageRunner(
    verb: 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove' | 'configure',
    target?: string
  ) {
    if (!tabId || !currentProject) return;
    const host = visibleThreads[0] || threads.find(t => projects.some(p => p.id === t.projectId));
    const hostProject = host && projects.find(p => p.id === host.projectId);
    if (!host || !hostProject)
      throw new Error('Open a T3 thread in this environment first; Terminal RPC requires a host thread.');
    const key = scopedKey.current;
    runnerActionInFlight.current = true;
    setRunnerBusy(true);
    if (scopedKey.current === key) setRunnerStatusError('');
    try {
      if (verb === 'stop' || verb === 'start' || verb === 'install') {
        const enabled = verb !== 'stop';
        runnerAutoStartRef.current = enabled;
        await chrome.storage.local.set({ ['runnerAutoStartDisabled:' + environmentId]: !enabled });
        if (scopedKey.current === key) setRunnerAutoStart(enabled);
      }
      const result = await runnerCommand(
        tabId,
        environmentId,
        hostProject,
        host.id,
        verb,
        verb === 'configure'
          ? target
          : ['add', 'remove'].includes(verb)
          ? currentProject.workspaceRoot
          : undefined
      );
      if (scopedKey.current === key) {
        setRunnerResult(result);
        setRunnerCacheAt(null);
        setRunnerStatusError('');
        void chrome.storage.local.set({
          [cacheKey('runner', environmentId)]: { value: result, verifiedAt: Date.now() },
        });
        if (verb !== 'status')
          setNotice(verb === 'install' ? 'Runner installed and started.' : 'Runner: ' + verb);
      }
    } catch (err) {
      if (scopedKey.current === key && verb === 'status') {
        setRunnerStatusError(String(err));
        setRunnerResult(current =>
          current.startsWith('{') ? current : 'Runner check failed: ' + String(err)
        );
      }
      if (verb !== 'status') throw err;
    } finally {
      runnerActionInFlight.current = false;
      setRunnerBusy(false);
    }
  }

  async function manageSkill(verb: 'status' | 'install' | 'update' | 'reinstall') {
    if (!tabId || !environmentId || !currentProject) return;
    const key = scopedKey.current;
    const selectedProjectId = projectId;
    setSkillBusy(true);
    setSkillError('');
    try {
      if (verb !== 'status') {
        const host =
          visibleThreads[0] || threads.find(t => projects.some(p => p.id === t.projectId));
        const hostProject = host && projects.find(p => p.id === host.projectId);
        if (!host || !hostProject)
          throw new Error('Open a T3 thread in this environment before installing the skill.');
        await installProjectSkill(
          tabId,
          environmentId,
          hostProject,
          host.id,
          currentProject.workspaceRoot,
          verb
        );
      }
      const installed = await isProjectSkillInstalled(
        tabId,
        environmentId,
        currentProject.workspaceRoot
      );
      if (verb !== 'status' && !installed)
        throw new Error(
          'Installer completed but no project skill was found. Check the terminal output or install manually.'
        );
      if (scopedKey.current === key && projectSelectionRef.current === selectedProjectId) {
        skillCheckedProject.current = key + ':' + currentProject.workspaceRoot;
        const state = installed ? 'installed' : 'not_installed';
        setSkillState(state);
        setSkillCacheAt(null);
        void chrome.storage.local.set({
          [cacheKey('skill', environmentId, currentProject.workspaceRoot)]: {
            value: state,
            verifiedAt: Date.now(),
          },
        });
        if (verb !== 'status') setNotice('Agent Skill: ' + verb + ' completed.');
        if (verb === 'install') setNotice('Agent skill installed for this project.');
      }
    } catch (err) {
      if (scopedKey.current === key && projectSelectionRef.current === selectedProjectId) {
        setSkillState('error');
        setSkillError(String(err));
      }
      throw err;
    } finally {
      setSkillBusy(false);
    }
  }

  async function openLinkedThread(threadId: string): Promise<boolean> {
    const url = environmentThreadUrl(tabUrl, environmentId, threadId);
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

  async function selectEnvironmentTab(value: string) {
    if (value === 'auto') {
      setManualTabId(null);
      setManualEnvironmentId('');
      return;
    }
    const id = Number(value);
    const tab = tabChoices.find(t => t.id === id);
    if (!tab?.url || !isSafeOrigin(tab.url)) return;
    try {
      const site = new URL(tab.url);
      const origin = site.protocol + '//' + site.hostname + '/*';
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error('Browser permission for the selected T3 host was declined.');
      setManualTabId(id);
      setManualEnvironmentId('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function clearBrowserData() {
    await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]);
    setConfirmClear(false);
    window.location.reload();
  }

  const {
    dragTaskId,
    dragTarget,
    dropHint,
    dragPreview,
    suppressDraggedClick,
    beginTaskPointer,
    keyboardMoveTask,
  } = useBoardDragDrop({
    tasks,
    compactBoard,
    expandedLanes,
    scopedKey: scopedKey.current,
    projectId,
    environmentId,
    page,
    busy,
    onMoveTask: async (task, status, beforeTaskId) => {
      await action(() => moveTask(task, status, beforeTaskId));
    },
    onExpandLane: status => {
      const expanded = { ...expandedLanes, [status]: true };
      setExpandedLanes(expanded);
      setPreferences(p => ({ ...p, expandedLanes: expanded }));
    },
  });

  const savedWorkspace =
    preferences.workspaceByProject[scopeKey(environmentId, currentProject?.workspaceRoot || '')];

  return (
    <main className="stack sidepanel">
      <Header
        recognized={recognized}
        busy={busy}
        tabUrl={tabUrl}
        manualTabId={manualTabId}
        tabChoices={tabChoices}
        sessionEnvironments={sessionEnvironments}
        manualEnvironmentId={manualEnvironmentId}
        environmentLabel={environmentLabel}
        projects={projects}
        projectId={projectId}
        currentProject={currentProject}
        page={page}
        onSelectTab={selectEnvironmentTab}
        onSelectEnvironment={envId => {
          setManualEnvironmentId(envId);
          setPreferences(p => ({ ...p, manualEnvironmentId: envId }));
        }}
        onSelectProject={id => {
          manualProject.current = true;
          setProjectId(id);
          setPreferences(p => ({
            ...p,
            projectByEnvironment: { ...p.projectByEnvironment, [environmentId]: id },
          }));
        }}
        onRefreshConnection={() => refresh(true)}
        onSelectPage={p => {
          setPage(p);
          setPreferences(prev => ({ ...prev, page: p }));
        }}
      />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {!recognized ? (
        <section className="empty-view">
          <h2>Connect to T3 Code</h2>
          <p className="muted">
            Open a T3 Web tab with an authenticated environment. Companion uses that tab's existing
            session; on the T3 home page, select an environment above.
          </p>
          <button onClick={() => void refresh()}>Retry detection</button>
        </section>
      ) : !currentProject || tabId === null ? (
        <section className="empty-view">
          <p>No projects found in this T3 environment.</p>
        </section>
      ) : page === 'kanban' ? (
        <BoardView
          tasks={tasks}
          runtime={runtime}
          compactBoard={compactBoard}
          expandedLanes={expandedLanes}
          dragTarget={dragTarget}
          dragTaskId={dragTaskId}
          dropHint={dropHint}
          busy={busy}
          suppressDraggedClick={suppressDraggedClick}
          onRefreshTasks={() => {
            if (tabId && environmentId && currentProject)
              void action(() => refreshFiles(tabId, environmentId, currentProject));
          }}
          onNewTask={() => {
            setEditingTask(null);
            setIsEditorOpen(true);
          }}
          onToggleLane={status => {
            setExpandedLanes(current => {
              const next = { ...current, [status]: !current[status] };
              setPreferences(p => ({ ...p, expandedLanes: next }));
              return next;
            });
          }}
          beginTaskPointer={beginTaskPointer}
          onOpenTask={task => {
            setDetailsTaskId(task.id);
          }}
          onRequestExecution={task => setQueueTarget(task)}
          onEditTask={task => {
            setEditingTask(task);
            setIsEditorOpen(true);
          }}
          onDeleteTask={task => {
            setConfirmation({
              title: 'Delete task?',
              description:
                'This removes the task from Companion Board. It does not delete T3 threads or Git worktrees.',
              confirmLabel: 'Delete task',
              dangerous: true,
              run: async () =>
                mutateTask(
                  task.id,
                  d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id) }),
                  task
                ),
            });
          }}
          onMoveTask={(task, status) => void action(() => moveTask(task, status))}
          keyboardMoveTask={(event, task) =>
            keyboardMoveTask(event, task, t => getTaskColumn(t, runtime))
          }
        />
      ) : (
        <OverviewView
          projectTitle={currentProject.title}
          tasks={tasks}
          runtime={runtime}
          runner={parsedRunner}
          runnerHostAvailable={runnerHostAvailable}
          runnerBusy={runnerBusy}
          runnerAutoStart={runnerAutoStart}
          runnerCacheAt={runnerCacheAt}
          runnerStatusError={runnerStatusError}
          skillState={skillState}
          skillBusy={skillBusy}
          skillError={skillError}
          skillCacheAt={skillCacheAt}
          tabId={tabId}
          environmentId={environmentId}
          currentProjectRoot={currentProject?.workspaceRoot}
          recognized={recognized}
          busy={busy}
          onRefreshOverview={() => {
            if (tabId && environmentId && currentProject)
              void action(() => refreshFiles(tabId, environmentId, currentProject));
          }}
          onManageRunner={manageRunner}
          onSetAutoStart={enabled => {
            runnerAutoStartRef.current = enabled;
            setRunnerAutoStart(enabled);
            void chrome.storage.local.set({
              ['runnerAutoStartDisabled:' + environmentId]: !enabled,
            });
          }}
          onConfirmRunnerReinstall={() => {
            setConfirmation({
              title: 'Re-install Runner?',
              description:
                'Runner will drain active tasks, replace its executable files, and restart if it was running. Project registration, tasks and execution history are preserved.',
              confirmLabel: 'Re-install',
              run: async () => manageRunner('reinstall'),
            });
          }}
          onManageSkill={manageSkill}
          onConfirmSkillReinstall={() => {
            setConfirmation({
              title: 'Re-install Agent Skill?',
              description:
                'The Agent Skill will be re-installed in the current project. Existing task files are preserved.',
              confirmLabel: 'Re-install',
              run: async () => manageSkill('reinstall'),
            });
          }}
          onRequestClearBrowserData={() => setConfirmClear(true)}
        />
      )}

      {/* Modals */}
      <ConfirmModal
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
        busy={busy}
      />
      <ClearBrowserDataModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onClear={() => action(clearBrowserData)}
        busy={busy}
      />
      <TaskDetailsModal
        task={detailsTask}
        runtime={runtime}
        tabUrl={tabUrl}
        environmentId={environmentId}
        environmentThreadUrl={environmentThreadUrl}
        onClose={() => setDetailsTaskId(null)}
        onEdit={task => {
          setEditingTask(task);
          setIsEditorOpen(true);
        }}
        onQueue={task => setQueueTarget(task)}
        onOpenThread={openLinkedThread}
        busy={busy}
      />
      <TaskEditorModal
        open={isEditorOpen}
        task={editingTask}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingTask(null);
        }}
        onSave={draft => action(() => saveTask(draft))}
        busy={busy}
      />
      <QueueModal
        open={Boolean(queueTarget)}
        task={queueTarget}
        runnerRunning={parsedRunner.running}
        initialWorkspaceMode={savedWorkspace?.mode || 'auto'}
        initialWorktree={savedWorkspace?.baseRef || ''}
        onClose={() => setQueueTarget(null)}
        onQueue={async (task, mode, worktree, schedule) => {
          await action(() => enqueue(task, mode, worktree, schedule));
          setQueueTarget(null);
        }}
        busy={busy}
      />

      {/* Floating drag preview */}
      {dragPreview && (
        <div
          className="board-drag-preview"
          role="presentation"
          style={{
            left: Math.max(8, Math.min(dragPreview.x + 14, window.innerWidth - 220)),
            top: Math.max(8, Math.min(dragPreview.y + 14, window.innerHeight - 55)),
          }}
        >
          <span className="board-drag-preview-icon" aria-hidden="true">
            ⠿
          </span>
          <span>{dragPreview.title}</span>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
