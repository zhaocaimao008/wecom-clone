'use strict';

const path    = require('path');
const crypto  = require('crypto');
const express = require('/usr/local/wecom-clone/server/node_modules/express');
const Database = require('/usr/local/wecom-clone/server/node_modules/better-sqlite3');

const app = express();
const db  = new Database(path.join(__dirname, '../server/wecom.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Migrations ─────────────────────────────────────────────────
try { db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0'); } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id         TEXT PRIMARY KEY,
    code       TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    used_by    TEXT,
    created_by TEXT DEFAULT 'admin',
    max_uses   INTEGER DEFAULT 1,
    use_count  INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
try { db.exec('ALTER TABLE invite_codes ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch (_) {}

app.use(express.json({ limit: '100kb' }));

// ── Session store (TTL 7 days) ────────────────────────────────
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

function auth(req, res, next) {
  const token = req.headers['x-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
  const sess = sessions.get(token);
  if (Date.now() - sess.at > SESSION_TTL) {
    sessions.delete(token);
    return res.status(401).json({ error: '登录已过期，请重新登录', code: 'SESSION_EXPIRED' });
  }
  next();
}

// ── Login rate limiting ────────────────────────────────────────
const loginAttempts = new Map(); // ip → { count, until }
const RATE_LIMIT = 5;
const RATE_WINDOW = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (Date.now() > entry.until) { loginAttempts.delete(ip); return true; }
  return entry.count < RATE_LIMIT;
}

function recordFailedAttempt(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() > entry.until) {
    loginAttempts.set(ip, { count: 1, until: Date.now() + RATE_WINDOW });
  } else {
    entry.count++;
  }
}

// ── Login / Logout ─────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: '登录次数过多，请在 15 分钟后重试', code: 'RATE_LIMITED' });
  }
  const { username, password } = req.body || {};
  if (username === 'admin' && password === 'admin123') {
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username, at: Date.now() });
    return res.json({ token, expiresAt: Date.now() + SESSION_TTL });
  }
  recordFailedAttempt(ip);
  res.status(401).json({ error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' });
});

app.post('/api/logout', auth, (req, res) => {
  sessions.delete(req.headers['x-token']);
  res.json({ ok: true });
});

// ── Stats (Asia/Shanghai timezone for "today") ─────────────────
app.get('/api/stats', auth, (_req, res) => {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  const todayStart = new Date(utc8.getFullYear(), utc8.getMonth(), utc8.getDate())
    .toISOString().replace('T', ' ').slice(0, 19);
  const todayEnd = new Date(utc8.getFullYear(), utc8.getMonth(), utc8.getDate() + 1)
    .toISOString().replace('T', ' ').slice(0, 19);

  const row = db.prepare(`
    SELECT
      (SELECT count(*) FROM users)                                                                  AS users,
      (SELECT count(*) FROM chat_groups)                                                             AS groups,
      (SELECT count(*) FROM messages)                                                                AS messages,
      (SELECT count(*) FROM users WHERE status='online')                                             AS online,
      (SELECT count(*) FROM messages WHERE created_at >= ? AND created_at < ?)                       AS today_msgs,
      (SELECT count(*) FROM users WHERE disabled=1)                                                  AS disabled_users,
      (SELECT count(*) FROM invite_codes)                                                            AS invite_codes,
      (SELECT count(*) FROM invite_codes WHERE used_at IS NOT NULL)                                  AS used_codes
  `).get(todayStart, todayEnd);

  res.json(row);
});

// ── Users ──────────────────────────────────────────────────────
app.get('/api/users', auth, (_req, res) => {
  res.json(db.prepare(
    'SELECT id,username,display_name,department,position,phone,email,status,disabled,created_at FROM users ORDER BY id'
  ).all());
});

app.put('/api/users/:id/toggle', auth, (req, res) => {
  const u = db.prepare('SELECT disabled, username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.username === 'admin') {
    return res.status(403).json({ error: '不能禁用管理员账号', code: 'CANNOT_DISABLE_ADMIN' });
  }
  const disabled = u.disabled ? 0 : 1;
  db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled, req.params.id);
  res.json({ disabled });
});

