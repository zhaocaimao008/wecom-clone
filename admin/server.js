'use strict';

const path      = require('path');
const crypto    = require('crypto');
const express   = require('/usr/local/wecom-clone/server/node_modules/express');
const Database  = require('/usr/local/wecom-clone/server/node_modules/better-sqlite3');
const bcrypt    = require('/usr/local/wecom-clone/server/node_modules/bcryptjs');
const speakeasy = require('/usr/local/wecom-clone/server/node_modules/speakeasy');
const QRCode    = require('/usr/local/wecom-clone/server/node_modules/qrcode');

const app = express();
const db  = new Database(path.join(__dirname, '../server/wecom.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Migrations ─────────────────────────────────────────────────
try { db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN can_invite INTEGER DEFAULT 0'); } catch (_) {}

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

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

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    TEXT,
    actor_name  TEXT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    target_name TEXT,
    details     TEXT,
    ip_address  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.json({ limit: '100kb' }));

// ── Client IP helper ────────────────────────────────────────────
function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip || (req.connection && req.connection.remoteAddress) || '';
}

// ── IP Whitelist middleware ─────────────────────────────────────
function ipWhitelistMiddleware(req, res, next) {
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key='admin_allowed_ips'").get();
    const raw = (setting && setting.value || '').trim();
    if (!raw) return next();
    const clientIp = getClientIp(req);
    const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
    const normalizedClient = clientIp.replace(/^::ffff:/, '');
    const ok = allowed.some(ip => normalizedClient === ip || clientIp === ip);
    if (ok) return next();
    return res.status(403).json({ error: '您的IP不在访问白名单中，请联系管理员', code: 'IP_FORBIDDEN' });
  } catch (_) {
    next();
  }
}
app.use('/api', ipWhitelistMiddleware);

// ── Session store ───────────────────────────────────────────────
const SESSION_TTL       = 7 * 24 * 60 * 60 * 1000;
const TOTP_PENDING_TTL  = 5 * 60 * 1000;
const sessions          = new Map();
const pendingTotp       = new Map(); // pendingToken → { username, expiresAt }

function auth(req, res, next) {
  const tkn = req.headers['x-token'];
  if (!tkn || !sessions.has(tkn))
    return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
  const sess = sessions.get(tkn);
  if (Date.now() - sess.at > SESSION_TTL) {
    sessions.delete(tkn);
    return res.status(401).json({ error: '登录已过期，请重新登录', code: 'SESSION_EXPIRED' });
  }
  req.user     = { username: sess.username };
  req.clientIp = getClientIp(req);
  next();
}

// ── Login rate limiting ─────────────────────────────────────────
const loginAttempts = new Map();
const RATE_LIMIT  = 5;
const RATE_WINDOW = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const e = loginAttempts.get(ip);
  if (!e) return true;
  if (Date.now() > e.until) { loginAttempts.delete(ip); return true; }
  return e.count < RATE_LIMIT;
}
function recordFailedAttempt(ip) {
  const e = loginAttempts.get(ip);
  if (!e || Date.now() > e.until) loginAttempts.set(ip, { count: 1, until: Date.now() + RATE_WINDOW });
  else e.count++;
}

// ── Audit helper ────────────────────────────────────────────────
function createAudit(actorId, actorName, action, targetType, targetId, targetName, details, ip) {
  db.prepare(
    'INSERT INTO audit_logs (actor_id,actor_name,action,target_type,target_id,target_name,details,ip_address) VALUES (?,?,?,?,?,?,?,?)'
  ).run(actorId, actorName, action, targetType, targetId, targetName, details, ip);
}

