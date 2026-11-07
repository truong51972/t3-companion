import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../popup/popup.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');

test('browser action popup has an intrinsic fixed width rather than viewport-dependent width', () => {
  // Edge/Chromium extension popups size their viewport from the DOM.
  // width:min(330px,100vw), 100dvw and similar cause a circular dependency,
  // producing a very narrow/clipped popup with a tiny scrollbar.
  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*width:\s*336px/s);
  assert.match(css, /\.popup\s*\{[^}]*width:\s*336px/s);
  assert.doesNotMatch(css, /\b(?:100)?(?:[sd]\s*)?vw\b/i);
  assert.doesNotMatch(css, /\b(?:100)?(?:[sd]\s*)?vh\b/i);
  assert.match(html, /id="root"/);
});

test('popup maintains usable actions and bounded scrolling for long content', () => {
  assert.match(css, /max-height:\s*580px/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /\.popup \.buttons button\s*\{[^}]*min-width:\s*0/s);
});