// ── Groups ─────────────────────────────────────────────────────
app.get('/api/groups', auth, (_req, res) => {
  res.json(db.prepare(`
    SELECT g.id, g.name, g.announcement, g.created_at,
           u.display_name owner_name,
           (SELECT count(*) FROM group_members WHERE group_id=g.id) members,
           (SELECT count(*) FROM messages      WHERE group_id=g.id) msg_count
    FROM chat_groups g LEFT JOIN users u ON g.owner_id=u.id
    ORDER BY g.id
  `).all());
});

app.delete('/api/groups/:id', auth, (req, res) => {
  const g = db.prepare('SELECT id FROM chat_groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '群组不存在' });
  try {
    db.transaction(id => {
      db.prepare('DELETE FROM group_members WHERE group_id=?').run(id);
      db.prepare('DELETE FROM messages      WHERE group_id=?').run(id);
      db.prepare('DELETE FROM chat_groups WHERE id=?').run(id);
    })(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '解散群组失败', code: 'TRANSACTION_ERROR' });
  }
});

// ── Messages ───────────────────────────────────────────────────
app.get('/api/messages', auth, (req, res) => {
  const search = req.query.search || '';
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const size   = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
  const like   = `%${search}%`;

  const rows = db.prepare(`
    SELECT m.id, m.content, m.msg_type, m.recalled, m.created_at,
           s.display_name sender,
           CASE WHEN m.group_id IS NOT NULL THEN g.name ELSE r.display_name END target,
           CASE WHEN m.group_id IS NOT NULL THEN '群聊' ELSE '私聊' END chat_type
    FROM messages m
    LEFT JOIN users       s ON m.sender_id=s.id
    LEFT JOIN chat_groups g ON m.group_id=g.id
    LEFT JOIN users       r ON m.receiver_id=r.id
    WHERE m.content LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(like, size, (page - 1) * size);

  const total = db.prepare('SELECT count(*) c FROM messages WHERE content LIKE ?').get(like).c;
  res.json({ rows, total, page, size });
});

app.put('/api/messages/:id/recall', auth, (req, res) => {
  const m = db.prepare('SELECT recalled FROM messages WHERE id=?').get(req.params.id);
  if (!m)         return res.status(404).json({ error: '消息不存在' });
  if (m.recalled) return res.status(400).json({ error: '消息已撤回' });
  db.prepare("UPDATE messages SET recalled=1, content='[该消息已被管理员撤回]' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── Invite Codes ───────────────────────────────────────────────
app.get('/api/invite-codes', auth, (_req, res) => {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT ic.id, ic.code, ic.expires_at, ic.used_at, ic.used_by,
           ic.created_by, ic.max_uses, ic.use_count, ic.created_at,
           u.display_name AS used_by_name
    FROM invite_codes ic
    LEFT JOIN users u ON CAST(ic.used_by AS INTEGER) = u.id
    ORDER BY ic.rowid DESC
  `).all();

  res.json(rows.map(r => {
    let status, statusLabel;
    if (r.use_count >= r.max_uses) {
      status = 'used'; statusLabel = '已使用';
    } else if (r.expires_at < now) {
      status = 'expired'; statusLabel = '已过期';
    } else {
      status = 'unused'; statusLabel = '未使用';
    }
    return { ...r, status, statusLabel };
  }));
});

app.post('/api/invite-codes', auth, (req, res) => {
  const { days = 7, count = 1 } = req.body || {};
  const daysN = Math.max(1, Math.min(365, parseInt(days) || 7));
  const countN = Math.max(1, Math.min(100, parseInt(count) || 1));
  const expiresAt = new Date(Date.now() + daysN * 86400000).toISOString();
  const results = [];

  for (let i = 0; i < countN; i++) {
    const id = crypto.randomUUID();
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare(
      'INSERT INTO invite_codes (id, code, expires_at, created_by) VALUES (?, ?, ?, ?)'
    ).run(id, code, expiresAt, 'admin');
    results.push({ id, code, expires_at: expiresAt });
  }

  res.json({ ok: true, codes: results });
});

app.delete('/api/invite-codes/:id', auth, (req, res) => {
  const r = db.prepare('SELECT id FROM invite_codes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '邀请码不存在' });
  db.prepare('DELETE FROM invite_codes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Static files ───────────────────────────────────────────────
app.get("/", (_, res) => res.redirect("/index.html"));
app.use(express.static(__dirname));

// ── Start ───────────────────────────────────────────────────────
app.listen(3002, '0.0.0.0', () => console.log('Admin panel → http://0.0.0.0:3002'));