// ── Login ───────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: '登录次数过多，请在 15 分钟后重试', code: 'RATE_LIMITED' });

  const { username, password } = req.body || {};
  if (!username || !password) {
    recordFailedAttempt(ip);
    return res.status(400).json({ error: '请输入用户名和密码', code: 'MISSING_CREDENTIALS' });
  }
  const user = db.prepare('SELECT id,username,password,disabled,totp_secret FROM users WHERE username=? AND role=?').get(username, 'admin');
  if (!user) { recordFailedAttempt(ip); return res.status(401).json({ error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' }); }
  if (user.disabled) return res.status(403).json({ error: '账号已被禁用', code: 'ACCOUNT_DISABLED' });
  if (!bcrypt.compareSync(password, user.password)) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' });
  }
  loginAttempts.delete(ip);

  if (user.totp_secret) {
    const pendingToken = crypto.randomBytes(24).toString('hex');
    pendingTotp.set(pendingToken, { username, expiresAt: Date.now() + TOTP_PENDING_TTL });
    return res.json({ needTotp: true, pendingToken });
  }

  const tkn = crypto.randomBytes(32).toString('hex');
  sessions.set(tkn, { username, at: Date.now() });
  res.json({ token: tkn, expiresAt: Date.now() + SESSION_TTL });
});

app.post('/api/login/totp', (req, res) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: '操作太频繁', code: 'RATE_LIMITED' });

  const { pendingToken, totpCode } = req.body || {};
  if (!pendingToken || !totpCode)
    return res.status(400).json({ error: '参数缺失', code: 'MISSING_PARAMS' });

  const pending = pendingTotp.get(pendingToken);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingTotp.delete(pendingToken);
    return res.status(401).json({ error: '验证超时，请重新登录', code: 'PENDING_EXPIRED' });
  }
  const user = db.prepare('SELECT totp_secret FROM users WHERE username=?').get(pending.username);
  if (!user || !user.totp_secret)
    return res.status(401).json({ error: '验证器未配置', code: 'TOTP_NOT_CONFIGURED' });

  const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });
  if (!valid) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: '验证码错误', code: 'TOTP_INVALID' });
  }
  pendingTotp.delete(pendingToken);
  loginAttempts.delete(ip);
  const tkn = crypto.randomBytes(32).toString('hex');
  sessions.set(tkn, { username: pending.username, at: Date.now() });
  res.json({ token: tkn, expiresAt: Date.now() + SESSION_TTL });
});

app.post('/api/logout', auth, (req, res) => {
  sessions.delete(req.headers['x-token']);
  res.json({ ok: true });
});

// ── TOTP Management ─────────────────────────────────────────────
app.get('/api/admin/totp-status', auth, (req, res) => {
  const user = db.prepare('SELECT totp_secret FROM users WHERE username=?').get(req.user.username);
  res.json({ enabled: !!(user && user.totp_secret) });
});

app.post('/api/admin/totp-setup', auth, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: encodeURIComponent(`企业密信后台(${req.user.username})`),
    length: 20,
  });
  try {
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrDataUrl });
  } catch {
    res.status(500).json({ error: '生成二维码失败' });
  }
});

app.post('/api/admin/totp-enable', auth, (req, res) => {
  const { secret, code } = req.body || {};
  if (!secret || !code) return res.status(400).json({ error: '参数缺失' });
  const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) return res.status(400).json({ error: '验证码错误，请确认手机时间准确' });
  db.prepare('UPDATE users SET totp_secret=? WHERE username=?').run(secret, req.user.username);
  createAudit(req.user.username, req.user.username, 'totp_enable', 'admin', null, req.user.username, null, req.clientIp);
  res.json({ ok: true });
});

app.delete('/api/admin/totp-disable', auth, (req, res) => {
  const { code } = req.body || {};
  const user = db.prepare('SELECT totp_secret FROM users WHERE username=?').get(req.user.username);
  if (user && user.totp_secret) {
    if (!code) return res.status(400).json({ error: '请输入验证码以关闭' });
    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 1 });
    if (!valid) return res.status(400).json({ error: '验证码错误' });
  }
  db.prepare('UPDATE users SET totp_secret=NULL WHERE username=?').run(req.user.username);
  createAudit(req.user.username, req.user.username, 'totp_disable', 'admin', null, req.user.username, null, req.clientIp);
  res.json({ ok: true });
});

