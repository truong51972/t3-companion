import { useEffect, useRef, useState } from 'react';
import { insertionHint, type DragDropHint } from '../../shared/board-move';
import { BOARD_COLUMNS, getTaskColumn, type Task, type TaskStatus, type TasksDocument } from '../../shared/domain-types';

export function useBoardDragDrop({
  tasks,
  compactBoard,
  expandedLanes,
  scopedKey,
  projectId,
  environmentId,
  page,
  busy,
  onMoveTask,
  onExpandLane,
}: {
  tasks: TasksDocument;
  compactBoard: boolean;
  expandedLanes: Record<TaskStatus, boolean>;
  scopedKey: string;
  projectId: string;
  environmentId: string;
  page: string;
  busy: boolean;
  onMoveTask: (task: Task, status: TaskStatus, beforeTaskId?: string) => Promise<void>;
  onExpandLane: (status: TaskStatus) => void;
}) {
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<TaskStatus | null>(null);
  const [dropHint, setDropHint] = useState<DragDropHint | null>(null);
  const [dragPreview, setDragPreview] = useState<{ title: string; x: number; y: number } | null>(null);

  const pointerDrag = useRef<{
    pointerId: number;
    taskId: string;
    startedX: number;
    startedY: number;
    active: boolean;
    scope: string;
    projectId: string;
    cleanup: () => void;
  } | null>(null);

  const suppressDraggedClick = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  function pointerDropHint(x: number, y: number): DragDropHint | null {
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element)) return null;
    const lane = hit.closest<HTMLElement>('.board .lane[data-lane-status]');
    const status = lane?.dataset.laneStatus;
    if (!lane || !status || !BOARD_COLUMNS.some(column => column.key === status)) return null;
    const card = hit.closest<HTMLElement>('.task-card[data-task-id]');
    if (!card || !lane.contains(card) || !card.dataset.taskId) return { lane: status };
    const visibleCards = Array.from(lane.querySelectorAll<HTMLElement>('.task-card[data-task-id]'));
    const position = visibleCards.indexOf(card);
    const nextTaskId = visibleCards[position + 1]?.dataset.taskId;
    const rect = card.getBoundingClientRect();
    return {
      lane: status,
      ...insertionHint(card.dataset.taskId, y, rect.top + rect.height / 2, nextTaskId),
    };
  }

  function beginTaskPointer(event: React.PointerEvent<HTMLElement>, taskId: string) {
    if (busy || !event.isPrimary || event.button !== 0 || pointerDrag.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('input,textarea,select,a,summary,details,.queue-button')) return;
    if (target.closest('button:not(.task-open):not(.drag-handle)')) return;
    if (event.pointerType === 'touch' && !target.closest('.drag-handle')) return;
    const task = tasksRef.current.tasks.find(item => item.id === taskId);
    if (!task) return;

    const session = {
      pointerId: event.pointerId,
      taskId,
      startedX: event.clientX,
      startedY: event.clientY,
      active: false,
      scope: scopedKey,
      projectId,
      cleanup: () => {},
    };

    const clear = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      if (pointerDrag.current === session) pointerDrag.current = null;
      document.body.classList.remove('board-pointer-dragging');
      setDragTaskId(null);
      setDragTarget(null);
      setDropHint(null);
      setDragPreview(null);
    };
    session.cleanup = clear;

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== session.pointerId) return;
      if (
        !session.active &&
        Math.hypot(move.clientX - session.startedX, move.clientY - session.startedY) < 7
      )
        return;
      if (!session.active) {
        session.active = true;
        document.body.classList.add('board-pointer-dragging');
        setDragTaskId(taskId);
      }
      move.preventDefault();
      const hint = pointerDropHint(move.clientX, move.clientY);
      setDropHint(current =>
        current?.lane === hint?.lane &&
        current?.hoveredTaskId === hint?.hoveredTaskId &&
        current?.beforeTaskId === hint?.beforeTaskId &&
        current?.edge === hint?.edge
          ? current
          : hint
      );
      const targetStatus = (hint?.lane || null) as TaskStatus | null;
      setDragTarget(current => (current === targetStatus ? current : targetStatus));
      setDragPreview({ title: task.title, x: move.clientX, y: move.clientY });

      // Auto-scroll for both compact and wide boards
      const scrollSurface = (
        document.elementFromPoint(move.clientX, move.clientY) as Element | null
      )?.closest<HTMLElement>('.lane-body');
      const boardScroll = document.querySelector<HTMLElement>('.kanban-view .board-scroll');
      const scrollArea =
        scrollSurface && scrollSurface.scrollHeight > scrollSurface.clientHeight + 4
          ? scrollSurface
          : boardScroll;
      if (scrollArea) {
        const rect = scrollArea.getBoundingClientRect();
        const speed =
          move.clientY < rect.top + 34 ? -16 : move.clientY > rect.bottom - 34 ? 16 : 0;
        if (speed) scrollArea.scrollBy(0, speed);
      }
    };

    const onEnd = (up: PointerEvent) => {
      if (up.pointerId !== session.pointerId) return;
      const wasDragging = session.active;
      const hint = wasDragging ? pointerDropHint(up.clientX, up.clientY) : null;
      clear();
      if (!wasDragging) return;
      up.preventDefault();
      suppressDraggedClick.current = taskId;
      window.setTimeout(() => {
        if (suppressDraggedClick.current === taskId) suppressDraggedClick.current = null;
      }, 300);
      if (!hint || session.scope !== scopedKey || session.projectId !== projectId) return;
      const item = tasksRef.current.tasks.find(entry => entry.id === taskId);
      if (!item) return;
      const status = hint.lane as TaskStatus;
      if (compactBoard && !expandedLanes[status]) {
        onExpandLane(status);
      }
      const moveTask = onMoveTask;
      void moveTask(item, status, hint.beforeTaskId);
    };

    const onCancel = () => clear();
    pointerDrag.current = session;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
  }

  function keyboardMoveTask(
    event: React.KeyboardEvent<HTMLButtonElement>,
    task: Task,
    taskColumn: (t: Task) => TaskStatus
  ) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key) || busy) return;
    const currentStatus = taskColumn(task);
    const currentColumn = BOARD_COLUMNS.findIndex(col => col.key === currentStatus);
    if (currentColumn < 0) return;
    const currentLane = tasks.tasks.filter(item => taskColumn(item) === currentStatus);
    const index = currentLane.findIndex(item => item.id === task.id);
    let destination = currentStatus;
    let beforeTaskId: string | undefined;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const delta = event.key === 'ArrowLeft' ? -1 : 1;
      const next = BOARD_COLUMNS[currentColumn + delta];
      if (!next) return;
      destination = next.key;
    } else {
      if (event.key === 'ArrowUp' && index > 0) beforeTaskId = currentLane[index - 1]?.id;
      else if (event.key === 'ArrowDown' && index < currentLane.length - 1)
        beforeTaskId = currentLane[index + 2]?.id;
      else return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (compactBoard && !expandedLanes[destination]) {
      onExpandLane(destination);
    }
    const moveTask = onMoveTask;
    void (async () => {
      await moveTask(task, destination, beforeTaskId);
      requestAnimationFrame(() => {
        const grip = Array.from(
          document.querySelectorAll<HTMLElement>('.task-card[data-task-id] .drag-handle')
        ).find(
          element => element.closest<HTMLElement>('.task-card')?.dataset.taskId === task.id
        );
        grip?.focus();
      });
    })();
  }

  useEffect(
    () => () => {
      pointerDrag.current?.cleanup();
    },
    [projectId, environmentId, page]
  );

  return {
    dragTaskId,
    dragTarget,
    dropHint,
    dragPreview,
    suppressDraggedClick,
    beginTaskPointer,
    keyboardMoveTask,
  };
}
