import test from 'node:test';
import assert from 'node:assert/strict';
import { isT3Web } from './t3-site.ts';
test('only recognized T3 origins enable side panel', () => {
  assert.equal(isT3Web('https://app.t3.codes/chat'), true);
  assert.equal(isT3Web('http://localhost:3773/chat'), true);
  assert.equal(isT3Web('http://127.0.0.1:3773/chat'), true);
  assert.equal(isT3Web('https://evilapp.t3.codes.attacker.io'), false);
  assert.equal(isT3Web('https://google.com'), false);
  assert.equal(isT3Web('http://localhost:8000'), false);
  assert.equal(isT3Web('javascript:alert(1)'), false);
});
