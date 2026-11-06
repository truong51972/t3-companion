import assert from 'node:assert/strict';
import test from 'node:test';
import { selectT3Tab } from './tab-selection.ts';

const tabs = [{ id: 1, active: false }, { id: 2, active: true }];

test('auto follows the active eligible T3 tab', () => {
  assert.equal(selectT3Tab(tabs, null, 1)?.id, 2);
});
test('auto keeps the last T3 tab when no eligible tab is active', () => {
  const inactive = tabs.map(tab => ({ ...tab, active: false }));
  assert.equal(selectT3Tab(inactive, null, 1)?.id, 1);
});
test('manual choice wins over the active tab', () => {
  assert.equal(selectT3Tab(tabs, 1, 2)?.id, 1);
});
test('does not silently switch to a different tab when manual choice is unavailable', () => {
  assert.equal(selectT3Tab(tabs, 99, 2), undefined);
});
test('auto recovers from a closed tab by choosing an eligible candidate', () => {
  assert.equal(selectT3Tab([{ id: 3, active: false }], null, 99)?.id, 3);
  assert.equal(selectT3Tab([], null, 99), undefined);
});
