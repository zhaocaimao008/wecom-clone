const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const JWT_SECRET=process.env.JWT_SECRET;

// In-memory stores: phone → { code, expiresAt, count }
const smsCodes = new Map();
// In-memory store: username → { count, lockedUntil }
const loginAttempts = new Map();

const SMS_MAX_PER_PHONE = 3;      // 每手机号最多3次/分钟
const SMS_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_PER_USER = 5;    // 每账号最多5次/15分钟
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

module.exports = (db) => {
  const router = express.Router();

  // ── Helpers ─────────────────────────────────────────────────────────

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

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' });

    const attempt = recordLoginAttempt(username);
    if (!attempt.allowed) {
      return res.status(429).json({ error: `操作太频繁，请在 ${attempt.retryAfter} 秒后重试` });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?').get(username, username);
    if (!user) return res.status(401).json({ error: '账号或密码错误' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '账号或密码错误' });

    // 登录成功，重置计数
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

    const stored = smsCodes.get(phone);
    if (!stored || stored.expiresAt < Date.now() || stored.code !== String(code)) {
      return res.status(401).json({ error: '验证码错误或已过期' });
    }
    smsCodes.delete(phone);

    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userInfo } = user;
    res.json({ token, user: userInfo });
  });

  // ── Register ─────────────────────────────────────────────────────────

  router.post('/register', (req, res) => {
    const { username, password, password_confirm, display_name, department, position, invite_code } = req.body;
    if (!username || !password || !display_name) return res.status(400).json({ error: '请填写必要信息' });
    if (!invite_code) return res.status(400).json({ error: '请填写邀请码' });
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
    const ic = db.prepare('SELECT * FROM invite_codes WHERE code=?').get(invite_code.trim().toUpperCase());
    if (!ic) return res.status(400).json({ error: '邀请码无效' });
    if (ic.expires_at < now) return res.status(400).json({ error: '邀请码已过期' });
    if (ic.use_count >= ic.max_uses) return res.status(400).json({ error: '邀请码已被使用' });

    const colors = ['#07c160', '#576b95', '#fa9d3b', '#e64340', '#10aec2', '#7d7d7d'];
    const color = colors[crypto.randomInt(0, colors.length)];
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, avatar_color, department, position) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(username, hash, display_name, color, department || '研发部', position || '员工');
      db.prepare('UPDATE invite_codes SET used_at=?, used_by=?, use_count=use_count+1 WHERE id=?')
        .run(now, String(result.lastInsertRowid), ic.id);
      // 自动分配唯一6位密信ID
      let userCode, tries = 0;
      do {
        userCode = String(crypto.randomInt(100000, 1000000));
        tries++;
      } while (db.prepare('SELECT id FROM users WHERE user_code = ?').get(userCode) && tries < 200);
      db.prepare('UPDATE users SET user_code = ? WHERE id = ?').run(userCode, result.lastInsertRowid);
      const user = db.prepare('SELECT id, username, display_name, avatar_color, department, position, status, user_code FROM users WHERE id = ?').get(result.lastInsertRowid);
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '用户名已存在' });
      res.status(500).json({ error: '注册失败' });
    }
  });

  return router;
};
