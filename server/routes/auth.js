const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const JWT_SECRET=process.env.JWT_SECRET;

// In-memory stores: phone → { code, expiresAt, count }
const smsCodes = new Map();
// In-memory store: username → { count, lockedUntil }
const loginAttempts = new Map();
// Track SMS verify failures: phone → { count, windowStart }
const smsVerifyAttempts = new Map();

const SMS_MAX_PER_PHONE = 3;      // 每手机号最多3次/分钟
const SMS_WINDOW_MS = 60 * 1000;
const SMS_VERIFY_MAX = 5;         // 验证码最多尝试5次
const SMS_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_USER = 5;    // 每账号最多5次/15分钟
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

// Periodically clean up stale in-memory entries to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of smsCodes) {
    if (v.expiresAt && v.expiresAt < now) smsCodes.delete(k);
  }
  for (const [k, v] of loginAttempts) {
    if (now - (v.windowStart || 0) > LOGIN_WINDOW_MS * 2 && !(v.lockedUntil > now)) loginAttempts.delete(k);
  }
  for (const [k, v] of smsVerifyAttempts) {
    if (now - (v.windowStart || 0) > SMS_VERIFY_WINDOW_MS * 2) smsVerifyAttempts.delete(k);
  }
}, 60 * 60 * 1000).unref(); // hourly

