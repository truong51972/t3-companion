import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedThreadUrl } from './thread-navigation.ts';

test('uses the existing T3 thread route and preserves the origin', () => {
  assert.equal(
    linkedThreadUrl('https://t3.example.dev/env-1/current-thread', ['current-thread'], 'target-thread'),
    'https://t3.example.dev/env-1/target-thread',
  );
});

test('does not guess the environment from the home page, a draft or an unverified route', () => {
  assert.equal(linkedThreadUrl('https://t3.example.dev/', ['current-thread'], 'target-thread'), null);
  assert.equal(linkedThreadUrl('https://t3.example.dev/draft/draft-1', ['current-thread'], 'target-thread'), null);
  assert.equal(linkedThreadUrl('https://t3.example.dev/env-1/unknown-thread', ['current-thread'], 'target-thread'), null);
});

test('keeps a target thread id inside the same-origin route', () => {
  assert.equal(
    linkedThreadUrl('https://t3.example.dev/env-1/current-thread', ['current-thread'], 'https://evil.test/'),
    'https://t3.example.dev/env-1/https%3A%2F%2Fevil.test%2F',
  );
  assert.equal(linkedThreadUrl('https://t3.example.dev/env-1/current-thread', ['current-thread'], ''), null);
});
