const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');

// Simple in-memory rate limiter for friend requests (10 per minute per user)
const friendReqRate = new Map(); // userId -> { count, windowStart }
function checkFriendReqRate(userId) {
  const now = Date.now();
  const entry = friendReqRate.get(userId);
  if (!entry || now - entry.windowStart > 60_000) {
    friendReqRate.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

const AVATAR_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SAFE_AVATAR_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const avatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/avatars'),
  filename: (_, file, cb) => {
    const safeExt = SAFE_AVATAR_EXT[file.mimetype] || '.jpg';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (AVATAR_MIME.includes(file.mimetype)) cb(null, true);
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
    const kw = `%${q.trim().replace(/[%_]/g, c => `\\${c}`)}%`;
    const users = db.prepare(`
      SELECT u.id, u.display_name, u.username, u.avatar_color, u.avatar_url, u.status, u.user_code,
             CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as is_contact,
             CASE WHEN fr.id IS NOT NULL AND fr.status='pending' THEN 1 ELSE 0 END as request_sent
      FROM users u
      LEFT JOIN contacts c ON c.user_id = ? AND c.contact_id = u.id
      LEFT JOIN friend_requests fr ON fr.from_id = ? AND fr.to_id = u.id
      WHERE u.id != ? AND (u.display_name LIKE ? ESCAPE '\' OR u.username LIKE ? ESCAPE '\' OR u.user_code LIKE ? ESCAPE '\')
      ORDER BY is_contact DESC, u.display_name LIMIT 20
    `).all(myId, myId, myId, kw, kw, kw);
    res.json(users);
  });

  router.get('/by-code/:code', (req, res) => {
    const myId = req.user.id;
    const { code } = req.params;
    const u = db.prepare(`
      SELECT u.id, u.display_name, u.username, u.avatar_color, u.avatar_url, u.status, u.user_code,
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
      SELECT u.id, u.display_name, u.avatar_color, u.avatar_url, u.phone, u.email, u.status, u.user_code,
             CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_blocked
      FROM contacts c
      JOIN users u ON c.contact_id = u.id
      LEFT JOIN blocked_users b ON b.user_id = ? AND b.blocked_id = u.id
      WHERE c.user_id = ? ORDER BY u.display_name
    `).all(req.user.id, req.user.id);
    res.json(contacts);
  });

  // Block a user
  router.post('/block/:userId', (req, res) => {
    const myId = req.user.id;
    const targetId = parseInt(req.params.userId);
    if (isNaN(targetId) || targetId <= 0 || targetId === myId) return res.status(400).json({ error: '无效的用户ID' });
    db.prepare('INSERT OR IGNORE INTO blocked_users (user_id, blocked_id) VALUES (?, ?)').run(myId, targetId);
    res.json({ ok: true });
  });

  // Unblock a user
  router.delete('/block/:userId', (req, res) => {
    const myId = req.user.id;
    const targetId = parseInt(req.params.userId);
    if (isNaN(targetId) || targetId <= 0) return res.status(400).json({ error: '无效的用户ID' });
    db.prepare('DELETE FROM blocked_users WHERE user_id=? AND blocked_id=?').run(myId, targetId);
    res.json({ ok: true });
  });

  // List blocked users
  router.get('/blocked', (req, res) => {
    const list = db.prepare(`
      SELECT u.id, u.display_name, u.avatar_color, u.avatar_url, u.user_code
      FROM blocked_users b JOIN users u ON b.blocked_id = u.id
      WHERE b.user_id = ? ORDER BY b.created_at DESC
    `).all(req.user.id);
    res.json(list);
  });

  router.post('/friend-requests', (req, res) => {
    const { targetId, message = '' } = req.body;
    const myId = req.user.id;
    if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: '无效的目标用户' });
    if (!checkFriendReqRate(myId)) return res.status(429).json({ error: '操作太频繁，请稍后再试' });
    if (targetId === myId) return res.status(400).json({ error: '无效操作' });
    if (typeof message !== 'string' || message.length > 200) return res.status(400).json({ error: '申请附言不能超过200字' });
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
    const sender = db.prepare('SELECT id,display_name,avatar_color,status FROM users WHERE id=?').get(myId);
    emitTo(targetId, 'friend_request', { ...sender, from_id: sender.id, message });
    res.json({ ok: true });
  });

  router.get('/friend-requests', (req, res) => {
    const reqs = db.prepare(`
      SELECT fr.id, fr.message, fr.created_at,
             u.id as from_id, u.display_name, u.avatar_color, u.status
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
    if (isNaN(fromId)) return res.status(400).json({ error: '无效的请求ID' });
    const myId = req.user.id;
    const { action } = req.body;
    if (!['accept','reject'].includes(action)) return res.status(400).json({ error: '无效操作' });
    const req_ = db.prepare('SELECT * FROM friend_requests WHERE from_id=? AND to_id=? AND status=?').get(fromId, myId, 'pending');
    if (!req_) return res.status(404).json({ error: '申请不存在或已处理' });
    if (action === 'accept') {
      db.prepare('UPDATE friend_requests SET status=? WHERE from_id=? AND to_id=?').run('accepted', fromId, myId);
      db.prepare('INSERT OR IGNORE INTO contacts (user_id,contact_id) VALUES (?,?)').run(myId, fromId);
      db.prepare('INSERT OR IGNORE INTO contacts (user_id,contact_id) VALUES (?,?)').run(fromId, myId);
      const me = db.prepare('SELECT id,display_name,avatar_color,avatar_url,status FROM users WHERE id=?').get(myId);
      emitTo(fromId, 'friend_accepted', me);
      res.json({ ok: true, action: 'accepted' });
    } else {
      db.prepare('UPDATE friend_requests SET status=? WHERE from_id=? AND to_id=?').run('rejected', fromId, myId);
      const me = db.prepare('SELECT display_name FROM users WHERE id=?').get(myId);
      emitTo(fromId, 'friend_rejected', { userId: myId, name: me?.display_name || '' });
      res.json({ ok: true, action: 'rejected' });
    }
  });

  router.delete('/friends/:userId', (req, res) => {
    const myId = req.user.id;
    const otherId = parseInt(req.params.userId);
    if (isNaN(otherId) || otherId <= 0) return res.status(400).json({ error: '无效的用户ID' });
    db.prepare('DELETE FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)').run(myId, otherId, otherId, myId);
    db.prepare('DELETE FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').run(myId, otherId, otherId, myId);
    // Notify the other side so they see the change in realtime
    emitTo(otherId, 'friend_removed', { userId: myId });
    res.json({ ok: true });
  });

  // Returns all users grouped under one key (departments removed)
  router.get('/departments', (req, res) => {
    const users = db.prepare('SELECT id,display_name,avatar_color,avatar_url,phone,email,status,user_code FROM users ORDER BY display_name').all();
    res.json({ '全部成员': users });
  });

  router.get('/me/groups', (req, res) => {
    const groups = db.prepare(`
      SELECT cg.id,cg.name,cg.avatar_color,cg.avatar_url,cg.owner_id,cg.announcement,
             cg.mute_all,cg.restrict_add_friend,cg.restrict_private_chat,
             cg.group_code,COUNT(gm2.user_id) as member_count,gm.role as my_role
      FROM chat_groups cg
      JOIN group_members gm ON cg.id=gm.group_id AND gm.user_id=?
      JOIN group_members gm2 ON cg.id=gm2.group_id
      GROUP BY cg.id
    `).all(req.user.id);
    res.json(groups);
  });

  router.get('/groups/:id/members', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid) || gid <= 0) return res.status(400).json({ error: '无效的群组ID' });
    const myMembership = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
    if (!myMembership) return res.status(403).json({ error: '不在该群组中' });
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.avatar_url,u.status,gm.role,gm.muted_until
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    res.json(members);
  });

  router.get('/:id', (req, res) => {
    const uid = parseInt(req.params.id);
    if (isNaN(uid) || uid <= 0) return res.status(400).json({ error: '无效的用户ID' });
    const myId = req.user.id;
    // Always return basic info; phone/email only for self or mutual friends
    const user = db.prepare('SELECT id,display_name,avatar_color,avatar_url,phone,email,status,user_code FROM users WHERE id=?').get(uid);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (uid !== myId) {
      const isFriend = db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(myId, uid);
      if (!isFriend) {
        const { phone: _, email: __, ...publicInfo } = user;
        return res.json(publicInfo);
      }
    }
    res.json(user);
  });

  router.post('/read', (req, res) => {
    const { peerId, groupId, lastId } = req.body;
    if (!peerId && !groupId) return res.status(400).json({ error: '缺少参数' });
    if (peerId && !Number.isInteger(peerId)) return res.status(400).json({ error: 'peerId 无效' });
    if (groupId && !Number.isInteger(groupId)) return res.status(400).json({ error: 'groupId 无效' });
    if (!Number.isInteger(lastId) || lastId < 0) return res.status(400).json({ error: 'lastId 无效' });
    const key = peerId ? `p:${peerId}` : `g:${groupId}`;
    db.prepare('INSERT OR REPLACE INTO conversation_reads (user_id,conv_key,last_read_id) VALUES (?,?,?)')
      .run(req.user.id, key, lastId || 0);
    // 跨端同步：通知该用户所有在线设备更新已读状态
    const uid = req.user.id;
    const payload = { peerId: peerId || null, groupId: groupId || null };
    const sockets = connectedUsers.get(Number(uid));
    if (sockets) sockets.forEach(sid => io.to(sid).emit('conv_read_sync', payload));
    res.json({ ok: true });
  });

  router.put('/me', (req, res) => {
    const { display_name, phone, email, avatar_color, privacy } = req.body;
    if (display_name !== undefined && !display_name.trim())
      return res.status(400).json({ error: '昵称不能为空' });
    if (display_name && display_name.trim().length > 50)
      return res.status(400).json({ error: '昵称不能超过50字' });
    if (phone && !/^1\d{10}$/.test(phone))
      return res.status(400).json({ error: '手机号格式不正确' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: '邮箱格式不正确' });
    if (avatar_color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(avatar_color))
      return res.status(400).json({ error: '头像颜色格式不正确，应为 #RRGGBB' });
    const updates = [];
    const vals = [];
    if (display_name !== undefined) { updates.push('display_name=?'); vals.push(display_name.trim()); }
    if (phone !== undefined) { updates.push('phone=?'); vals.push(phone || null); }
    if (email !== undefined) { updates.push('email=?'); vals.push(email || null); }
    if (avatar_color !== undefined) { updates.push('avatar_color=?'); vals.push(avatar_color); }
    if (privacy !== undefined) {
      try {
        const p = typeof privacy === 'string' ? JSON.parse(privacy) : privacy;
        if (typeof p !== 'object' || p === null) throw new Error();
        const ALLOWED_PRIVACY_KEYS = ['showPhone', 'showEmail', 'showStatus'];
        const safe = {};
        for (const k of ALLOWED_PRIVACY_KEYS) {
          if (k in p) safe[k] = Boolean(p[k]);
        }
        const safeStr = JSON.stringify(safe);
        updates.push('privacy=?'); vals.push(safeStr);
      } catch {}
    }
    if (updates.length === 0) return res.status(400).json({ error: '没有要更新的字段' });
    vals.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...vals);
    const user = db.prepare('SELECT id,username,display_name,avatar_color,avatar_url,user_code,phone,email,status,privacy FROM users WHERE id=?').get(req.user.id);
    res.json(user);
  });

  router.post('/me/avatar', (req, res) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到图片' });
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl, req.user.id);
      const user = db.prepare('SELECT id,username,display_name,avatar_color,avatar_url,user_code,phone,email,status,privacy FROM users WHERE id=?').get(req.user.id);
      res.json(user);
    });
  });

  router.get('/chat-allowed/:targetId', (req, res) => {
    const myId = req.user.id;
    const targetId = parseInt(req.params.targetId);
    if (isNaN(targetId)) return res.status(400).json({ error: '无效的目标用户ID' });
    const restricted = db.prepare(`
      SELECT cg.name FROM chat_groups cg
      JOIN group_members gm1 ON cg.id=gm1.group_id AND gm1.user_id=?
      JOIN group_members gm2 ON cg.id=gm2.group_id AND gm2.user_id=?
      WHERE cg.restrict_private_chat=1 AND gm1.role='member' AND gm2.role='member' LIMIT 1
    `).get(myId, targetId);
    res.json({ allowed: !restricted, reason: restricted ? `「${restricted.name}」群已禁止成员私聊` : null });
  });

  // ── Invite code generation (user-facing) ──────────────────────────────────
  router.get('/invite-code/can-generate', (req, res) => {
    const user = db.prepare('SELECT can_invite FROM users WHERE id=?').get(req.user.id);
    res.json({ allowed: !!(user && user.can_invite) });
  });

  router.post('/invite-code/generate', (req, res) => {
    const user = db.prepare('SELECT can_invite FROM users WHERE id=?').get(req.user.id);
    if (!user || !user.can_invite)
      return res.status(403).json({ error: '您没有生成邀请码的权限' });
    const days = Math.max(1, Math.min(90, parseInt(req.body?.days) || 7));
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const id = crypto.randomUUID();
    try {
      db.prepare('INSERT INTO invite_codes (id, code, expires_at, created_by) VALUES (?, ?, ?, ?)').run(id, code, expiresAt, String(req.user.id));
    } catch {
      return res.status(500).json({ error: '生成失败，请重试' });
    }
    res.json({ code, expires_at: expiresAt, days });
  });

  return router;
};
