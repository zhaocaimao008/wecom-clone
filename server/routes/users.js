const express = require('express');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/auth');

const avatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/avatars'),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('只允许上传图片'));
  },
});

module.exports = (db, io, connectedUsers) => {
  const router = express.Router();
  router.use(authMiddleware);

  function emitTo(userId, event, data) {
    const sockets = connectedUsers.get(Number(userId));
    if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
  }

  router.get('/search', (req, res) => {
    const { q = '' } = req.query;
    if (!q.trim()) return res.json([]);
    const myId = req.user.id;
    const kw = `%${q.trim()}%`;
    const users = db.prepare(`
      SELECT u.id, u.display_name, u.username, u.avatar_color, u.avatar_url, u.department, u.position, u.status, u.user_code,
             CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as is_contact,
             CASE WHEN fr.id IS NOT NULL AND fr.status='pending' THEN 1 ELSE 0 END as request_sent
      FROM users u
      LEFT JOIN contacts c ON c.user_id = ? AND c.contact_id = u.id
      LEFT JOIN friend_requests fr ON fr.from_id = ? AND fr.to_id = u.id
      WHERE u.id != ? AND (u.display_name LIKE ? OR u.username LIKE ? OR u.user_code LIKE ?)
      ORDER BY is_contact ASC, u.display_name LIMIT 20
    `).all(myId, myId, myId, kw, kw, kw);
    res.json(users);
  });

  // Find user by exact 6-digit user_code (for QR scan)
  router.get('/by-code/:code', (req, res) => {
    const myId = req.user.id;
    const { code } = req.params;
    const u = db.prepare(`
      SELECT u.id, u.display_name, u.username, u.avatar_color, u.avatar_url, u.department, u.position, u.status, u.user_code,
             CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as is_contact,
             CASE WHEN fr.id IS NOT NULL AND fr.status='pending' THEN 1 ELSE 0 END as request_sent
      FROM users u
      LEFT JOIN contacts c ON c.user_id = ? AND c.contact_id = u.id
      LEFT JOIN friend_requests fr ON fr.from_id = ? AND fr.to_id = u.id
      WHERE u.user_code = ? AND u.id != ?
    `).get(myId, myId, code, myId);
    if (!u) return res.status(404).json({ error: '未找到该用户' });
    res.json(u);
  });

  router.get('/contacts', (req, res) => {
    const contacts = db.prepare(`
      SELECT u.id, u.display_name, u.avatar_color, u.department, u.position, u.phone, u.email, u.status
      FROM contacts c JOIN users u ON c.contact_id = u.id
      WHERE c.user_id = ? ORDER BY u.department, u.display_name
    `).all(req.user.id);
    res.json(contacts);
  });

  router.post('/friend-requests', (req, res) => {
    const { targetId, message = '' } = req.body;
    const myId = req.user.id;
    if (!targetId || targetId === myId) return res.status(400).json({ error: '无效操作' });
    if (db.prepare('SELECT id FROM contacts WHERE user_id=? AND contact_id=?').get(myId, targetId))
      return res.status(400).json({ error: '已经是好友了' });
    const restricted = db.prepare(`
      SELECT cg.name FROM chat_groups cg
      JOIN group_members gm1 ON cg.id=gm1.group_id AND gm1.user_id=?
      JOIN group_members gm2 ON cg.id=gm2.group_id AND gm2.user_id=?
      WHERE cg.restrict_add_friend=1 AND gm1.role='member' AND gm2.role='member' LIMIT 1
    `).get(myId, targetId);
    if (restricted) return res.status(403).json({ error: `「${restricted.name}」群已禁止成员互加好友` });
    const existing = db.prepare(
      'SELECT id, status FROM friend_requests WHERE from_id=? AND to_id=?'
    ).get(myId, targetId);
    if (existing) {
      if (existing.status === 'pending') return res.status(400).json({ error: '已发送过好友申请，请等待对方处理' });
      if (existing.status === 'accepted') return res.status(400).json({ error: '已经是好友了' });
      db.prepare('UPDATE friend_requests SET status=? WHERE id=?').run('pending', existing.id);
    } else {
      try {
        db.prepare('INSERT INTO friend_requests (from_id,to_id,status,message) VALUES (?,?,?,?)')
          .run(myId, targetId, 'pending', message);
      } catch (e) {
        return res.status(500).json({ error: '发送失败，请重试' });
      }
    }
    const sender = db.prepare('SELECT id,display_name,avatar_color,department,position,status FROM users WHERE id=?').get(myId);
    emitTo(targetId, 'friend_request', { ...sender, message, requestId: myId });
    res.json({ ok: true });
  });

  router.get('/friend-requests', (req, res) => {
    const reqs = db.prepare(`
      SELECT fr.id, fr.message, fr.created_at,
             u.id as from_id, u.display_name, u.avatar_color, u.department, u.position, u.status
      FROM friend_requests fr JOIN users u ON fr.from_id = u.id
      WHERE fr.to_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(req.user.id);
    res.json(reqs);
  });

  router.get('/friend-requests/count', (req, res) => {
    const row = db.prepare('SELECT COUNT(*) as n FROM friend_requests WHERE to_id=? AND status=?').get(req.user.id, 'pending');
    res.json({ count: row.n });
  });

  router.put('/friend-requests/:fromId', (req, res) => {
    const fromId = parseInt(req.params.fromId);
    const myId = req.user.id;
    const { action } = req.body;
    if (!['accept','reject'].includes(action)) return res.status(400).json({ error: '无效操作' });
    const req_ = db.prepare('SELECT * FROM friend_requests WHERE from_id=? AND to_id=? AND status=?').get(fromId, myId, 'pending');
    if (!req_) return res.status(404).json({ error: '申请不存在或已处理' });
    if (action === 'accept') {
      db.prepare('UPDATE friend_requests SET status=? WHERE from_id=? AND to_id=?').run('accepted', fromId, myId);
      db.prepare('INSERT OR IGNORE INTO contacts (user_id,contact_id) VALUES (?,?)').run(myId, fromId);
      db.prepare('INSERT OR IGNORE INTO contacts (user_id,contact_id) VALUES (?,?)').run(fromId, myId);
      const me = db.prepare('SELECT id,display_name,avatar_color,department,position,status FROM users WHERE id=?').get(myId);
      emitTo(fromId, 'friend_accepted', me);
      res.json({ ok: true, action: 'accepted' });
    } else {
      db.prepare('UPDATE friend_requests SET status=? WHERE from_id=? AND to_id=?').run('rejected', fromId, myId);
      emitTo(fromId, 'friend_rejected', { userId: myId });
      res.json({ ok: true, action: 'rejected' });
    }
  });

  router.get('/departments', (req, res) => {
    const users = db.prepare('SELECT id,display_name,avatar_color,department,position,phone,email,status,user_code FROM users ORDER BY department,display_name').all();
    const depts = {};
    users.forEach(u => { if (!depts[u.department]) depts[u.department] = []; depts[u.department].push(u); });
    res.json(depts);
  });

  router.get('/me/groups', (req, res) => {
    const groups = db.prepare(`
      SELECT cg.id,cg.name,cg.avatar_color,cg.owner_id,cg.announcement,
             cg.mute_all,cg.restrict_add_friend,cg.restrict_private_chat,
             cg.group_code,COUNT(gm2.user_id) as member_count
      FROM chat_groups cg
      JOIN group_members gm ON cg.id=gm.group_id AND gm.user_id=?
      JOIN group_members gm2 ON cg.id=gm2.group_id
      GROUP BY cg.id
    `).all(req.user.id);
    res.json(groups);
  });

  router.get('/groups/:id/members', (req, res) => {
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(req.params.id);
    res.json(members);
  });

  router.get('/:id', (req, res) => {
    const user = db.prepare('SELECT id,display_name,avatar_color,department,position,phone,email,status FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  });

  router.post('/read', (req, res) => {
    const { peerId, groupId, lastId } = req.body;
    const key = peerId ? `p:${peerId}` : `g:${groupId}`;
    db.prepare('INSERT OR REPLACE INTO conversation_reads (user_id,conv_key,last_read_id) VALUES (?,?,?)')
      .run(req.user.id, key, lastId || 0);
    res.json({ ok: true });
  });

  router.put('/me', (req, res) => {
    const { display_name, department, position, phone, email, avatar_color } = req.body;
    if (display_name !== undefined && !display_name.trim())
      return res.status(400).json({ error: '昵称不能为空' });
    if (display_name && display_name.trim().length > 50)
      return res.status(400).json({ error: '昵称不能超过50字' });
    if (phone && !/^1\d{10}$/.test(phone))
      return res.status(400).json({ error: '手机号格式不正确' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: '邮箱格式不正确' });
    const updates = [];
    const vals = [];
    if (display_name !== undefined) { updates.push('display_name=?'); vals.push(display_name.trim()); }
    if (department !== undefined) { updates.push('department=?'); vals.push(department); }
    if (position !== undefined) { updates.push('position=?'); vals.push(position); }
    if (phone !== undefined) { updates.push('phone=?'); vals.push(phone || null); }
    if (email !== undefined) { updates.push('email=?'); vals.push(email || null); }
    if (avatar_color !== undefined) { updates.push('avatar_color=?'); vals.push(avatar_color); }
    if (updates.length === 0) return res.status(400).json({ error: '没有要更新的字段' });
    vals.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...vals);
    const user = db.prepare('SELECT id,username,display_name,avatar_color,avatar_url,user_code,department,position,phone,email,status FROM users WHERE id=?').get(req.user.id);
    res.json(user);
  });

  router.post('/me/avatar', (req, res) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到图片' });
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl, req.user.id);
      const user = db.prepare('SELECT id,username,display_name,avatar_color,avatar_url,user_code,department,position,phone,email,status FROM users WHERE id=?').get(req.user.id);
      res.json(user);
    });
  });

  router.get('/chat-allowed/:targetId', (req, res) => {
    const myId = req.user.id;
    const targetId = parseInt(req.params.targetId);
    const restricted = db.prepare(`
      SELECT cg.name FROM chat_groups cg
      JOIN group_members gm1 ON cg.id=gm1.group_id AND gm1.user_id=?
      JOIN group_members gm2 ON cg.id=gm2.group_id AND gm2.user_id=?
      WHERE cg.restrict_private_chat=1 AND gm1.role='member' AND gm2.role='member' LIMIT 1
    `).get(myId, targetId);
    res.json({ allowed: !restricted, reason: restricted ? `「${restricted.name}」群已禁止成员私聊` : null });
  });

  return router;
};
