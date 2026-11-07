import React from 'react';
import { Chevron } from '../Common';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus, RuntimeDocument } from '../../../shared/domain-types';
import type { DragDropHint } from '../../../shared/board-move';

export function Lane({
  column,
  tasks,
  runtime,
  compactBoard,
  expanded,
  dragTarget,
  dragTaskId,
  dropHint,
  busy,
  suppressDraggedClick,
  onToggleExpand,
  beginTaskPointer,
  onOpenTask,
  onRequestExecution,
  onEditTask,
  onDeleteTask,
  onMoveTask,
  keyboardMoveTask,
}: {
  column: { key: TaskStatus; name: string };
  tasks: Task[];
  runtime: RuntimeDocument;
  compactBoard: boolean;
  expanded: boolean;
  dragTarget: TaskStatus | null;
  dragTaskId: string | null;
  dropHint: DragDropHint | null;
  busy: boolean;
  suppressDraggedClick?: React.MutableRefObject<string | null>;
  onToggleExpand: () => void;
  beginTaskPointer: (event: React.PointerEvent<HTMLElement>, taskId: string) => void;
  onOpenTask: (task: Task) => void;
  onRequestExecution: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onMoveTask: (task: Task, status: TaskStatus) => void;
  keyboardMoveTask: (event: React.KeyboardEvent<HTMLButtonElement>, task: Task) => void;
}) {
  const laneHeading = (
    <>
      <div className="lane-title">
        {compactBoard && <Chevron className={'lane-chevron' + (expanded ? ' is-open' : '')}/>}
        <span className={'lane-icon ' + column.key} />
        <strong>{column.name}</strong>
      </div>
      <span className="lane-count">{tasks.length}</span>
    </>
  );

  return (
    <div
      className={'lane' + (dragTarget === column.key ? ' lane-drop-target' : '')}
      key={column.key}
      data-lane-status={column.key}
    >
      {compactBoard && tasks.length > 0 ? (
        <button
          type="button"
          className="lane-heading lane-heading-toggle"
          aria-expanded={expanded}
          aria-controls={'lane-body-' + column.key}
          onClick={onToggleExpand}
        >
          {laneHeading}
        </button>
      ) : (
        <div className="lane-heading">{laneHeading}</div>
      )}
      <div id={'lane-body-' + column.key} className="lane-body" hidden={!expanded}>
        {tasks.length === 0 && <p className="lane-empty">No tasks</p>}
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            runtime={runtime}
            dragTaskId={dragTaskId}
            dropHint={dropHint}
            busy={busy}
            suppressDraggedClick={suppressDraggedClick}
            beginTaskPointer={beginTaskPointer}
            onOpenTask={onOpenTask}
            onRequestExecution={onRequestExecution}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
            onMoveTask={onMoveTask}
            keyboardMoveTask={keyboardMoveTask}
          />
        ))}
      </div>
    </div>
  );
}
