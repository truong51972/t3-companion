import assert from 'node:assert/strict';
import test from 'node:test';
import { environmentThreadUrl } from './environment-routing.ts';

test('builds same-origin thread navigation from the verified environment, not a URL guess', () => {
  assert.equal(environmentThreadUrl('https://host.test/', 'env-a', 'thread-1'), 'https://host.test/env-a/thread-1');
  assert.equal(environmentThreadUrl('https://host.test/env-a/old-thread', 'env-a', 'thread-new'), 'https://host.test/env-a/thread-new');
  assert.equal(environmentThreadUrl('https://host.test/env-b/old', 'env-a', 'thread-new'), 'https://host.test/env-a/thread-new');
  assert.equal(environmentThreadUrl('https://host.test/', 'env-a', 'https://evil.test/'), 'https://host.test/env-a/https%3A%2F%2Fevil.test%2F');
  assert.equal(environmentThreadUrl('javascript:alert(1)', 'env-a', 't'), null);
});
