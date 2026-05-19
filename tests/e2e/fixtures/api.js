/**
 * Low-level HTTP helpers that talk directly to the server API.
 * Used in test fixtures to set up state without going through the UI.
 */

const BASE = 'http://127.0.0.1:3001';
const INVITE = 'TEST_INTEGRATION';

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiPut(path, body, token) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiDelete(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Register a fresh user and return { token, user } */
async function createUser(prefix = 'u') {
  const name = `${prefix}${Date.now().toString(36)}`.slice(0, 20);
  const r = await apiPost('/api/auth/register', {
    username: name,
    password: 'Test1234!',
    password_confirm: 'Test1234!',
    display_name: name,
    invite_code: INVITE,
  });
  if (r.status !== 200) throw new Error(`createUser failed: ${JSON.stringify(r.body)}`);
  return r.body; // { token, user }
}

/** Make A and B mutual friends */
async function makeFriends(tokenA, userA, tokenB, userB) {
  const req = await apiPost('/api/users/friend-requests', { targetId: userB.id }, tokenA);
  if (req.status !== 200) throw new Error(`friend-request failed: ${JSON.stringify(req.body)}`);
  const acc = await apiPut(`/api/users/friend-requests/${userA.id}`, { action: 'accept' }, tokenB);
  if (acc.status !== 200) throw new Error(`accept-request failed: ${JSON.stringify(acc.body)}`);
}

/** Create a group with given members, returns group object */
async function createGroup(token, name, memberIds) {
  const r = await apiPost('/api/groups', { name, memberIds }, token);
  if (r.status !== 200) throw new Error(`createGroup failed: ${JSON.stringify(r.body)}`);
  return r.body; // { id, name, ... }
}

/** Set mute_all on a group (owner/admin only) */
async function setMuteAll(token, groupId, mute_all) {
  const r = await apiPut(`/api/groups/${groupId}`, { mute_all }, token);
  if (r.status !== 200) throw new Error(`setMuteAll failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Kick a member from a group */
async function kickMember(token, groupId, userId) {
  const r = await apiDelete(`/api/groups/${groupId}/members/${userId}`, token);
  if (r.status !== 200) throw new Error(`kickMember failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Quit a group as a non-owner member */
async function quitGroup(token, groupId) {
  const r = await apiPost(`/api/groups/${groupId}/quit`, {}, token);
  if (r.status !== 200) throw new Error(`quitGroup failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Add a member to an existing group (owner/admin only) */
async function addGroupMember(token, groupId, userId) {
  const r = await apiPost(`/api/groups/${groupId}/members`, { userIds: [userId] }, token);
  if (r.status !== 200) throw new Error(`addGroupMember failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Set a member's role in a group (owner only) */
async function setMemberRole(token, groupId, userId, role) {
  const r = await apiPut(`/api/groups/${groupId}/members/${userId}/role`, { role }, token);
  if (r.status !== 200) throw new Error(`setMemberRole failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Rename a group (owner only) */
async function renameGroup(token, groupId, name) {
  const r = await apiPut(`/api/groups/${groupId}`, { name }, token);
  if (r.status !== 200) throw new Error(`renameGroup failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

/**
 * Bulk-insert plain text messages directly into the SQLite DB.
 * Used in scroll/pagination tests to pre-populate conversations without
 * going through the UI (which has a 300ms per-send debounce).
 *
 * senderId / receiverId are integer user IDs from createUser().user.id
 */
function bulkInsertMessages(senderId, receiverId, count, prefix = 'bulk') {
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(__dirname, '../../../server/wecom.db'));
  db.pragma('busy_timeout = 5000'); // wait up to 5s if server is writing
  const insert = db.prepare(
    'INSERT INTO messages (sender_id, receiver_id, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const ts = new Date(Date.now() - (count - i) * 2000).toISOString();
      insert.run(senderId, receiverId, `${prefix}-${i + 1}`, 'text', ts);
    }
  })();
  db.close();
}

module.exports = {
  createUser, makeFriends, apiPost, apiPut, apiDelete,
  createGroup, setMuteAll, kickMember, quitGroup, addGroupMember,
  setMemberRole, renameGroup, bulkInsertMessages,
};
