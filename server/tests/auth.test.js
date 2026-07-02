/**
 * Auth route tests — verifies JWT issuance and the /me endpoint.
 * GitHub OAuth callback is tested at the unit level (token sign/verify);
 * the full OAuth round-trip requires a live GitHub app and is not
 * appropriate for CI.
 *
 * Run: node --test tests/auth.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

import { setup, teardown, createTestUser } from './helpers/setup.js';
import { createApp }  from './helpers/app.js';
import { signToken, verifyToken } from '../src/auth/jwt.js';

let request;

before(async () => {
  await setup();
  request = supertest(createApp());
});

after(teardown);

// ── JWT unit tests ────────────────────────────────────────────────────────────
test('signToken produces a verifiable JWT', () => {
  const payload = { sub: 'user-1', username: 'alice', avatar_url: '' };
  const token   = signToken(payload);
  const decoded = verifyToken(token);
  assert.equal(decoded.sub,      payload.sub);
  assert.equal(decoded.username, payload.username);
});

test('verifyToken rejects a tampered token', () => {
  const token   = signToken({ sub: 'user-1' });
  const tampered = token.slice(0, -5) + 'XXXXX';
  assert.throws(() => verifyToken(tampered));
});

// ── /api/auth/me ──────────────────────────────────────────────────────────────
test('GET /api/auth/me - returns user profile for valid token', async () => {
  const user = await createTestUser('auth1');
  const res  = await request.get('/api/auth/me').set('Authorization', user.header);
  assert.equal(res.status, 200);
  assert.equal(res.body.username, user.username);
  assert.ok(res.body.id);
});

test('GET /api/auth/me - 401 without token', async () => {
  const res = await request.get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('GET /api/auth/me - 401 with malformed token', async () => {
  const res = await request.get('/api/auth/me').set('Authorization', 'Bearer not.a.token');
  assert.equal(res.status, 401);
});

// ── /api/auth/github redirect ─────────────────────────────────────────────────
test('GET /api/auth/github - redirects to GitHub', async () => {
  const res = await request.get('/api/auth/github');
  // Either a 302 redirect or a 200 depending on supertest follow-redirect setting
  assert.ok([301, 302].includes(res.status), `Expected redirect, got ${res.status}`);
  assert.ok(res.headers.location?.includes('github.com'), 'Should redirect to GitHub');
});
