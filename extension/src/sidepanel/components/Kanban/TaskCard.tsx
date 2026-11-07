import React from 'react';
import { BOARD_COLUMNS, getTaskColumn, getTaskExecution, type Task, type TaskStatus, type RuntimeDocument } from '../../../shared/domain-types';
import type { DragDropHint } from '../../../shared/board-move';

export function TaskCard({
  task,
  runtime,
  dragTaskId,
  dropHint,
  busy,
  suppressDraggedClick,
  beginTaskPointer,
  onOpenTask,
  onRequestExecution,
  onEditTask,
  onDeleteTask,
  onMoveTask,
  keyboardMoveTask,
}: {
  task: Task;
  runtime: RuntimeDocument;
  dragTaskId: string | null;
  dropHint: DragDropHint | null;
  busy: boolean;
  suppressDraggedClick?: React.MutableRefObject<string | null>;
  beginTaskPointer: (event: React.PointerEvent<HTMLElement>, taskId: string) => void;
  onOpenTask: (task: Task) => void;
  onRequestExecution: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onMoveTask: (task: Task, status: TaskStatus) => void;
  keyboardMoveTask: (event: React.KeyboardEvent<HTMLButtonElement>, task: Task) => void;
}) {
  const taskColumn = (t: Task) => getTaskColumn(t, runtime);
  const execution = getTaskExecution(task, runtime);
  const queued = (task.executionRequests?.length ?? 0) > 0 && !execution;
  const latestRequest = execution?.changeRequests?.[0];
  const linkedThread = task.executionRequests
    ?.slice()
    .reverse()
    .map(r => runtime.requests[r.requestId]?.threadId)
    .find((id): id is string => typeof id === 'string' && id.length > 0);

  return (
    <article
      className={
        'task-card' +
        (dragTaskId === task.id ? ' task-dragging' : '') +
        (dropHint?.hoveredTaskId === task.id && dropHint.edge
          ? ' task-drop-' + dropHint.edge
          : '')
      }
      key={task.id}
      data-task-id={task.id}
      onPointerDown={event => beginTaskPointer(event, task.id)}
      onClickCapture={event => {
        if (suppressDraggedClick && suppressDraggedClick.current === task.id) {
          suppressDraggedClick.current = null;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={'Move ' + task.title + '. Drag with mouse or touch; use arrow keys to move.'}
        title="Drag task or use arrow keys to move between statuses / reorder"
        onKeyDown={event => keyboardMoveTask(event, task)}
      >
        ⠿
      </button>
      <button
        className="task-open"
        type="button"
        aria-label={'View details for ' + task.title}
        onClick={() => onOpenTask(task)}
      >
        <span className="task-head">
          <strong>{task.title}</strong>
          {task.priority === 1 && (
            <span className="priority-high" title="High priority">
              ↑
            </span>
          )}
        </span>
        {task.description && <span className="task-description">{task.description}</span>}
        <span className="task-meta">
          <span className="priority-label">P{task.priority || 2}</span>
          {task.execution?.modelSelection && (
            <span className="task-config-label" title={task.execution.modelSelection.instanceId}>
              {task.execution.modelSelection.model}
            </span>
          )}
          {task.execution && (
            <span className="task-config-label" title={task.execution.baseRef || ''}>
              {task.execution.workspace === 'root' ? 'Checkout' : 'Worktree'}
            </span>
          )}
          {(execution || queued) && (
            <span
              className={
                'execution-status ' + (execution?.workflowStage || execution?.status || 'queued')
              }
            >
              {execution?.workflowStage === 'human_review'
                ? 'Needs input / review'
                : execution?.workflowStage?.replaceAll('_', ' ') ||
                  execution?.status?.replaceAll('_', ' ') ||
                  'queued'}
            </span>
          )}
          {latestRequest && (
            <span className="linked-label" title={latestRequest.url}>
              {latestRequest.state === 'merged'
                ? 'Merged'
                : latestRequest.state === 'open'
                ? 'PR/MR open'
                : 'PR/MR linked'}
            </span>
          )}
          {linkedThread && (
            <span className="linked-label" title="Linked T3 thread">
              Thread linked
            </span>
          )}
        </span>
      </button>
      <div className="task-footer">
        <button
          className="queue-button"
          disabled={busy}
          onClick={() => onRequestExecution(task)}
        >
          Run / Queue
        </button>
        <button type="button" className="task-details-shortcut"
          aria-label={'View details for ' + task.title}
          title="View task details"
          onClick={() => onOpenTask(task)}>
          •••
        </button>
      </div>
    </article>
  );
}
