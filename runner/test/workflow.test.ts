import test from 'node:test';
import assert from 'node:assert/strict';
import { projectThreadInspection } from '../src/workflow.ts';

function thread(status: string, pendingRequestCount = 0, pullRequests: unknown[] = []) {
  return { thread: { status, pendingRequestCount, pullRequests }, messages: [] };
}
const pr = (state: unknown, url = 'https://github.com/org/repo/pull/18') => ({ source: 'agent', url, state });

test('pending T3 input overrides any PR state and requires human review', () => {
  const waiting = projectThreadInspection(thread('running', 1, [pr('merged')]));
  assert.equal(waiting?.stage, 'human_review');
  assert.equal(waiting?.pendingRequestCount, 1);
});

test('running T3 session stays in progress even if a PR already exists', () => {
  assert.equal(projectThreadInspection(thread('running', 0, [pr('open')]))?.stage, 'in_progress');
});

test('completed work with a live PR/MR is awaiting merge', () => {
  const state = projectThreadInspection(thread('completed', 0, [pr('open')]));
  assert.equal(state?.stage, 'awaiting_merge');
  assert.deepEqual(state?.changeRequests, [{ url: 'https://github.com/org/repo/pull/18', state: 'open' }]);
});

test('all verified linked PR/MRs must be merged before automatic Done', () => {
  assert.equal(projectThreadInspection(thread('completed', 0, [pr('merged')]))?.stage, 'done');
  assert.equal(projectThreadInspection(thread('completed', 0, [pr('merged'), pr('open', 'https://gitlab.com/org/repo/-/merge_requests/4')]))?.stage, 'awaiting_merge');
});

test('missing, unknown, closed-unmerged or dismissed requests never become Done', () => {
  assert.equal(projectThreadInspection(thread('completed'))?.stage, 'human_review');
  assert.equal(projectThreadInspection(thread('completed', 0, [pr(null)]))?.stage, 'awaiting_merge');
  assert.equal(projectThreadInspection(thread('completed', 0, [pr('closed')]))?.stage, 'human_review');
  assert.equal(projectThreadInspection(thread('completed', 0, [pr('open'), pr('closed', 'https://gitlab.com/a/b/-/merge_requests/2')]))?.stage, 'human_review');
  assert.equal(projectThreadInspection(thread('completed', 0, [{ ...pr('merged'), source: 'stack-dismissed' }]))?.stage, 'human_review');
  assert.equal(projectThreadInspection({ thread: { status: 'idle', linkedPullRequest: { url: 'https://github.com/org/repo/pull/3' } } })?.stage, 'awaiting_merge');
});

test('inaccessible or malformed thread metadata is not authoritative', () => {
  assert.equal(projectThreadInspection(null), null);
  assert.equal(projectThreadInspection({ thread: { status: 'unknown' } }), null);
  assert.equal(projectThreadInspection({ thread: { status: 'completed', pullRequests: [{ state: 'merged', url: 'javascript:alert(1)' }] } })?.stage, 'human_review');
});

test('failures are reviewable even with existing PR metadata', () => {
  assert.equal(projectThreadInspection(thread('failed', 0, [pr('merged')]))?.stage, 'human_review');
});
