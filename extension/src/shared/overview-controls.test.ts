import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../sidepanel/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../sidepanel/sidepanel.css', import.meta.url), 'utf8');

test('Runner and Agent Skill expander start collapsed and expose status in summary', () => {
  assert.match(code, /<details className="overview-expander">\s*<summary><span className="overview-expander-title">Runner<\/span>/);
  assert.match(code, /<details className="overview-expander">\s*<summary><span className="overview-expander-title">Agent Skill<\/span>/);
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
  for (const item of ['Update Runner','Re-install Runner','Register project','Unregister project','Auto-start when connected','Diagnostics'])
    assert.ok(runnerMenu.includes(item), 'Runner More contains '+item);
  for (const item of ['Update Skill','Re-install Skill'])
    assert.ok(skillMenu.includes(item), 'Skill More contains '+item);
  assert.match(code, /runnerActionsMenu\.current\?\.removeAttribute\('open'\)/);
  assert.match(code, /skillActionsMenu\.current\?\.removeAttribute\('open'\)/);
  assert.match(css, /\.service-menu\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:360px\)/);
});
