import test from 'node:test';
import assert from 'node:assert/strict';
import { insertionHint, moveBoardItem } from './board-move.ts';

type Task = {
  id: string; status: 'todo' | 'review' | 'awaiting_merge' | 'done';
  statusOverride?: boolean; prompt?: string; executionRequests?: { requestId: string }[];
};
const create = (): Task[] => [
  { id: 'a', status: 'todo', prompt: 'Keep prompt', executionRequests: [{ requestId: '1' }] },
  { id: 'b', status: 'todo' },
  { id: 'c', status: 'review' },
  { id: 'd', status: 'review' },
];

test('pointer move persists manual lane changes without losing task payload', () => {
  const original = create();
  const moved = moveBoardItem(original, 'a', 'done');
  assert.deepEqual(moved.map(item => item.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moved.find(item => item.id === 'a'), {
    id: 'a', status: 'done', statusOverride: true, prompt: 'Keep prompt',
    executionRequests: [{ requestId: '1' }],
  });
  assert.deepEqual(original, create(), 'no in-place mutation');
});

test('reorder before and after cards inside the same lane', () => {
  const original = create();
  assert.deepEqual(moveBoardItem(original, 'b', 'todo', 'a').map(item => item.id),
    ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveBoardItem(original, 'c', 'review').map(item => item.id),
    ['a', 'b', 'd', 'c'], 'drop into lane background appends to lane end');
  assert.deepEqual(insertionHint('a', 15, 20, 'b'),
    { hoveredTaskId: 'a', beforeTaskId: 'a', edge: 'before' });
  assert.deepEqual(insertionHint('a', 25, 20, 'b'),
    { hoveredTaskId: 'a', beforeTaskId: 'b', edge: 'after' });
  assert.deepEqual(insertionHint('d', 250, 200),
    { hoveredTaskId: 'd', beforeTaskId: undefined, edge: 'after' });
});

test('reordering respects auto-projected workflow lanes, not only task.status', () => {
  const tasks: Task[] = [
    { id: 'a', status: 'todo' },
    { id: 'b', status: 'todo' }, // Runner projects this into Review
    { id: 'c', status: 'review' },
    { id: 'd', status: 'todo' },
  ];
  const actualLane = (task: Task) => task.id === 'b' ? 'review' : task.status;
  const reordered = moveBoardItem(tasks, 'd', 'review', 'c', actualLane);
  assert.deepEqual(reordered.map(task => task.id), ['a', 'b', 'd', 'c']);
  assert.equal(reordered.find(item => item.id === 'd')?.statusOverride, true);
});

test('manual Done remains possible without merge, but missing tasks and self drops are safe', () => {
  const original: Task[] = [{ id: 'a', status: 'todo' }, { id: 'b', status: 'review' }];
  assert.equal(moveBoardItem(original, 'a', 'done').at(-1)?.status, 'done');
  assert.deepEqual(moveBoardItem(original, 'missing', 'done'), original);
  assert.deepEqual(moveBoardItem(original, 'b', 'review', 'b'), original);
});

test('the drop-after-last target works even when other lanes occur later in storage', () => {
  const tasks: Task[] = [
    { id: 'a', status: 'review' },
    { id: 'b', status: 'todo' },
    { id: 'c', status: 'done' },
  ];
  assert.deepEqual(moveBoardItem(tasks, 'b', 'review').map(item => item.id),
    ['a', 'b', 'c'], 'append to target lane, not after Done');
});