// ── Stats ───────────────────────────────────────────────────────
app.get('/api/stats', auth, (_req, res) => {
  const now  = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  const todayStart = new Date(utc8.getFullYear(), utc8.getMonth(), utc8.getDate())
    .toISOString().replace('T', ' ').slice(0, 19);
  const todayEnd = new Date(utc8.getFullYear(), utc8.getMonth(), utc8.getDate() + 1)
    .toISOString().replace('T', ' ').slice(0, 19);

  const row = db.prepare(`
    SELECT
      (SELECT count(*) FROM users)                                              AS users,
      (SELECT count(*) FROM chat_groups)                                        AS groups,
      (SELECT count(*) FROM messages)                                           AS messages,
      (SELECT count(*) FROM users WHERE status='online')                        AS online,
      (SELECT count(*) FROM messages WHERE created_at>=? AND created_at<?)      AS today_msgs,
      (SELECT count(*) FROM users WHERE disabled=1)                             AS disabled_users,
      (SELECT count(*) FROM invite_codes)                                       AS invite_codes,
      (SELECT count(*) FROM invite_codes WHERE used_at IS NOT NULL)             AS used_codes
  `).get(todayStart, todayEnd);
  res.json(row);
});

// ── Users ───────────────────────────────────────────────────────
app.get('/api/users', auth, (_req, res) => {
  res.json(db.prepare(
    'SELECT id,username,display_name,phone,email,status,disabled,can_invite,created_at FROM users ORDER BY id'
  ).all());
});

app.put('/api/users/:id/toggle', auth, (req, res) => {
  const u = db.prepare('SELECT disabled,username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.username === 'admin') return res.status(403).json({ error: '不能禁用管理员账号', code: 'CANNOT_DISABLE_ADMIN' });
  const disabled = u.disabled ? 0 : 1;
  db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled, req.params.id);
  createAudit(req.user.username, req.user.username, disabled ? 'user_disable' : 'user_enable', 'user', u.id, u.username, null, req.clientIp);
  res.json({ disabled });
});

app.put('/api/users/:id', auth, (req, res) => {
  const { display_name, phone, email } = req.body || {};
  const u = db.prepare('SELECT id,username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.prepare(
    'UPDATE users SET display_name=COALESCE(?,display_name), phone=COALESCE(?,phone), email=COALESCE(?,email) WHERE id=?'
  ).run(display_name || null, phone || null, email || null, req.params.id);
  createAudit(req.user.username, req.user.username, 'user_edit', 'user', u.id, u.username, null, req.clientIp);
  res.json({ ok: true });
});

app.post('/api/users/:id/reset-password', auth, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
    return res.status(400).json({ error: '密码须包含大小写字母和数字' });
  const u = db.prepare('SELECT id,username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  createAudit(req.user.username, req.user.username, 'user_reset_password', 'user', u.id, u.username, null, req.clientIp);
  res.json({ ok: true });
});

