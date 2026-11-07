import React from 'react';
import { Chevron } from '../Common';
import { RunnerExpander } from './RunnerExpander';
import { SkillExpander, type SkillState } from './SkillExpander';
import { BOARD_COLUMNS, getTaskColumn, type TasksDocument, type RuntimeDocument, type ParsedRunnerState } from '../../../shared/domain-types';

export function OverviewView({
  projectTitle,
  tasks,
  runtime,
  runner,
  runnerHostAvailable,
  runnerBusy,
  runnerAutoStart,
  runnerCacheAt,
  runnerStatusError,
  skillState,
  skillBusy,
  skillError,
  skillCacheAt,
  tabId,
  environmentId,
  currentProjectRoot,
  recognized,
  busy,
  onRefreshOverview,
  onManageRunner,
  onSetAutoStart,
  onConfirmRunnerReinstall,
  onManageSkill,
  onConfirmSkillReinstall,
  onRequestClearBrowserData,
}: {
  projectTitle: string;
  tasks: TasksDocument;
  runtime: RuntimeDocument;
  runner: ParsedRunnerState;
  runnerHostAvailable: boolean;
  runnerBusy: boolean;
  runnerAutoStart: boolean;
  runnerCacheAt: number | null;
  runnerStatusError: string;
  skillState: SkillState;
  skillBusy: boolean;
  skillError: string;
  skillCacheAt: number | null;
  tabId: number | null;
  environmentId: string;
  currentProjectRoot?: string;
  recognized: boolean;
  busy: boolean;
  onRefreshOverview: () => void;
  onManageRunner: (
    verb: 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove' | 'configure',
    target?: string
  ) => Promise<void>;
  onSetAutoStart: (enabled: boolean) => void;
  onConfirmRunnerReinstall: () => void;
  onManageSkill: (verb: 'status' | 'install' | 'update' | 'reinstall') => Promise<void>;
  onConfirmSkillReinstall: () => void;
  onRequestClearBrowserData: () => void;
}) {
  const visibleRequestIds = new Set(
    tasks.tasks.flatMap(task => (task.executionRequests || []).map(r => r.requestId))
  );

  const attentionTasks = tasks.tasks.filter(task => {
    const latest = task.executionRequests?.at(-1);
    const entry = latest ? runtime.requests[latest.requestId] : undefined;
    return entry && ['blocked', 'failed', 'needs_reconciliation'].includes(entry.status);
  });
  const recent = tasks.tasks.flatMap(task => (task.executionRequests || []).map(request => ({
    task,
    request,
    entry: runtime.requests[request.requestId],
  }))).filter(item => item.entry?.startedAt || item.entry?.finishedAt)
    .sort((a, b) => (b.entry?.startedAt || '').localeCompare(a.entry?.startedAt || '')).slice(0, 5);

  const metrics = [
    { label: 'Tasks', value: tasks.tasks.length },
    {
      label: 'Queued',
      value: tasks.tasks.reduce(
        (sum, task) =>
          sum +
          (task.executionRequests || []).filter(request => !runtime.requests[request.requestId])
            .length,
        0
      ),
    },
    {
      label: 'Running',
      value: Object.entries(runtime.requests).filter(
        ([id, entry]) => visibleRequestIds.has(id) && entry.status === 'dispatching'
      ).length,
    },
    {
      label: 'Attention',
      value: Object.entries(runtime.requests).filter(
        ([id, entry]) =>
          visibleRequestIds.has(id) &&
          ['blocked', 'failed', 'needs_reconciliation'].includes(entry.status)
      ).length,
    },
  ];

  return (
    <section className="overview-view">
      <div className="view-header">
        <div className="view-title">
          <h2>Overview</h2>
          <span className="muted">{projectTitle}</span>
        </div>
        <button
          type="button"
          className="runner-refresh"
          aria-label="Refresh project overview"
          title="Refresh overview"
          disabled={busy}
          onClick={onRefreshOverview}
        >
          ↻
        </button>
      </div>
      <div className="overview-content">
        <div className="overview-metrics">
          {metrics.map(metric => (
            <div className="overview-metric" key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
        <div className="overview-breakdown" aria-label="Task status breakdown">
          {BOARD_COLUMNS.map(column => {
            const count = tasks.tasks.filter(
              task => getTaskColumn(task, runtime) === column.key
            ).length;
            return (
              <div className="overview-breakdown-item" key={column.key}>
                <span className={'lane-icon ' + column.key} />
                <span>{column.name}</span>
                <strong>{count}</strong>
              </div>
            );
          })}
        </div>
        {(attentionTasks.length > 0 || recent.length > 0) && (
          <div className="overview-activity">
            {attentionTasks.length > 0 && (
              <section className="activity-panel">
                <h3>Needs attention <span>{attentionTasks.length}</span></h3>
                {attentionTasks.slice(0, 4).map(task => (
                  <div className="activity-row" key={task.id}>
                    <span className="activity-dot alert" />
                    <strong title={task.title}>{task.title}</strong>
                    <span>{runtime.requests[task.executionRequests!.at(-1)!.requestId]?.status.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </section>
            )}
            {recent.length > 0 && (
              <section className="activity-panel">
                <h3>Recent executions <span>{recent.length}</span></h3>
                {recent.map(item => (
                  <div className="activity-row" key={item.request.requestId}>
                    <span className="activity-dot" />
                    <strong title={item.task.title}>{item.task.title}</strong>
                    <span>{item.entry?.workflowStage?.replaceAll('_', ' ') || item.entry?.status?.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
        <RunnerExpander
          runner={runner}
          runnerHostAvailable={runnerHostAvailable}
          runnerBusy={runnerBusy}
          runnerAutoStart={runnerAutoStart}
          runnerCacheAt={runnerCacheAt}
          runnerStatusError={runnerStatusError}
          environmentId={environmentId}
          busy={busy}
          onManageRunner={onManageRunner}
          onSetAutoStart={onSetAutoStart}
          onConfirmReinstall={onConfirmRunnerReinstall}
        />
        <SkillExpander
          skillState={skillState}
          skillBusy={skillBusy}
          skillError={skillError}
          skillCacheAt={skillCacheAt}
          runnerHostAvailable={runnerHostAvailable}
          tabId={tabId}
          environmentId={environmentId}
          currentProjectRoot={currentProjectRoot}
          recognized={recognized}
          busy={busy}
          onManageSkill={onManageSkill}
          onConfirmReinstall={onConfirmSkillReinstall}
        />
        <details className="overview-expander data-settings">
          <summary><Chevron/><span className="overview-expander-title">Browser Data</span><span className="muted">Preferences & cache</span></summary>
          <div className="overview-expander-body">
            <p className="overview-description">
              Reset Companion's browser preferences, selected environments/projects and cached
              Runner/Skill statuses. Tasks, worktrees and T3 sign-in are not affected.
            </p>
            <div className="runner-toolbar">
              <button className="danger-action" onClick={onRequestClearBrowserData}>
                Clear browser data…
              </button>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
