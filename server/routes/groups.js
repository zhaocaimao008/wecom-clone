const express = require('express');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');

function isPrivileged(db, groupId, userId) {
  const m = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(groupId, userId);
  return m && (m.role === 'owner' || m.role === 'admin');
}

module.exports = (db, io, connectedUsers) => {
  const router = express.Router();
  router.use(authMiddleware);

  function emit(userId, event, data) {
    const sockets = connectedUsers.get(Number(userId));
    if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
  }

  function broadcastGroup(gid, event, payload) {
    db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(gid)
      .forEach(m => emit(m.user_id, event, payload));
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
    const payload = groupWithCount(gid);
    broadcastGroup(gid, 'group_created', payload);
    res.json(payload);
  });

  router.get('/:id', (req, res) => {
    const g = groupWithCount(req.params.id);
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
    uniqueIds.forEach(uid => ins.run(gid, uid, 'member'));
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role
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
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    emit(targetId, 'group_kicked', { groupId: gid, groupName: g.name });
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
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json(members);
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
      db.prepare('DELETE FROM chat_groups WHERE id=?').run(gid);
      return members;
    });
    let members;
    try {
      members = dissolveTx();
    } catch (e) {
      return res.status(500).json({ error: '解散群失败，请重试' });
    }
    members.forEach(m => emit(m.user_id, 'group_dissolved', { groupId: gid, groupName: g.name }));
    res.json({ ok: true });
  });

  router.post('/:id/quit', (req, res) => {
    const gid = parseInt(req.params.id);
    if (isNaN(gid)) return res.status(400).json({ error: '无效的群组ID' });
    const g = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ error: '群组不存在' });
    if (g.owner_id === req.user.id) return res.status(400).json({ error: '群主请先解散或转让群主' });
    db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, req.user.id);
    const members = db.prepare(`
      SELECT u.id,u.display_name,u.avatar_color,u.department,u.position,u.status,gm.role
      FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=?
    `).all(gid);
    broadcastGroup(gid, 'group_updated', { ...groupWithCount(gid), members });
    res.json({ ok: true });
  });

  return router;
};