app.put('/api/users/:id/can-invite', auth, (req, res) => {
  const { enabled } = req.body;
  const u = db.prepare('SELECT id,username FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const val = enabled ? 1 : 0;
  db.prepare('UPDATE users SET can_invite=? WHERE id=?').run(val, req.params.id);
  createAudit(req.user.username, req.user.username, val ? 'invite_grant' : 'invite_revoke', 'user', u.id, u.username, null, req.clientIp);
  res.json({ can_invite: val });
});

// ── Groups ──────────────────────────────────────────────────────
app.get('/api/groups', auth, (_req, res) => {
  res.json(db.prepare(`
    SELECT g.id,g.name,g.announcement,g.created_at,
           u.display_name owner_name,
           (SELECT count(*) FROM group_members WHERE group_id=g.id) members,
           (SELECT count(*) FROM messages      WHERE group_id=g.id) msg_count
    FROM chat_groups g LEFT JOIN users u ON g.owner_id=u.id
    ORDER BY g.id
  `).all());
});

app.delete('/api/groups/:id', auth, (req, res) => {
  const g = db.prepare('SELECT id,name FROM chat_groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '群组不存在' });
  try {
    db.transaction(id => {
      db.prepare('DELETE FROM group_members WHERE group_id=?').run(id);
      db.prepare('DELETE FROM messages      WHERE group_id=?').run(id);
      db.prepare('DELETE FROM chat_groups WHERE id=?').run(id);
    })(req.params.id);
    createAudit(req.user.username, req.user.username, 'group_delete', 'group', g.id, g.name, null, req.clientIp);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: '解散群组失败', code: 'TRANSACTION_ERROR' });
  }
});

app.get('/api/groups/:id/members', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT u.id,u.display_name,u.username,gm.role,gm.joined_at
    FROM group_members gm JOIN users u ON gm.user_id=u.id
    WHERE gm.group_id=?
    ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name
  `).all(req.params.id));
});

app.delete('/api/groups/:id/members/:userId', auth, (req, res) => {
  const g = db.prepare('SELECT name,owner_id FROM chat_groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '群组不存在' });
  if (String(g.owner_id) === String(req.params.userId)) return res.status(400).json({ error: '不能移除群主' });
  const r = db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(req.params.id, req.params.userId);
  if (!r.changes) return res.status(404).json({ error: '成员不存在' });
  const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.params.userId);
  createAudit(req.user.username, req.user.username, 'group_kick', 'group', req.params.id, g.name, `kicked_user=${u && u.username}`, req.clientIp);
  res.json({ ok: true });
});

// ── Messages ─────────────────────────────────────────────────────
app.get('/api/messages', auth, (req, res) => {
  const search   = req.query.search   || '';
  const msgType  = req.query.msg_type || '';
  const chatType = req.query.chat_type || '';
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const size     = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
  const like     = `%${search}%`;

  const conditions = ['m.content LIKE ?'];
  const params     = [like];
  if (msgType)              { conditions.push('m.msg_type = ?');          params.push(msgType); }
  if (chatType === 'group') { conditions.push('m.group_id IS NOT NULL'); }
  if (chatType === 'private'){ conditions.push('m.group_id IS NULL');    }
  const where = conditions.join(' AND ');

  const rows = db.prepare(`
    SELECT m.id,m.content,m.msg_type,m.recalled,m.created_at,
           s.display_name sender,
           CASE WHEN m.group_id IS NOT NULL THEN g.name ELSE r.display_name END target,
           CASE WHEN m.group_id IS NOT NULL THEN '群聊' ELSE '私聊' END chat_type
    FROM messages m
    LEFT JOIN users       s ON m.sender_id=s.id
    LEFT JOIN chat_groups g ON m.group_id=g.id
    LEFT JOIN users       r ON m.receiver_id=r.id
    WHERE ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, size, (page - 1) * size);

  const total = db.prepare(`SELECT count(*) c FROM messages m WHERE ${where}`).get(...params).c;
  res.json({ rows, total, page, size });
});

