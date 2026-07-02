/**
 * Room CRUD + snapshot/restore integration tests.
 * Requires a running postgres and redis (set DATABASE_URL, REDIS_URL, JWT_SECRET).
 *
 * Run: node --test tests/rooms.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

import { setup, teardown, createTestUser } from './helpers/setup.js';
import { createApp } from './helpers/app.js';

let request, user;

before(async () => {
  await setup();
  request = supertest(createApp());
  user    = await createTestUser('rooms1');
});

after(teardown);

let createdRoomId;
let snapshotId;

// ── Create ────────────────────────────────────────────────────────────────────
test('POST /api/rooms - creates a room', async () => {
  const res = await request
    .post('/api/rooms')
    .set('Authorization', user.header)
    .send({ name: 'Test Room', language: 'javascript' });

  assert.equal(res.status, 201);
  assert.equal(res.body.name,     'Test Room');
  assert.equal(res.body.language, 'javascript');
  assert.ok(res.body.id, 'should return an id');
  createdRoomId = res.body.id;
});

test('POST /api/rooms - rejects missing name', async () => {
  const res = await request
    .post('/api/rooms')
    .set('Authorization', user.header)
    .send({ language: 'python' });
  assert.equal(res.status, 400);
});

test('POST /api/rooms - rejects unsupported language', async () => {
  const res = await request
    .post('/api/rooms')
    .set('Authorization', user.header)
    .send({ name: 'Bad', language: 'cobol' });
  assert.equal(res.status, 400);
});

// ── List ──────────────────────────────────────────────────────────────────────
test('GET /api/rooms - returns array including created room', async () => {
  const res = await request.get('/api/rooms').set('Authorization', user.header);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  const found = res.body.find((r) => r.id === createdRoomId);
  assert.ok(found, 'created room should appear in list');
});

// ── Get single ────────────────────────────────────────────────────────────────
test('GET /api/rooms/:id - returns room with content', async () => {
  const res = await request.get(`/api/rooms/${createdRoomId}`).set('Authorization', user.header);
  assert.equal(res.status, 200);
  assert.equal(res.body.id,   createdRoomId);
  assert.ok('content' in res.body);
});

test('GET /api/rooms/:id - 404 for unknown room', async () => {
  const res = await request
    .get('/api/rooms/00000000-0000-0000-0000-000000000000')
    .set('Authorization', user.header);
  assert.equal(res.status, 404);
});

// ── Snapshots ─────────────────────────────────────────────────────────────────
test('POST /api/rooms/:id/snapshots - creates a manual snapshot', async () => {
  const res = await request
    .post(`/api/rooms/${createdRoomId}/snapshots`)
    .set('Authorization', user.header)
    .send({ label: 'My save' });

  assert.equal(res.status, 201);
  assert.equal(res.body.label, 'My save');
  snapshotId = res.body.id;
});

test('GET /api/rooms/:id/snapshots - lists snapshots with preview', async () => {
  const res = await request
    .get(`/api/rooms/${createdRoomId}/snapshots`)
    .set('Authorization', user.header);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  const snap = res.body.find((s) => s.id === snapshotId);
  assert.ok(snap, 'created snapshot should appear in list');
  assert.ok('size_bytes' in snap, 'should include size_bytes');
});

test('GET /api/rooms/:id/snapshots/:id - returns snapshot content', async () => {
  const res = await request
    .get(`/api/rooms/${createdRoomId}/snapshots/${snapshotId}`)
    .set('Authorization', user.header);

  assert.equal(res.status, 200);
  assert.ok('content' in res.body);
});

test('POST .../snapshots/:id/restore - restores content and returns revision', async () => {
  const res = await request
    .post(`/api/rooms/${createdRoomId}/snapshots/${snapshotId}/restore`)
    .set('Authorization', user.header);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(typeof res.body.revision === 'number');
});

// ── Share link ────────────────────────────────────────────────────────────────
test('POST /api/rooms/:id/share - returns share token and URL', async () => {
  const res = await request
    .post(`/api/rooms/${createdRoomId}/share`)
    .set('Authorization', user.header);

  assert.equal(res.status, 200);
  assert.ok(res.body.token,    'should return JWT token');
  assert.ok(res.body.shareUrl, 'should return share URL');
});

test('GET /api/rooms/shared/:token - returns read-only room data', async () => {
  const shareRes = await request
    .post(`/api/rooms/${createdRoomId}/share`)
    .set('Authorization', user.header);

  const { token } = shareRes.body;
  const res = await request.get(`/api/rooms/shared/${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.id, createdRoomId);
  assert.ok('content' in res.body);
});

// ── Delete ────────────────────────────────────────────────────────────────────
test('DELETE /api/rooms/:id - deletes own room', async () => {
  const res = await request
    .delete(`/api/rooms/${createdRoomId}`)
    .set('Authorization', user.header);
  assert.equal(res.status, 204);
});
