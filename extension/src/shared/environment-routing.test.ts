import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEnvironmentRoute, environmentThreadUrl, selectedThreadEnvironment } from './environment-routing.ts';

test('reads a selected T3 thread environment only from a native thread path', () => {
  assert.equal(selectedThreadEnvironment('https://app.t3.codes/env-a/thread-1'), 'env-a');
  assert.equal(selectedThreadEnvironment('https://app.t3.codes/threads/env-a/thread-1'), 'env-a');
  assert.equal(selectedThreadEnvironment('https://host.test/settings/connections'), null);
  assert.equal(selectedThreadEnvironment('https://host.test/'), null);
});

test('rejects cross-environment routes before filesystem or terminal RPCs', () => {
  assert.throws(() => assertEnvironmentRoute('https://host.test/env-b/thread-1', 'env-a'), /different environment/);
  assert.doesNotThrow(() => assertEnvironmentRoute('https://host.test/env-a/thread-1', 'env-a'));
  assert.doesNotThrow(() => assertEnvironmentRoute('https://host.test/', 'env-a'));
});

test('builds same-origin thread navigation from the verified environment, not a URL guess', () => {
  assert.equal(environmentThreadUrl('https://host.test/', 'env-a', 'thread-1'), 'https://host.test/env-a/thread-1');
  assert.equal(environmentThreadUrl('https://host.test/env-a/old-thread', 'env-a', 'thread-new'), 'https://host.test/env-a/thread-new');
  assert.equal(environmentThreadUrl('https://host.test/env-b/old', 'env-a', 'thread-new'), 'https://host.test/env-a/thread-new');
  assert.equal(environmentThreadUrl('https://host.test/', 'env-a', 'https://evil.test/'), 'https://host.test/env-a/https%3A%2F%2Fevil.test%2F');
  assert.equal(environmentThreadUrl('javascript:alert(1)', 'env-a', 't'), null);
});
