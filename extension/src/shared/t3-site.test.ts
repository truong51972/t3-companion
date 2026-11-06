import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeOrigin, isT3Web, looksLikeT3 } from './t3-site.ts';
test('T3-known domains are hints; reject origin spoofing', () => {
  assert.equal(isT3Web('https://app.t3.codes/chat'), true);
  assert.equal(isT3Web('http://localhost:3773/chat'), true);
  assert.equal(isT3Web('https://evilapp.t3.codes.attacker.io'), false);
  assert.equal(isT3Web('https://google.com'), false);
  assert.equal(isT3Web('javascript:alert(1)'), false);
});
test('custom Cloudflare HTTPS origins are eligible for DOM fingerprint', () => {
  assert.equal(isSafeOrigin('https://t3.example.com/chat'), true);
  assert.equal(isSafeOrigin('https://other.example.com/chat'), true);
  assert.equal(isSafeOrigin('http://t3.example.com'), false);
  assert.equal(isSafeOrigin('http://localhost:3773'), true);
  assert.equal(isSafeOrigin('javascript:alert(1)'), false);
  assert.equal(isSafeOrigin('https://example.com@attacker.io'), false);
});
test('strong DOM fingerprint is URL independent and requires T3 PWA manifest', () => {
  const base = { root: true, manifest: true, icon: true, title: true, splash: false, composer: false };
  assert.equal(looksLikeT3(base), true);
  assert.equal(looksLikeT3({ ...base, title: false, composer: true }), true);
  assert.equal(looksLikeT3({ ...base, title: false, splash: true }), true);
  assert.equal(looksLikeT3({ ...base, manifest: false }), false);
  assert.equal(looksLikeT3({ ...base, root: false }), false);
  assert.equal(looksLikeT3({ ...base, title: false }), false);
});
