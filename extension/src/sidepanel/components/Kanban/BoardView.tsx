import React from 'react';
import { Lane } from './Lane';
import { BOARD_COLUMNS, getTaskColumn, type TasksDocument, type TaskStatus, type RuntimeDocument, type Task } from '../../../shared/domain-types';
import type { DragDropHint } from '../../../shared/board-move';

export function BoardView({
  tasks,
  runtime,
  compactBoard,
  expandedLanes,
  dragTarget,
  dragTaskId,
  dropHint,
  busy,
  suppressDraggedClick,
  onRefreshTasks,
  onNewTask,
  onToggleLane,
  beginTaskPointer,
  onOpenTask,
  onRequestExecution,
  onEditTask,
  onDeleteTask,
  onMoveTask,
  keyboardMoveTask,
}: {
  tasks: TasksDocument;
  runtime: RuntimeDocument;
  compactBoard: boolean;
  expandedLanes: Record<TaskStatus, boolean>;
  dragTarget: TaskStatus | null;
  dragTaskId: string | null;
  dropHint: DragDropHint | null;
  busy: boolean;
  suppressDraggedClick?: React.MutableRefObject<string | null>;
  onRefreshTasks: () => void;
  onNewTask: () => void;
  onToggleLane: (status: TaskStatus) => void;
  beginTaskPointer: (event: React.PointerEvent<HTMLElement>, taskId: string) => void;
  onOpenTask: (task: Task) => void;
  onRequestExecution: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onMoveTask: (task: Task, status: TaskStatus) => void;
  keyboardMoveTask: (event: React.KeyboardEvent<HTMLButtonElement>, task: Task) => void;
}) {
  return (
    <section className="kanban-view">
      <div className="view-header">
        <div className="view-title">
          <h2>Board</h2>
          <span className="muted">
            {tasks.tasks.length} {tasks.tasks.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>
        <div className="board-actions">
          <button
            type="button"
            className="runner-refresh"
            aria-label="Refresh project tasks"
            title="Refresh tasks"
            disabled={busy}
            onClick={onRefreshTasks}
          >
            ↻
          </button>
          <button className="primary compact" disabled={busy} onClick={onNewTask}>
            + New task
          </button>
        </div>
      </div>
      {tasks.tasks.length === 0 ? (
        <div className="board-empty">
          <div className="board-empty-mark" aria-hidden="true">
            ☷
          </div>
          <h3>No tasks yet</h3>
          <p>Create your first task to start organizing work.</p>
          <button type="button" className="primary compact" disabled={busy} onClick={onNewTask}>
            + New task
          </button>
        </div>
      ) : (
        <div className="board-scroll">
          <div className="board">
            {BOARD_COLUMNS.map(column => {
              const laneTasks = tasks.tasks.filter(t => getTaskColumn(t, runtime) === column.key);
              const expanded =
                !compactBoard || (laneTasks.length > 0 && expandedLanes[column.key]);
              return (
                <Lane
                  key={column.key}
                  column={column}
                  tasks={laneTasks}
                  runtime={runtime}
                  compactBoard={compactBoard}
                  expanded={expanded}
                  dragTarget={dragTarget}
                  dragTaskId={dragTaskId}
                  dropHint={dropHint}
                  busy={busy}
                  suppressDraggedClick={suppressDraggedClick}
                  onToggleExpand={() => onToggleLane(column.key)}
                  beginTaskPointer={beginTaskPointer}
                  onOpenTask={onOpenTask}
                  onRequestExecution={onRequestExecution}
                  onEditTask={onEditTask}
                  onDeleteTask={onDeleteTask}
                  onMoveTask={onMoveTask}
                  keyboardMoveTask={keyboardMoveTask}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
