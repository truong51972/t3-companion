import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readSidepanelCode(dir: string): string {
  let content = '';
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) content += '\n' + readSidepanelCode(full);
    else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith('.test.ts')) content += '\n' + readFileSync(full, 'utf8');
  }
  return content;
}

const code = readSidepanelCode(fileURLToPath(new URL('../sidepanel', import.meta.url)));
const css = readFileSync(new URL('../sidepanel/sidepanel.css', import.meta.url), 'utf8');

test('Board drag supports all pointer devices instead of native HTML5 draggable buttons', () => {
  assert.match(code, /onPointerDown=\{event => beginTaskPointer\(event, task.id\)\}/);
  assert.match(code, /window.addEventListener\('pointermove', onMove, \{ passive: false \}\)/);
  assert.match(code, /window.addEventListener\('pointerup', onEnd\)/);
  assert.match(code, /window.addEventListener\('pointercancel', onCancel\)/);
  assert.match(code, /pointerType === 'touch' && !target.closest\('\.drag-handle'\)/);
  assert.match(code, /onClickCapture=\{event =>/);
  assert.doesNotMatch(code, /onDragStart=/);
  assert.doesNotMatch(code, /draggable\s+aria-label=/);
  assert.match(css, /\.task-card \.drag-handle\{[\s\S]*?touch-action:none/);
});

test('dropping on lanes, including empty and collapsed statuses, has visible feedback', () => {
  assert.match(code, /data-lane-status=\{column.key\}/);
  assert.match(code, /data-task-id=\{task.id\}/);
  assert.match(code, /document.elementFromPoint\(x, y\)/);
  assert.match(code, /if \(!card \|\| !lane.contains\(card\)/);
  assert.match(code, /setExpandedLanes\(expanded\)/);
  assert.match(code, /moveTask\(item, status, hint.beforeTaskId\)/);
  assert.match(code, /dropHint\?\.hoveredTaskId === task.id/);
  assert.match(css, /\.task-drop-before::before,\.task-drop-after::after/);
  assert.match(css, /\.board-drag-preview\{/);
  assert.match(css, /pointer-events:none/);
});

test('drag grip supports keyboard reordering and status changes', () => {
  assert.match(code, /onKeyDown=\{event => keyboardMoveTask\(event, task\)\}/);
  assert.match(code, /'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'/);
  assert.match(code, /await moveTask\(task, destination, beforeTaskId\)/);
  assert.match(code, /grip\?\.focus\(\)/);
  assert.match(code, /Move to<select aria-label=\{'Move ' \+ task.title\} value=\{taskColumn\(task\)\}/);
});
