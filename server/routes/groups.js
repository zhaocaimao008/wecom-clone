const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');

const GROUP_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const GROUP_AVATAR_EXT  = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const groupAvatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/avatars'),
  filename: (_, file, cb) => cb(null, `grp-${crypto.randomUUID()}${GROUP_AVATAR_EXT[file.mimetype] || '.jpg'}`),
});
const groupAvatarUpload = multer({
  storage: groupAvatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => GROUP_AVATAR_MIME.includes(file.mimetype) ? cb(null, true) : cb(new Error('只允许上传图片')),
});

function isPrivileged(db, groupId, userId) {
  const m = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(groupId, userId);
  return m && (m.role === 'owner' || m.role === 'admin');
}

module.exports = (db, io, connectedUsers, joinGroupRoom, leaveGroupRoom) => {
  const router = express.Router();
  router.use(authMiddleware);

  function emit(userId, event, data) {
    const sockets = connectedUsers.get(Number(userId));
    if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
  }

  function broadcastGroup(gid, event, payload) {
    io.to('group_' + gid).emit(event, payload);
  }

  function groupWithCount(gid) {
    return db.prepare(`
      SELECT cg.*, COUNT(gm.user_id) as member_count
      FROM chat_groups cg JOIN group_members gm ON cg.id=gm.group_id
      WHERE cg.id=? GROUP BY cg.id
    `).get(gid);
  }

  router.post('/', (req, res) => {
    const { name, memberIds = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: '请输入群名称' });
    if (name.trim().length > 50) return res.status(400).json({ error: '群名称不能超过50个字符' });
    if (!Array.isArray(memberIds) || memberIds.length < 1) return res.status(400).json({ error: '至少选择1位成员' });
    const uniqueIds = [...new Set(memberIds.filter(id => Number.isInteger(id) && id > 0 && id !== req.user.id))];
    const colors = ['#07c160','#576b95','#fa9d3b','#e64340','#10aec2'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    let groupCode, tries = 0;
    do {
      groupCode = String(crypto.randomInt(10000000, 100000000));
      tries++;
    } while (db.prepare('SELECT id FROM chat_groups WHERE group_code = ?').get(groupCode) && tries < 200);
    const gid = db.prepare('INSERT INTO chat_groups (name,avatar_color,owner_id,group_code) VALUES (?,?,?,?)')
      .run(name.trim(), color, req.user.id, groupCode).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO group_members (group_id,user_id,role) VALUES (?,?,?)');
    ins.run(gid, req.user.id, 'owner');
    uniqueIds.forEach(uid => ins.run(gid, uid, 'member'));
    // Join all members to the group's Socket.io room
    joinGroupRoom(req.user.id, gid);
    uniqueIds.forEach(uid => joinGroupRoom(uid, gid));
    const payload = groupWithCount(gid);
    broadcastGroup(gid, 'group_created', payload);
    res.json(payload);
  });

  router.get('/:id', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid) || gid <= 0) return res.status(400).json({ error: '无效的群组ID' });
    const member = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
    if (!member) return res.status(403).json({ error: '不在该群组中' });
    const g = groupWithCount(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    res.json(g);
  });

  router.put('/:id', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid)) return res.status(400).json({ error: '无效的群组ID' });
    if (!isPrivileged(db, gid, req.user.id))
      return res.status(403).json({ error: '仅群主/管理员可操作' });
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    const member = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
    const isOwner = member.role === 'owner';
    if (isOwner && req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) return res.status(400).json({ error: '群名称不能为空' });
      if (req.body.name.trim().length > 50) return res.status(400).json({ error: '群名称不能超过50个字符' });
    }
    if (req.body.announcement !== undefined && typeof req.body.announcement === 'string' && req.body.announcement.length > 1000) {
      return res.status(400).json({ error: '群公告不能超过1000个字符' });
    }
    const name         = isOwner && req.body.name !== undefined ? req.body.name.trim() : g.name;
    const announcement = req.body.announcement !== undefined ? req.body.announcement : g.announcement;
    const mute_all     = req.body.mute_all !== undefined ? (req.body.mute_all ? 1 : 0) : g.mute_all;
    const restrict_add_friend    = req.body.restrict_add_friend !== undefined ? (req.body.restrict_add_friend ? 1 : 0) : g.restrict_add_friend;
    const restrict_private_chat  = req.body.restrict_private_chat !== undefined ? (req.body.restrict_private_chat ? 1 : 0) : g.restrict_private_chat;
    db.prepare(`UPDATE chat_groups SET name=?,announcement=?,mute_all=?,restrict_add_friend=?,restrict_private_chat=? WHERE id=?`)
      .run(name, announcement, mute_all, restrict_add_friend, restrict_private_chat, gid);
    const updated = groupWithCount(gid);
    broadcastGroup(gid, 'group_updated', updated);
    res.json(updated);
  });

  router.post('/:id/members', (req, res) => {
    const gid = parseInt(req.params.id);
    if (!isPrivileged(db, gid, req.user.id))
      return res.status(403).json({ error: '仅群主/管理员可添加成员' });
    const { userIds = [] } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds 必须为数组' });
    const uniqueIds = [...new Set(userIds.filter(id => Number.isInteger(id) && id > 0))];
    const ins = db.prepare('INSERT OR IGNORE INTO group_members (group_id,user_id,role) VALUES (?,?,?)');
    const addedIds = [];
    uniqueIds.forEach(uid => {
      try { ins.run(gid, uid, 'member'); addedIds.push(uid); } catch {}
    });
    // Join new members to the group room
    addedIds.forEach(uid => joinGroupRoom(uid, gid));
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role,gm.muted_until
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json(members);
  });

  router.delete('/:id/members/:userId', (req, res) => {
    const gid = parseInt(req.params.id);
    const targetId = parseInt(req.params.userId);
    if (isNaN(gid) || isNaN(targetId)) return res.status(400).json({ error: '无效参数' });
    if (!isPrivileged(db, gid, req.user.id))
      return res.status(403).json({ error: '仅群主/管理员可移除成员' });
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    const target = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, targetId);
    if (target?.role === 'owner') return res.status(400).json({ error: '不能移除群主' });
    const myRole = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id)?.role;
    if (myRole === 'admin' && target?.role === 'admin')
      return res.status(403).json({ error: '管理员不能移除其他管理员' });
    db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, targetId);
    // Remove kicked user from room before broadcasting updated member list
    leaveGroupRoom(targetId, gid);
    emit(targetId, 'group_kicked', { groupId: gid, groupName: g.name });
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role,gm.muted_until
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json(members);
  });

  router.put('/:id/members/:userId/role', (req, res) => {
    const gid = parseInt(req.params.id);
    const targetId = parseInt(req.params.userId);
    if (isNaN(gid) || isNaN(targetId)) return res.status(400).json({ error: '无效参数' });
    const { role } = req.body;
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    if (g.owner_id !== req.user.id) return res.status(403).json({ error: '仅群主可设置管理员' });
    if (targetId === g.owner_id) return res.status(400).json({ error: '不能修改群主角色' });
    if (!['admin','member'].includes(role)) return res.status(400).json({ error: '无效角色' });
    db.prepare('UPDATE group_members SET role=? WHERE group_id=? AND user_id=?').run(role, gid, targetId);
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role,gm.muted_until
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json(members);
  });

  // ── Transfer ownership ────────────────────────────────────────────────────
  router.post('/:id/transfer', (req, res) => {
    const gid = parseInt(req.params.id);
    const newOwnerId = parseInt(req.body.newOwnerId);
    if (isNaN(gid) || isNaN(newOwnerId)) return res.status(400).json({ error: '无效参数' });
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    if (g.owner_id !== req.user.id) return res.status(403).json({ error: '仅群主可转让群主' });
    const target = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, newOwnerId);
    if (!target) return res.status(400).json({ error: '该成员不在群内' });
    db.transaction(() => {
      db.prepare('UPDATE chat_groups SET owner_id=? WHERE id=?').run(newOwnerId, gid);
      db.prepare('UPDATE group_members SET role=? WHERE group_id=? AND user_id=?').run('owner', gid, newOwnerId);
      db.prepare('UPDATE group_members SET role=? WHERE group_id=? AND user_id=?').run('member', gid, req.user.id);
    })();
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role,gm.muted_until
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid)) return res.status(400).json({ error: '无效的群组ID' });
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    if (g.owner_id !== req.user.id) return res.status(403).json({ error: '仅群主可解散群' });
    const dissolveTx = db.transaction(() => {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(gid);
      db.prepare('DELETE FROM group_members WHERE group_id=?').run(gid);
      db.prepare('DELETE FROM messages WHERE group_id=?').run(gid);
      db.prepare("DELETE FROM conversation_reads WHERE conv_key='g:'||?").run(gid);
      db.prepare("DELETE FROM conversation_settings WHERE conv_key='g:'||?").run(gid);
      db.prepare('DELETE FROM chat_groups WHERE id=?').run(gid);
      return members;
    });
    let members;
    try {
      members = dissolveTx();
    } catch (e) {
      return res.status(500).json({ error: '解散群失败，请重试' });
    }
    // Remove all members from room, then notify each
    members.forEach(m => leaveGroupRoom(m.user_id, gid));
    members.forEach(m => emit(m.user_id, 'group_dissolved', { groupId: gid, groupName: g.name }));
    res.json({ ok: true });
  });

  // ── Group avatar upload ───────────────────────────────────────────
  router.post('/:id/avatar', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid)) return res.status(400).json({ error: '无效的群组ID' });
    if (!isPrivileged(db, gid, req.user.id))
      return res.status(403).json({ error: '仅群主/管理员可修改群头像' });
    groupAvatarUpload.single('avatar')(req, res, err => {
      if (err) return res.status(400).json({ error: err.message || '上传失败' });
      if (!req.file) return res.status(400).json({ error: '未收到图片' });
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      db.prepare('UPDATE chat_groups SET avatar_url=? WHERE id=?').run(avatarUrl, gid);
      const updated = groupWithCount(gid);
      broadcastGroup(gid, 'group_updated', updated);
      res.json(updated);
    });
  });

  // ── Per-member mute ───────────────────────────────────────────────────────
  // mute_duration: 0 = permanent, positive = minutes, -1 = unmute
  router.put('/:id/members/:userId/mute', (req, res) => {
    const gid = parseInt(req.params.id);
    const targetId = parseInt(req.params.userId);
    if (isNaN(gid) || isNaN(targetId)) return res.status(400).json({ error: '无效参数' });
    const { mute_duration } = req.body; // minutes; -1 to unmute; 0 for permanent
    if (!isPrivileged(db, gid, req.user.id)) return res.status(403).json({ error: '仅群主/管理员可禁言成员' });
    const target = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, targetId);
    if (!target) return res.status(404).json({ error: '该成员不在群内' });
    if (target.role === 'owner') return res.status(400).json({ error: '不能禁言群主' });
    const myRole = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id)?.role;
    if (target.role === 'admin' && myRole !== 'owner')
      return res.status(403).json({ error: '仅群主可禁言管理员' });

    let mutedUntil;
    if (mute_duration === -1) {
      mutedUntil = null; // unmute
    } else if (mute_duration === 0) {
      mutedUntil = 0; // permanent
    } else {
      const mins = parseInt(mute_duration);
      if (!Number.isInteger(mins) || mins <= 0 || mins > 43200)
        return res.status(400).json({ error: '禁言时长无效（1-43200分钟）' });
      mutedUntil = Date.now() + mins * 60 * 1000;
    }
    db.prepare('UPDATE group_members SET muted_until=? WHERE group_id=? AND user_id=?').run(mutedUntil, gid, targetId);
    broadcastGroup(gid, 'group_updated', groupWithCount(gid));
    res.json({ ok: true, muted_until: mutedUntil });
  });

  router.post('/:id/quit', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid)) return res.status(400).json({ error: '无效的群组ID' });
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    if (g.owner_id === req.user.id) return res.status(400).json({ error: '群主请先解散或转让群主' });
    db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, req.user.id);
    leaveGroupRoom(req.user.id, gid);
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role,gm.muted_until
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json({ ok: true });
  });

  return router;
};