app.put('/api/messages/:id/recall', auth, (req, res) => {
  const m = db.prepare('SELECT recalled,sender_id FROM messages WHERE id=?').get(req.params.id);
  if (!m)         return res.status(404).json({ error: '消息不存在' });
  if (m.recalled) return res.status(400).json({ error: '消息已撤回' });
  db.prepare("UPDATE messages SET recalled=1, content='[该消息已被管理员撤回]' WHERE id=?").run(req.params.id);
  createAudit(req.user.username, req.user.username, 'message_recall', 'message', parseInt(req.params.id), null, `sender_id=${m.sender_id}`, req.clientIp);
  res.json({ ok: true });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  const m = db.prepare('SELECT id,sender_id FROM messages WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '消息不存在' });
  db.prepare('DELETE FROM messages WHERE id=?').run(req.params.id);
  createAudit(req.user.username, req.user.username, 'message_delete', 'message', m.id, null, `sender_id=${m.sender_id}`, req.clientIp);
  res.json({ ok: true });
});

// ── Invite Codes ─────────────────────────────────────────────────
app.get('/api/invite-codes', auth, (_req, res) => {
  const now  = new Date().toISOString();
  const rows = db.prepare(`
    SELECT ic.id,ic.code,ic.expires_at,ic.used_at,ic.used_by,ic.created_by,ic.max_uses,ic.use_count,ic.created_at,
           u.display_name AS used_by_name
    FROM invite_codes ic LEFT JOIN users u ON CAST(ic.used_by AS INTEGER)=u.id
    ORDER BY ic.rowid DESC
  `).all();
  res.json(rows.map(r => {
    let status, statusLabel;
    if (r.use_count >= r.max_uses)  { status='used';    statusLabel='已使用'; }
    else if (r.expires_at < now)    { status='expired'; statusLabel='已过期'; }
    else                            { status='unused';  statusLabel='未使用'; }
    return { ...r, status, statusLabel };
  }));
});

app.post('/api/invite-codes', auth, (req, res) => {
  const { days=7, count=1 } = req.body || {};
  const daysN  = Math.max(1, Math.min(365, parseInt(days)  || 7));
  const countN = Math.max(1, Math.min(100, parseInt(count) || 1));
  const expiresAt = new Date(Date.now() + daysN * 86400000).toISOString();
  const results = [];
  for (let i = 0; i < countN; i++) {
    const id   = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare('INSERT INTO invite_codes (id,code,expires_at,created_by) VALUES (?,?,?,?)').run(id, code, expiresAt, 'admin');
    results.push({ id, code, expires_at: expiresAt });
  }
  createAudit(req.user.username, req.user.username, 'invite_code_create', 'invite_code', null, null, `count=${countN},days=${daysN}`, req.clientIp);
  res.json({ ok: true, codes: results });
});

app.delete('/api/invite-codes/:id', auth, (req, res) => {
  const r = db.prepare('SELECT id,code FROM invite_codes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '邀请码不存在' });
  db.prepare('DELETE FROM invite_codes WHERE id=?').run(req.params.id);
  createAudit(req.user.username, req.user.username, 'invite_code_delete', 'invite_code', r.id, r.code, null, req.clientIp);
  res.json({ ok: true });
});

// ── Audit Logs ───────────────────────────────────────────────────
app.get('/api/audit-logs', auth, (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const size   = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
  const action = req.query.action || '';
  const where  = action ? 'WHERE action = ?' : '';
  const params = action ? [action] : [];
  const rows  = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size);
  const total = db.prepare(`SELECT count(*) c FROM audit_logs ${where}`).get(...params).c;
  res.json({ rows, total, page, size });
});

// ── System Settings ──────────────────────────────────────────────
app.get('/api/settings', auth, (req, res) => {
  try {
    const rows = db.prepare('SELECT key,value FROM settings').all();
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  } catch { res.json({}); }
});

app.put('/api/settings/ip-whitelist', auth, (req, res) => {
  const ips = ((req.body && req.body.ips) || '').trim();
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('admin_allowed_ips',?)").run(ips);
  createAudit(req.user.username, req.user.username, 'settings_change', 'settings', null, 'admin_allowed_ips', `ips=${ips}`, req.clientIp);
  res.json({ ok: true });
});

// ── Static files ─────────────────────────────────────────────────
app.get('/', (_, res) => res.redirect('/index.html'));
app.use(express.static(__dirname));

app.listen(3002, '0.0.0.0', () => console.log('Admin panel → http://0.0.0.0:3002'));
