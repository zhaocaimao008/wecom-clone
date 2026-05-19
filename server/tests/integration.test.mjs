/**
 * Server integration tests — Node 20 built-in test runner.
 * Run: node --test server/tests/integration.test.mjs
 *
 * Tests hit the live server on port 3001 using unique timestamped users
 * so they don't pollute real data and can run safely at any time.
 * Invite code TEST_INTEGRATION (max_uses=9999, expires 2099) is pre-seeded.
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:3001';

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, body: json };
}

const GET  = (p, tok)      => req('GET',    p, undefined, tok);
const POST = (p, b, tok)   => req('POST',   p, b,         tok);
const PUT  = (p, b, tok)   => req('PUT',    p, b,         tok);
const DEL  = (p, tok)      => req('DELETE', p, undefined, tok);

// base36 timestamp keeps usernames short (≤20 chars with prefix)
const ts36 = () => Date.now().toString(36);

async function register(prefix) {
  const name = `t${prefix}${ts36()}`.slice(0, 20);
  const r = await POST('/api/auth/register', {
    username:         name,
    password:         'Test1234!',
    password_confirm: 'Test1234!',
    display_name:     name,
    invite_code:      'TEST_INTEGRATION',
  });
  assert.equal(r.status, 200, `register failed: ${JSON.stringify(r.body)}`);
  return r.body; // { token, user }
}

// ── 1. Auth ──────────────────────────────────────────────────────────────────
describe('Auth', () => {
  test('register + login roundtrip', async () => {
    const name = `tauth${ts36()}`.slice(0, 20);
    const reg  = await POST('/api/auth/register', {
      username: name, password: 'Test1234!', password_confirm: 'Test1234!',
      display_name: name, invite_code: 'TEST_INTEGRATION',
    });
    assert.equal(reg.status, 200);
    assert.ok(reg.body.token,    'register returns token');
    assert.ok(reg.body.user?.id, 'register returns user');

    const log = await POST('/api/auth/login', { username: name, password: 'Test1234!' });
    assert.equal(log.status, 200);
    assert.ok(log.body.token, 'login returns token');
  });

  test('wrong password → 401', async () => {
    const name = `twp${ts36()}`.slice(0, 20);
    await POST('/api/auth/register', {
      username: name, password: 'Test1234!', password_confirm: 'Test1234!',
      display_name: name, invite_code: 'TEST_INTEGRATION',
    });
    const r = await POST('/api/auth/login', { username: name, password: 'WrongPwd!' });
    assert.equal(r.status, 401);
  });

  test('no token → 401 on protected route', async () => {
    const r = await GET('/api/users/contacts');
    assert.equal(r.status, 401);
  });
});

// ── 2. Friends ───────────────────────────────────────────────────────────────
describe('Friends', () => {
  let tA, tB, uA, uB;

  before(async () => {
    ({ token: tA, user: uA } = await register('fa'));
    ({ token: tB, user: uB } = await register('fb'));
  });

  test('contacts empty before adding friend', async () => {
    const r = await GET('/api/users/contacts', tA);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(!r.body.some(c => c.id === uB.id));
  });

  test('send friend request', async () => {
    const r = await POST('/api/users/friend-requests', { targetId: uB.id }, tA);
    assert.equal(r.status, 200);
  });

  test('duplicate request returns 4xx', async () => {
    const r = await POST('/api/users/friend-requests', { targetId: uB.id }, tA);
    assert.ok(r.status >= 400, `expected 4xx, got ${r.status}`);
  });

  test('accept friend request', async () => {
    const r = await PUT(`/api/users/friend-requests/${uA.id}`, { action: 'accept' }, tB);
    assert.equal(r.status, 200);
  });

  test('contacts now contains friend with is_blocked=0', async () => {
    const r = await GET('/api/users/contacts', tA);
    assert.equal(r.status, 200);
    const friend = r.body.find(c => c.id === uB.id);
    assert.ok(friend, 'friend should appear in contacts');
    assert.equal(friend.is_blocked, 0, 'is_blocked should be 0');
  });

  test('delete friend removes from contacts', async () => {
    const del = await DEL(`/api/users/friends/${uB.id}`, tA);
    assert.equal(del.status, 200);
    const r = await GET('/api/users/contacts', tA);
    assert.ok(!r.body.some(c => c.id === uB.id), 'deleted friend should not appear');
  });
});

// ── 3. Block ─────────────────────────────────────────────────────────────────
describe('Block', () => {
  let tA, tB, uA, uB;

  before(async () => {
    ({ token: tA, user: uA } = await register('ba'));
    ({ token: tB, user: uB } = await register('bb'));
    await POST('/api/users/friend-requests', { targetId: uB.id }, tA);
    await PUT(`/api/users/friend-requests/${uA.id}`, { action: 'accept' }, tB);
  });

  test('block user → contact gets is_blocked=1', async () => {
    const r = await POST(`/api/users/block/${uB.id}`, {}, tA);
    assert.equal(r.status, 200);
    const list = await GET('/api/users/contacts', tA);
    const friend = list.body.find(c => c.id === uB.id);
    assert.ok(friend,                     'friend still in contacts after block');
    assert.equal(friend.is_blocked, 1,    'is_blocked should be 1');
  });

  test('unblock → is_blocked back to 0', async () => {
    const r = await DEL(`/api/users/block/${uB.id}`, tA);
    assert.equal(r.status, 200);
    const list = await GET('/api/users/contacts', tA);
    const friend = list.body.find(c => c.id === uB.id);
    assert.equal(friend?.is_blocked, 0);
  });

  test('block non-friend returns 200 (block anyone)', async () => {
    const stranger = await register('bs');
    const r = await POST(`/api/users/block/${stranger.user.id}`, {}, tA);
    assert.equal(r.status, 200);
    await DEL(`/api/users/block/${stranger.user.id}`, tA);
  });
});

// ── 4. Messages ───────────────────────────────────────────────────────────────
describe('Messages', () => {
  let tA, tB, uA, uB;

  before(async () => {
    ({ token: tA, user: uA } = await register('ma'));
    ({ token: tB, user: uB } = await register('mb'));
    await POST('/api/users/friend-requests', { targetId: uB.id }, tA);
    await PUT(`/api/users/friend-requests/${uA.id}`, { action: 'accept' }, tB);
  });

  test('fetch private messages (empty) → 200 array', async () => {
    const r = await GET(`/api/messages/private/${uB.id}`, tA);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  test('non-friend cannot read messages → 4xx', async () => {
    const stranger = await register('ms');
    const r = await GET(`/api/messages/private/${stranger.user.id}`, tA);
    assert.ok(r.status >= 400, `expected 4xx, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test('mark read with no lastId → 400', async () => {
    const r = await POST('/api/users/read', { peerId: uB.id }, tA);
    assert.ok(r.status >= 400, `expected 4xx, got ${r.status}`);
  });

  test('mark read with valid params → 200', async () => {
    const r = await POST('/api/users/read', { peerId: uB.id, lastId: 0 }, tA);
    assert.equal(r.status, 200);
  });
});
