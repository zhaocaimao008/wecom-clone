const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const { formatMessage } = require('../utils/normalizeMessage');

const ALLOWED_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'];
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/ogg',
];

// 安全的文件名生成：使用UUID，完全丢弃原始文件名
function safeFilename(ext) {
  return `${crypto.randomUUID()}${ext}`;
}

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/voice'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, safeFilename(ext));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，仅支持音频文件'), false);
    }
  }
});

const fileStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/files'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, safeFilename(ext));
  },
});

const fileUpload = multer({
  storage: fileStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，仅允许文档、图片、视频、压缩包'), false);
    }
  }
});

const imageStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/images'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, safeFilename(ext));
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('仅允许上传图片文件'), false);
    }
  }
});

module.exports = (db, io, connectedUsers) => {
  const router = express.Router();
  router.use(authMiddleware);

  function emitTo(userId, event, data) {
    const sockets = connectedUsers?.get(Number(userId));
    if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
  }

  router.delete('/clear-conversation', (req, res) => {
    const myId = req.user.id;
    const { receiverId, groupId } = req.body;
    if (!receiverId && !groupId) return res.status(400).json({ error: '缺少参数' });

    if (receiverId) {
      const targetId = Number(receiverId);
      const canAccess = db.prepare(`
        SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)
        UNION
        SELECT 1 FROM messages WHERE group_id IS NULL
          AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
        LIMIT 1
      `).get(myId, targetId, targetId, myId, myId, targetId, targetId, myId);
      if (!canAccess) return res.status(403).json({ error: '无权操作此对话' });

      db.prepare(
        'DELETE FROM messages WHERE group_id IS NULL AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))'
      ).run(myId, targetId, targetId, myId);

      const payload = { type: 'private', peerId: targetId };
      emitTo(myId, 'conversation_cleared', payload);
      emitTo(targetId, 'conversation_cleared', { ...payload, peerId: myId });
    } else {
      const gid = Number(groupId);
      const member = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, myId);
      if (!member) return res.status(403).json({ error: '非群成员' });
      if (member.role === 'member') return res.status(403).json({ error: '仅群主/管理员可清空群消息' });

      db.prepare('DELETE FROM messages WHERE group_id=?').run(gid);

      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(gid);
      members.forEach(m => emitTo(m.user_id, 'conversation_cleared', { type: 'group', groupId: gid }));
    }

    res.json({ ok: true });
  });

  router.get('/private/:userId', (req, res) => {
    const { userId } = req.params;
    const { before, limit = 50 } = req.query;
    const myId = req.user.id;
    const targetId = parseInt(userId);
    const beforeInt = before ? parseInt(before) : null;
    const limitInt = Math.min(parseInt(limit) || 50, 100);
    if (!/^\d+$/.test(userId)) return res.status(400).json({ error: '无效的用户ID' });

    // 鉴权：请求者必须是当事人、好友或该对话参与方
    if (myId !== targetId) {
      const canAccess = db.prepare(`
        SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)
        UNION
        SELECT 1 FROM messages WHERE group_id IS NULL
          AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
        LIMIT 1
      `).get(myId, targetId, targetId, myId, myId, targetId, targetId, myId);
      if (!canAccess) return res.status(403).json({ error: '无权查看此对话' });
    }

    const cond = beforeInt ? 'AND m.id < ?' : '';
    const params = beforeInt
      ? [myId, userId, userId, myId, beforeInt, limitInt]
      : [myId, userId, userId, myId, limitInt];
    const msgs = db.prepare(`
      SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color
      FROM messages m JOIN users u ON m.sender_id=u.id
      WHERE m.group_id IS NULL AND m.recalled=0
        AND ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?))
        ${cond}
      ORDER BY m.id DESC LIMIT ?
    `).all(...params);
    res.json(msgs.reverse().map(formatMessage));
  });

  router.get('/group/:groupId', (req, res) => {
    const { groupId } = req.params;
    const { before, limit = 50 } = req.query;
    const myId = req.user.id;
    const beforeInt = before ? parseInt(before) : null;
    const limitInt = Math.min(parseInt(limit) || 50, 100);
    if (!/^\d+$/.test(groupId)) return res.status(400).json({ error: '无效的群ID' });

    // 鉴权：必须为群成员
    const membership = db.prepare(
      'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?'
    ).get(parseInt(groupId), myId);
    if (!membership) return res.status(403).json({ error: '仅群成员可查看群消息' });

    const cond = beforeInt ? 'AND m.id < ?' : '';
    const params = beforeInt
      ? [parseInt(groupId), beforeInt, limitInt]
      : [parseInt(groupId), limitInt];
    const msgs = db.prepare(`
      SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color,
        (SELECT COUNT(*) FROM message_reads WHERE message_id=m.id) as read_count
      FROM messages m JOIN users u ON m.sender_id=u.id
      WHERE m.group_id=? AND m.recalled=0 ${cond}
      ORDER BY m.id DESC LIMIT ?
    `).all(...params);
    res.json(msgs.reverse().map(formatMessage));
  });

  router.get('/conversations', (req, res) => {
    const myId = req.user.id;
    const privates = db.prepare(`
      SELECT
        CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END as peer_id,
        u.display_name as name, u.avatar_color,
        m.content as last_message, m.msg_type as last_type,
        m.created_at, m.sender_id as last_sender_id,
        NULL as group_id,
        COALESCE((
          SELECT COUNT(*) FROM messages m2
          WHERE m2.sender_id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END
            AND m2.receiver_id=? AND m2.recalled=0
            AND m2.id > COALESCE(
              (SELECT last_read_id FROM conversation_reads
               WHERE user_id=? AND conv_key='p:'||CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END),
              0)
        ), 0) as unread_count,
        COALESCE((SELECT is_pinned FROM conversation_settings WHERE user_id=? AND conv_key='p:'||CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END), 0) as is_pinned,
        COALESCE((SELECT is_muted  FROM conversation_settings WHERE user_id=? AND conv_key='p:'||CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END), 0) as is_muted
      FROM messages m
      JOIN users u ON u.id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END
      WHERE m.group_id IS NULL AND m.recalled=0
        AND (m.sender_id=? OR m.receiver_id=?)
        AND m.id=(
          SELECT MAX(m2.id) FROM messages m2
          WHERE m2.group_id IS NULL
            AND ((m2.sender_id=? AND m2.receiver_id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END)
              OR (m2.sender_id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END AND m2.receiver_id=?))
        )
    `).all(myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId);

    const groups = db.prepare(`
      SELECT
        NULL as peer_id, cg.name, cg.avatar_color,
        m.content as last_message, m.msg_type as last_type,
        m.created_at, m.sender_id as last_sender_id,
        cg.id as group_id,
        COALESCE((
          SELECT COUNT(*) FROM messages m2
          WHERE m2.group_id=cg.id AND m2.sender_id!=? AND m2.recalled=0
            AND m2.id > COALESCE(
              (SELECT last_read_id FROM conversation_reads WHERE user_id=? AND conv_key='g:'||cg.id),
              0)
        ), 0) as unread_count,
        COALESCE((SELECT is_pinned FROM conversation_settings WHERE user_id=? AND conv_key='g:'||cg.id), 0) as is_pinned,
        COALESCE((SELECT is_muted  FROM conversation_settings WHERE user_id=? AND conv_key='g:'||cg.id), 0) as is_muted
      FROM chat_groups cg
      JOIN group_members gm ON cg.id=gm.group_id AND gm.user_id=?
      LEFT JOIN messages m ON cg.id=m.group_id AND m.recalled=0
        AND m.id=(SELECT MAX(id) FROM messages WHERE group_id=cg.id AND recalled=0)
    `).all(myId, myId, myId, myId, myId);

    const all = [...privates, ...groups]
      .filter(c => c.last_message)
      .sort((a, b) => {
        if (b.is_pinned !== a.is_pinned) return b.is_pinned - a.is_pinned;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    res.json(all);
  });

  // ── Update conversation pin / mute ──────────────────────────────────────────
  router.post('/conversations/settings', (req, res) => {
    const myId = req.user.id;
    const { convKey, isPinned, isMuted } = req.body;
    if (!convKey) return res.status(400).json({ error: 'convKey required' });
    db.prepare(`
      INSERT INTO conversation_settings (user_id, conv_key, is_pinned, is_muted)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, conv_key) DO UPDATE SET
        is_pinned = COALESCE(excluded.is_pinned, is_pinned),
        is_muted  = COALESCE(excluded.is_muted,  is_muted)
    `).run(myId, convKey, isPinned ?? null, isMuted ?? null);
    res.json({ ok: true });
  });

  router.post('/voice', (req, res, next) => {
    upload.single('audio')(req, res, (err) => {
      if (err) {
        if (err.message === '不支持的文件类型，仅支持音频文件') {
          return res.status(400).json({ error: err.message });
        }
        return res.status(400).json({ error: '文件上传失败' });
      }
      next();
    });
  }, (req, res) => {
    const senderId = req.user.id;
    const { durationMs = 0, receiverId, groupId } = req.body;
    if (!receiverId && !groupId) return res.status(400).json({ error: '缺少接收方' });
    if (receiverId && groupId) return res.status(400).json({ error: '不能同时指定 receiverId 和 groupId' });
    if (receiverId) {
      const targetNum = Number(receiverId);
      if (isNaN(targetNum) || targetNum <= 0) return res.status(400).json({ error: '无效的 receiverId' });
      const isContact = db.prepare(
        'SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)'
      ).get(senderId, targetNum, targetNum, senderId);
      if (!isContact) return res.status(403).json({ error: '仅好友之间可以发送语音消息' });
    }
    if (groupId) {
      const groupNum = Number(groupId);
      if (isNaN(groupNum) || groupNum <= 0) return res.status(400).json({ error: '无效的 groupId' });
      const member = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(groupNum, senderId);
      if (!member) return res.status(403).json({ error: '你不在该群组中' });
    }
    let voiceUrl;
    if (req.file) {
      voiceUrl = `/uploads/voice/${req.file.filename}`;
    } else if (req.body.voiceUrl) {
      // Only allow relative URLs (same-origin uploads), block external URLs
      if (!/^\/uploads\/voice\//.test(req.body.voiceUrl)) {
        return res.status(400).json({ error: '无效的语音链接' });
      }
      voiceUrl = req.body.voiceUrl;
    } else {
      return res.status(400).json({ error: 'audio file or voiceUrl required' });
    }
    const content = JSON.stringify({ voiceUrl, durationMs: Number(durationMs) });
    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type) VALUES (?, ?, ?, ?, ?)'
    ).run(senderId, receiverId ? Number(receiverId) : null, groupId ? Number(groupId) : null, content, 'voice');
    const saved = db.prepare(
      'SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?'
    ).get(result.lastInsertRowid);
    const formattedMsg = formatMessage(saved);
    if (groupId) {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(Number(groupId));
      members.forEach(m => { if (m.user_id !== senderId) emitTo(m.user_id, 'new_message', formattedMsg); });
    } else if (receiverId) {
      emitTo(Number(receiverId), 'new_message', formattedMsg);
    }
    res.json(formattedMsg);
  });

  router.post('/file', (req, res, next) => {
    fileUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到文件' });
      const senderId = req.user.id;
      const { receiverId, groupId } = req.body;
      if (!receiverId && !groupId) return res.status(400).json({ error: '缺少接收方' });
      if (receiverId && groupId) return res.status(400).json({ error: '不能同时指定 receiverId 和 groupId' });
      if (receiverId) {
        const targetNum = Number(receiverId);
        if (isNaN(targetNum) || targetNum <= 0) return res.status(400).json({ error: '无效的 receiverId' });
        const isContact = db.prepare(
          'SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)'
        ).get(senderId, targetNum, targetNum, senderId);
        if (!isContact) return res.status(403).json({ error: '仅好友之间可以发送文件' });
      }
      if (groupId) {
        const groupNum = Number(groupId);
        if (isNaN(groupNum) || groupNum <= 0) return res.status(400).json({ error: '无效的 groupId' });
        const member = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(groupNum, senderId);
        if (!member) return res.status(403).json({ error: '你不在该群组中' });
      }
      const fileUrl = `/uploads/files/${req.file.filename}`;
      const content = JSON.stringify({
        fileUrl,
        fileName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      });
      const result = db.prepare(
        'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type) VALUES (?, ?, ?, ?, ?)'
      ).run(senderId, receiverId ? Number(receiverId) : null, groupId ? Number(groupId) : null, content, 'file');
      const saved = db.prepare(
        'SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?'
      ).get(result.lastInsertRowid);
      const formatted = formatMessage(saved);
      if (groupId) {
        const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(Number(groupId));
        members.forEach(m => { if (m.user_id !== senderId) emitTo(m.user_id, 'new_message', formatted); });
      } else if (receiverId) {
        emitTo(Number(receiverId), 'new_message', formatted);
      }
      res.json(formatted);
    });
  });

  router.post('/image', (req, res, next) => {
    imageUpload.single('image')(req, res, (err) => {
      if (err || !req.file) return res.status(400).json({ error: '未收到图片' });
      const senderId = req.user.id;
      const receiverId = req.body.receiverId;
      const groupId = req.body.groupId;
      if (!receiverId && !groupId) return res.status(400).json({ error: '缺少接收方' });
      if (receiverId && groupId) return res.status(400).json({ error: '不能同时指定 receiverId 和 groupId' });
      if (receiverId) {
        const targetNum = Number(receiverId);
        if (isNaN(targetNum) || targetNum <= 0) return res.status(400).json({ error: '无效的 receiverId' });
        const isContact = db.prepare(
          'SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)'
        ).get(senderId, targetNum, targetNum, senderId);
        if (!isContact) return res.status(403).json({ error: '仅好友之间可以发送图片' });
      }
      if (groupId) {
        const groupNum = Number(groupId);
        if (isNaN(groupNum) || groupNum <= 0) return res.status(400).json({ error: '无效的 groupId' });
        const member = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(groupNum, senderId);
        if (!member) return res.status(403).json({ error: '你不在该群组中' });
      }
      const imageUrl = `/uploads/images/${req.file.filename}`;
      const content = JSON.stringify({ imageUrl, width: req.body.width, height: req.body.height });
      const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type) VALUES (?, ?, ?, ?, ?)')
        .run(senderId, receiverId ? Number(receiverId) : null, groupId ? Number(groupId) : null, content, 'image');
      const saved = db.prepare(
        'SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?'
      ).get(result.lastInsertRowid);
      const formatted = formatMessage(saved);
      if (groupId) {
        const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(Number(groupId));
        members.forEach(m => { if (m.user_id !== senderId) emitTo(m.user_id, 'new_message', formatted); });
      } else if (receiverId) {
        emitTo(Number(receiverId), 'new_message', formatted);
      }
      res.json(formatted);
    });
  });

  // ── Read receipts ─────────────────────────────────────────────────
  router.get('/read-receipts/:messageId', (req, res) => {
    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId)) return res.status(400).json({ error: '无效的消息ID' });
    const myId = req.user.id;
    const msg = db.prepare('SELECT sender_id, group_id FROM messages WHERE id=?').get(messageId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });

    if (msg.group_id) {
      // Group message: only owner/admin can view
      const role = db.prepare(
        'SELECT role FROM group_members WHERE group_id=? AND user_id=?'
      ).get(msg.group_id, myId)?.role;
      if (role !== 'owner' && role !== 'admin') {
        return res.status(403).json({ error: '仅群主或管理员可查看已读回执' });
      }
    } else {
      // Private message: only sender can view
      if (msg.sender_id !== myId) {
        return res.status(403).json({ error: '仅发送者可查看已读回执' });
      }
    }

    const readers = db.prepare(`
      SELECT mr.user_id, mr.read_at, u.display_name, u.avatar_color
      FROM message_reads mr
      JOIN users u ON mr.user_id = u.id
      WHERE mr.message_id = ?
      ORDER BY mr.read_at
    `).all(messageId);
    res.json(readers);
  });

  return router;
};
