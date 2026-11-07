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

test('transient menu dismissal never closes content expanders', () => {
  const menuCode = readFileSync(new URL('../sidepanel/hooks/useMenuDismissal.ts', import.meta.url), 'utf8');
  assert.match(menuCode, /details\.connection-settings\[open\]/);
  assert.match(menuCode, /details\.service-more\[open\]/);
  assert.match(menuCode, /details\.task-detail-more\[open\]/);
  assert.doesNotMatch(menuCode, /querySelectorAll<HTMLDetailsElement>\('details\[open\]'\)/);
  assert.match(menuCode, /DISMISSABLE_MENU_SELECTOR/);
  assert.doesNotMatch(menuCode, /details\.overview-expander\[open\]/);
  assert.doesNotMatch(menuCode, /details\.advanced-options\[open\]/);
  assert.doesNotMatch(menuCode, /details\.service-help\[open\]/);
});

test('Runner and Agent Skill expander start collapsed and expose status in summary', () => {
  assert.match(code, /<details className="overview-expander">\s*<summary><Chevron\/><span className="overview-expander-title">Runner<\/span>/);
  assert.match(code, /<details className="overview-expander">\s*<summary><Chevron\/><span className="overview-expander-title">Agent Skill<\/span>/);
  assert.doesNotMatch(code, /<details className="overview-expander" open>/);
});

test('both service sections share one accessible refresh component and secondary action menu', () => {
  assert.match(code, /function ServiceRefresh\(/);
  assert.match(code, /aria-label=\{`Refresh \$\{service\} status`\}/);
  assert.match(code, /<ServiceRefresh service="Runner"/);
  assert.match(code, /<ServiceRefresh service="Agent Skill"/);
  assert.match(code, /<ServiceMore service="Runner"/);
  assert.match(code, /<ServiceMore service="Agent Skill"/);
  assert.match(code, /aria-label=\{`More \$\{service\} actions`\}/);
  assert.doesNotMatch(code, /↻ Refresh Runner/);
});

test('rare service operations remain under More and close after selection', () => {
  const runnerMenu = code.split('<ServiceMore service="Runner"')[1]?.split('</ServiceMore>')[0] || '';
  const skillMenu = code.split('<ServiceMore service="Agent Skill"')[1]?.split('</ServiceMore>')[0] || '';
  for (const item of ['Update Runner','Refresh checkout (git pull)','Register project','Unregister project','Auto-start when connected','Diagnostics'])
    assert.ok(runnerMenu.includes(item), 'Runner More contains '+item);
  for (const item of ['Update Skill','Re-install Skill'])
    assert.ok(skillMenu.includes(item), 'Skill More contains '+item);
  assert.match(code, /runnerActionsMenu\.current\?\.removeAttribute\('open'\)/);
  assert.match(code, /skillActionsMenu\.current\?\.removeAttribute\('open'\)/);
  assert.match(css, /\.overview-expander \.service-more\[open\]\{flex:0 0 30px;width:30px/);
  assert.match(css, /\.overview-expander \.service-menu\{[\s\S]*?position:absolute;z-index:40/);
  assert.match(css, /\.overview-expander \.service-menu\{[\s\S]*?width:228px/);
  assert.match(css, /\.overview-expander \.service-menu>button\{[\s\S]*?width:100%/);
  assert.match(css, /\.overview-expander \.service-actions\{[\s\S]*?flex-wrap:nowrap/);
  assert.match(css, /@media\(max-width:420px\)/);
});

test('service panels do not show a disabled legacy setting or redundant metadata', () => {
  assert.match(code, /Legacy Runner · update to enable scheduler settings and workflow scanning/);
  assert.match(code, /runnerInstalled === 'true' && !runnerBridgeMissing &&/); // actions remain gated
  assert.match(code, /runnerInstalled === 'true' && \(runnerUpgradeRequired \|\| !runnerScanInterval\)/);
  assert.match(code, /<div className="service-tools">/);
  assert.match(code, /<svg aria-hidden="true" viewBox="0 0 24 24"/);
  assert.match(css, /\.overview-expander \.runner-config\{[\s\S]*?border:0;background:transparent/);
});

test('all remaining disclosure arrows use one aligned SVG chevron with stateful rotation', () => {
  assert.match(code, /function Chevron\(/);
  assert.match(code, /<path d="m6 9 6 6 6-6"\/>/);
  for (const label of ['Runner', 'Agent Skill', 'Browser Data'])
    assert.ok(code.includes('<summary><Chevron/><span className="overview-expander-title">' + label + '</span>'));
  assert.match(code, /<Chevron className=\{'lane-chevron' \+ \(expanded \? ' is-open' : ''\)\}\/>/);
  assert.match(code, /className="task-execution-header"/);
  assert.doesNotMatch(code, /<QueueModal/);
  assert.match(code, /<summary><Chevron\/>Diagnostics<\/summary>/);
  assert.match(code, /<summary><Chevron\/>Manual setup<\/summary>/);
  assert.match(css, /\.disclosure-chevron\{[\s\S]*?transform:rotate\(-90deg\)/);
  assert.match(css, /\.overview-expander\[open\]>summary>\.disclosure-chevron/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.disclosure-chevron\{transition:none\}\}/);
  assert.doesNotMatch(css, /content:'›'/);
  assert.doesNotMatch(css, /content:'⌄'/);
});
