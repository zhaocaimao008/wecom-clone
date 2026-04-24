const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

// In-memory SMS code store: phone → { code, expiresAt }
const smsCodes = new Map();

module.exports = (db) => {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' });
    // Accept username or phone number
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?').get(username, username);
    if (!user) return res.status(401).json({ error: '账号或密码错误' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '账号或密码错误' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userInfo } = user;
    res.json({ token, user: userInfo });
  });

  // Send SMS verification code (demo: returns code in response)
  router.post('/send-code', (req, res) => {
    const { phone } = req.body;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '请输入正确的手机号码' });
    }
    const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (!user) return res.status(404).json({ error: '该手机号未注册' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    smsCodes.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ message: '验证码已发送', demo_code: code });
  });

  // Phone + SMS code login
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

  router.post('/register', (req, res) => {
    const { username, password, password_confirm, display_name, department, position, invite_code } = req.body;
    if (!username || !password || !display_name) return res.status(400).json({ error: '请填写必要信息' });
    if (!invite_code) return res.status(400).json({ error: '请填写邀请码' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    if (password !== password_confirm) return res.status(400).json({ error: '两次密码输入不一致' });

    const now = new Date().toISOString();
    const ic = db.prepare('SELECT * FROM invite_codes WHERE code=?').get(invite_code.trim().toUpperCase());
    if (!ic) return res.status(400).json({ error: '邀请码无效' });
    if (ic.expires_at < now) return res.status(400).json({ error: '邀请码已过期' });
    if (ic.use_count >= ic.max_uses) return res.status(400).json({ error: '邀请码已被使用' });

    const colors = ['#07c160', '#576b95', '#fa9d3b', '#e64340', '#10aec2', '#7d7d7d'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, avatar_color, department, position) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(username, hash, display_name, color, department || '研发部', position || '员工');
      db.prepare('UPDATE invite_codes SET used_at=?, used_by=?, use_count=use_count+1 WHERE id=?')
        .run(now, String(result.lastInsertRowid), ic.id);
      const user = db.prepare('SELECT id, username, display_name, avatar_color, department, position, status FROM users WHERE id = ?').get(result.lastInsertRowid);
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '用户名已存在' });
      res.status(500).json({ error: '注册失败' });
    }
  });

  return router;
};