module.exports = (db, io, qrSessions, connectedUsers = new Map(), sessionInfo = new Map()) => {
  const router = express.Router();
  const authMiddleware = require('../middleware/auth');

  // ── Helpers ─────────────────────────────────────────────────────────

  function checkSmsVerify(phone) {
    const now = Date.now();
    const entry = smsVerifyAttempts.get(phone);
    if (!entry || now - entry.windowStart > SMS_VERIFY_WINDOW_MS) {
      smsVerifyAttempts.set(phone, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= SMS_VERIFY_MAX) return false;
    entry.count++;
    return true;
  }

  function recordSmsAttempt(phone) {
    const now = Date.now();
    const entry = smsCodes.get(phone) || { count: 0, windowStart: now };
    if (now - entry.windowStart > SMS_WINDOW_MS) {
      smsCodes.set(phone, { count: 1, windowStart: now, code: undefined, expiresAt: undefined });
      return true;
    }
    if (entry.count >= SMS_MAX_PER_PHONE) return false;
    smsCodes.set(phone, { ...entry, count: entry.count + 1 });
    return true;
  }

  function recordLoginAttempt(username) {
    const now = Date.now();
    const entry = loginAttempts.get(username) || { count: 0, windowStart: now, lockedUntil: 0 };
    if (now - entry.windowStart > LOGIN_WINDOW_MS) {
      loginAttempts.set(username, { count: 1, windowStart: now, lockedUntil: 0 });
      return { allowed: true };
    }
    if (entry.lockedUntil > now) return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
    if (entry.count >= LOGIN_MAX_PER_USER) {
      loginAttempts.set(username, { ...entry, lockedUntil: now + LOCKOUT_MS });
      return { allowed: false, retryAfter: Math.ceil(LOCKOUT_MS / 1000) };
    }
    loginAttempts.set(username, { ...entry, count: entry.count + 1 });
    return { allowed: true };
  }

  // ── Login ───────────────────────────────────────────────────────────

  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' });

    const attempt = recordLoginAttempt(username);
    if (!attempt.allowed) {
      return res.status(429).json({ error: `操作太频繁，请在 ${attempt.retryAfter} 秒后重试` });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?').get(username, username);
    // Always run bcrypt to prevent timing-based username enumeration
    const passwordToCheck = user ? user.password : '$2a$10$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const match = await bcrypt.compare(password, passwordToCheck);
    if (!user || !match) return res.status(401).json({ error: '账号或密码错误' });
    if (user.disabled) return res.status(403).json({ error: '账号已被禁用，请联系管理员' });

    loginAttempts.delete(username);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userInfo } = user;
    res.json({ token, user: userInfo });
  });

  // ── Send SMS code ───────────────────────────────────────────────────

  router.post('/send-code', (req, res) => {
    const { phone } = req.body;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '请输入正确的手机号码' });
    }
    const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (!user) return res.status(404).json({ error: '该手机号未注册' });

    if (!recordSmsAttempt(phone)) {
      return res.status(429).json({ error: '发送太频繁，请稍后再试' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    smsCodes.set(phone, {
      ...(smsCodes.get(phone) || {}),
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    // TODO: 真实环境应调用短信网关（如阿里云、腾讯云）发送验证码
    // 生产环境禁止打印真实验证码，此处仅输出演示标识
    console.log(`[SMS DEMO] phone=${phone} code sent`);
    res.json({ message: '验证码已发送' });
  });

  // ── Phone + SMS code login ───────────────────────────────────────────

  router.post('/login-phone', (req, res) => {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: '请填写手机号和验证码' });

    if (!checkSmsVerify(phone)) {
      smsCodes.delete(phone); // invalidate code after too many attempts
      return res.status(429).json({ error: '验证次数过多，请重新获取验证码' });
    }

    const stored = smsCodes.get(phone);
    if (!stored || stored.expiresAt < Date.now() || stored.code !== String(code)) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }
    smsCodes.delete(phone);
    smsVerifyAttempts.delete(phone); // reset on success

    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.disabled) return res.status(403).json({ error: '账号已被禁用，请联系管理员' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userInfo } = user;
    res.json({ token, user: userInfo });
  });

  // ── Register ─────────────────────────────────────────────────────────

  router.post('/register', (req, res) => {
    const { username, password, password_confirm, display_name, invite_code } = req.body;
    if (!username || !password || !display_name) return res.status(400).json({ error: '请填写必要信息' });
    if (!invite_code) return res.status(400).json({ error: '请填写邀请码' });
    if (typeof display_name !== 'string' || display_name.trim().length < 1 || display_name.trim().length > 50)
      return res.status(400).json({ error: '昵称长度须在 1-50 字之间' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含大小写字母和数字' });
    }
    if (password !== password_confirm) return res.status(400).json({ error: '两次密码输入不一致' });
    // Username: 3-20 chars, alphanumeric + underscore only
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: '用户名仅支持字母、数字、下划线，长度3-20位' });
    }

    const now = new Date().toISOString();
    const ic = db.prepare('SELECT * FROM invite_codes WHERE code=?').get(invite_code.trim());
    if (!ic) return res.status(400).json({ error: '邀请码无效' });
    if (ic.expires_at < now) return res.status(400).json({ error: '邀请码已过期' });
    if (ic.use_count >= ic.max_uses) return res.status(400).json({ error: '邀请码已被使用' });

    const colors = ['#07c160', '#576b95', '#fa9d3b', '#e64340', '#10aec2', '#7d7d7d'];
    const color = colors[crypto.randomInt(0, colors.length)];
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, avatar_color) VALUES (?, ?, ?, ?)'
      ).run(username, hash, display_name, color);
      db.prepare('UPDATE invite_codes SET used_at=?, used_by=?, use_count=use_count+1 WHERE id=?')
        .run(now, String(result.lastInsertRowid), ic.id);
      // 自动分配唯一6位密信ID（使用 UNIQUE 索引冲突重试，避免竞态）
      for (let tries = 0; tries < 20; tries++) {
        const userCode = String(crypto.randomInt(100000, 1000000));
        try {
          db.prepare('UPDATE users SET user_code = ? WHERE id = ?').run(userCode, result.lastInsertRowid);
          break;
        } catch (uce) {
          if (!uce.message?.includes('UNIQUE') || tries >= 19) throw uce;
        }
      }
      const user = db.prepare('SELECT id, username, display_name, avatar_color, status, user_code FROM users WHERE id = ?').get(result.lastInsertRowid);
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '用户名已存在' });
      res.status(500).json({ error: '注册失败' });
    }
  });

  // ── QR Code Login ────────────────────────────────────────────────────
  // Step 1: desktop requests a QR session token
  router.post('/qr/create', (req, res) => {
    const qrToken = crypto.randomBytes(16).toString('hex');
    const expires = Date.now() + 3 * 60 * 1000; // 3 minutes
    qrSessions.set(qrToken, { status: 'pending', expires });
    res.json({ qrToken, expiresIn: 180 });
  });

  // Step 2: mobile confirms the scan (must be authenticated)
  router.post('/qr/confirm', authMiddleware, (req, res) => {
    const { qrToken } = req.body;
    if (!qrToken || typeof qrToken !== 'string') return res.status(400).json({ error: '无效参数' });
    const session = qrSessions.get(qrToken);
    if (!session) return res.status(404).json({ error: '二维码不存在或已过期' });
    if (session.status !== 'pending') return res.status(400).json({ error: '二维码已被使用' });
    if (Date.now() > session.expires) {
      qrSessions.delete(qrToken);
      return res.status(410).json({ error: '二维码已过期，请刷新重试' });
    }
    const userId = req.user.id;
    const user = db.prepare(
      'SELECT id,username,display_name,avatar_color,avatar_url,user_code,phone,email,status FROM users WHERE id=?'
    ).get(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const desktopToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    qrSessions.set(qrToken, { ...session, status: 'confirmed', desktopToken, user });
    // Notify waiting desktop via Socket.io room
    if (io) io.to(`qr:${qrToken}`).emit('qr_login_done', { token: desktopToken, user });
    res.json({ ok: true });
  });

  // ── Session management ───────────────────────────────────────────────
  router.get('/sessions', authMiddleware, (req, res) => {
    const myId = req.user.id;
    const sids = connectedUsers.get(myId) || new Set();
    const currentSocketId = req.headers['x-socket-id'] || '';
    const sessions = [];
    for (const sid of sids) {
      const info = sessionInfo.get(sid) || {};
      sessions.push({
        socketId: sid,
        connectedAt: info.connectedAt || null,
        userAgent: info.userAgent || 'Unknown',
        isCurrent: sid === currentSocketId,
      });
    }
    res.json(sessions);
  });

  router.delete('/sessions/:socketId', authMiddleware, (req, res) => {
    const myId = req.user.id;
    const { socketId } = req.params;
    const sids = connectedUsers.get(myId);
    if (!sids || !sids.has(socketId)) return res.status(404).json({ error: '会话不存在' });
    const s = io.sockets.sockets.get(socketId);
    if (s) {
      s.emit('force_logout', { reason: '您已在其他设备上被强制下线' });
      s.disconnect(true);
    }
    res.json({ ok: true });
  });

  // Step 3: desktop polls as fallback when Socket is unavailable
  router.get('/qr/status/:qrToken', (req, res) => {
    const { qrToken } = req.params;
    const session = qrSessions.get(qrToken);
    if (!session || Date.now() > session.expires) {
      qrSessions.delete(qrToken);
      return res.json({ status: 'expired' });
    }
    if (session.status === 'confirmed') {
      const { desktopToken, user } = session;
      qrSessions.delete(qrToken);
      return res.json({ status: 'confirmed', token: desktopToken, user });
    }
    res.json({ status: session.status });
  });

  return router;
};
