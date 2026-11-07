/** Pure Kanban move operations shared by pointer, keyboard and task menus. */
export type BoardMoveTask = { id: string; status: string; statusOverride?: boolean };

/**
 * Move a task to another lane or reorder it immediately before a peer.
 * A missing beforeTaskId appends at the end of the target lane's displayed
 * order, not the entire task document.
 */
export function moveBoardItem<T extends BoardMoveTask>(
  tasks: readonly T[], taskId: string, nextStatus: T['status'], beforeTaskId?: string,
): T[] {
  const source = tasks.find(task => task.id === taskId);
  if (!source) return [...tasks];
  if (beforeTaskId === taskId && source.status === nextStatus && source.statusOverride) return [...tasks];

  const remaining = tasks.filter(task => task.id !== taskId);
  const inTargetLane = remaining.filter(task => task.status === nextStatus);
  const targetPeer = beforeTaskId && inTargetLane.find(task => task.id === beforeTaskId);
  // Keep unaffected lanes in their original order. If there is a peer, insert
  // before it; otherwise append after the last target-lane task.
  let insertion = targetPeer ? remaining.findIndex(task => task.id === targetPeer.id) : -1;
  if (insertion < 0) {
    const last = inTargetLane.at(-1);
    insertion = last ? remaining.findIndex(task => task.id === last.id) + 1 : remaining.length;
  }
  const result = [...remaining];
  result.splice(insertion, 0, { ...source, status: nextStatus, statusOverride: true });
  return result;
}

export type DragDropHint = {
  lane: string;
  beforeTaskId?: string;
  hoveredTaskId?: string;
  edge?: 'before' | 'after';
};

/** Pure midpoint rule for the drop line, including the after-last-item case. */
export function insertionHint(
  hoveredTaskId: string,
  pointerY: number,
  cardMidpointY: number,
  nextTaskId?: string,
): Pick<DragDropHint, 'beforeTaskId' | 'hoveredTaskId' | 'edge'> {
  return pointerY < cardMidpointY
    ? { hoveredTaskId, beforeTaskId: hoveredTaskId, edge: 'before' }
    : { hoveredTaskId, beforeTaskId: nextTaskId, edge: 'after' };
}
