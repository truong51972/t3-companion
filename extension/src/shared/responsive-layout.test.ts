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

const sidepanelCss = readFileSync(new URL('../sidepanel/sidepanel.css', import.meta.url), 'utf8');
const sidepanelCode = readSidepanelCode(fileURLToPath(new URL('../sidepanel', import.meta.url)));
const popupCss = readFileSync(new URL('../popup/popup.css', import.meta.url), 'utf8');

test('compact Kanban breakpoint agrees between React and CSS for tiled windows', () => {
  assert.ok(sidepanelCode.includes("const COMPACT_BOARD_QUERY =\n  '(max-width: 799px), (min-width: 800px) and (max-width: 1199px) and (max-height: 580px)'") ||
    sidepanelCode.includes("COMPACT_BOARD_QUERY = '(max-width: 799px), (min-width: 800px) and (max-width: 1199px) and (max-height: 580px)'") ||
    sidepanelCode.includes("'(max-width: 799px), (min-width: 800px) and (max-width: 1199px) and (max-height: 580px)'"));
  assert.match(sidepanelCss, /@media\s*\(max-width:799px\),\s*\(min-width:800px\) and \(max-width:1199px\) and \(max-height:580px\)\s*\{[\s\S]*?\.board\s*\{display:flex;flex-direction:column/);
  assert.match(sidepanelCss, /@media\s*\(min-width:800px\)\s*and\s*\(max-width:1199px\)/);
  assert.match(sidepanelCss, /@media\s*\(min-width:1200px\)\s*and\s*\(min-height:620px\)/);
});

test('medium windows use content-height lanes and a single page scroll container', () => {
  assert.match(sidepanelCss, /\.kanban-view,\.overview-view\{min-width:0;overflow:hidden!important\}/);
  assert.match(sidepanelCss, /\.kanban-view \.board-scroll\{[\s\S]*?overflow-x:hidden;overflow-y:auto/);
  assert.match(sidepanelCss, /\.board\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:12px;height:auto;min-height:0/);
  assert.match(sidepanelCss, /\.lane-body\{min-height:0;max-height:none;overflow:visible\}/);
});

test('snapped-width UI preserves readable selectors, metrics and action controls', () => {
  assert.match(sidepanelCss, /@media\s*\(max-width:520px\)\s*\{[\s\S]*?\.sidepanel \.context-row\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(sidepanelCss, /\.overview-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(sidepanelCss, /\.overview-expander \.runner-toolbar>button\{[\s\S]*?min-height:34px/);
  assert.match(sidepanelCss, /@media\s*\(max-height:620px\)/);
  assert.match(sidepanelCss, /\.sidepanel \.modal\{max-height:calc\(100dvh - 12px\)\}/);
  // A browser-action popup is content-sized; using 100vw here caused Edge to
  // collapse the popup to a tiny strip. Only the Side Panel is viewport-sized.
  assert.match(popupCss, /html,\s*body,\s*#root\s*\{\s*width:\s*336px/);
  assert.match(popupCss, /\.popup\s*\{[^}]*width:\s*336px/s);
});
