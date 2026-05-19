const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const { formatMessage } = require('../utils/normalizeMessage');
const { pushToUser } = require('../utils/webPush');

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

// Allowed file extensions (mapped from mime type; never trust user-supplied extension)
const SAFE_FILE_EXT = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/json': '.json',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
};

// 安全的文件名生成：使用UUID，完全丢弃原始文件名
function safeFilename(ext) {
  return `${crypto.randomUUID()}${ext}`;
}

const SAFE_AUDIO_EXT = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav' };
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/voice'),
  filename: (req, file, cb) => {
    const ext = SAFE_AUDIO_EXT[file.mimetype] || '.webm';
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
    // Use mime-derived extension, never trust user-supplied extension
    const ext = SAFE_FILE_EXT[file.mimetype] || '.bin';
    cb(null, safeFilename(ext));
  },
});

const fileUpload = multer({
  storage: fileStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (ALLOWED_FILE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  },
});

const SAFE_IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
const ALLOWED_IMAGE_TYPES = Object.keys(SAFE_IMAGE_EXT);
const imageStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/images'),
  filename: (req, file, cb) => {
    const ext = SAFE_IMAGE_EXT[file.mimetype] || '.jpg';
    cb(null, safeFilename(ext));
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
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

  function pushIfOffline(targetUserId, payload) {
    if (!connectedUsers?.has(Number(targetUserId))) {
      pushToUser(db, targetUserId, payload).catch(() => {});
    }
  }

  function groupPushOffline(groupId, excludeUserId, payload) {
    setImmediate(() => {
      try {
        const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=? AND user_id!=?').all(groupId, excludeUserId);
        members.filter(m => !connectedUsers?.has(Number(m.user_id)))
          .forEach(m => pushToUser(db, m.user_id, payload).catch(() => {}));
      } catch {}
    });
  }

  // Returns error string if sender is muted in group, null if allowed
  function checkGroupMute(groupId, senderId) {
    const grp = db.prepare('SELECT mute_all FROM chat_groups WHERE id=?').get(groupId);
    const m = db.prepare('SELECT role, muted_until FROM group_members WHERE group_id=? AND user_id=?').get(groupId, senderId);
    if (m?.role !== 'member') return null; // admins/owners are never muted
    if (grp?.mute_all) return '全员禁言中，只有管理员可以发言';
    if (m.muted_until != null && (m.muted_until === 0 || m.muted_until > Date.now())) return '你已被群主禁言';
    return null;
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
    if (!/^\d+$/.test(userId)) return res.status(400).json({ error: '无效的用户ID' });
    const myId = req.user.id;
    const targetId = parseInt(userId);
    const beforeInt = before ? parseInt(before) : null;
    const limitInt = Math.min(parseInt(limit) || 50, 100);

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

    // UNION ALL 让两个方向各自命中 idx_messages_private 索引，避免全表扫描
    const cond = beforeInt ? 'AND m.id < ?' : '';
    const half1 = beforeInt
      ? [myId, targetId, beforeInt, limitInt]
      : [myId, targetId, limitInt];
    const half2 = beforeInt
      ? [targetId, myId, beforeInt, limitInt]
      : [targetId, myId, limitInt];
    const msgs = db.prepare(`
      SELECT * FROM (
        SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color,
          rm.content as reply_content, rm.msg_type as reply_msg_type,
          ru.display_name as reply_sender_name
        FROM messages m JOIN users u ON m.sender_id=u.id
        LEFT JOIN messages rm ON rm.id=m.reply_to
        LEFT JOIN users ru ON ru.id=rm.sender_id
        WHERE m.group_id IS NULL AND m.recalled=0
          AND m.sender_id=? AND m.receiver_id=? ${cond}
        ORDER BY m.id DESC LIMIT ?
      )
      UNION ALL
      SELECT * FROM (
        SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color,
          rm.content as reply_content, rm.msg_type as reply_msg_type,
          ru.display_name as reply_sender_name
        FROM messages m JOIN users u ON m.sender_id=u.id
        LEFT JOIN messages rm ON rm.id=m.reply_to
        LEFT JOIN users ru ON ru.id=rm.sender_id
        WHERE m.group_id IS NULL AND m.recalled=0
          AND m.sender_id=? AND m.receiver_id=? ${cond}
        ORDER BY m.id DESC LIMIT ?
      )
      ORDER BY id DESC LIMIT ?
    `).all(...half1, ...half2, limitInt);
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
        COALESCE(rc.read_count, 0) as read_count,
        rm.content as reply_content, rm.msg_type as reply_msg_type,
        ru.display_name as reply_sender_name
      FROM messages m
      JOIN users u ON m.sender_id=u.id
      LEFT JOIN (
        SELECT message_id, COUNT(*) as read_count
        FROM message_reads
        GROUP BY message_id
      ) rc ON rc.message_id = m.id
      LEFT JOIN messages rm ON rm.id=m.reply_to
      LEFT JOIN users ru ON ru.id=rm.sender_id
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
        u.display_name as name, u.avatar_color, u.avatar_url,
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
      JOIN contacts ct ON ct.user_id=? AND ct.contact_id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END
      WHERE m.group_id IS NULL AND m.recalled=0
        AND (m.sender_id=? OR m.receiver_id=?)
        AND m.id=(
          SELECT MAX(m2.id) FROM messages m2
          WHERE m2.group_id IS NULL AND m2.recalled=0
            AND ((m2.sender_id=? AND m2.receiver_id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END)
              OR (m2.sender_id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END AND m2.receiver_id=?))
        )
    `).all(myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId);

    const groups = db.prepare(`
      SELECT
        NULL as peer_id, cg.name, cg.avatar_color, cg.avatar_url,
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
    const pinnedVal = isPinned != null ? (isPinned ? 1 : 0) : null;
    const mutedVal  = isMuted  != null ? (isMuted  ? 1 : 0) : null;
    db.prepare(`
      INSERT INTO conversation_settings (user_id, conv_key, is_pinned, is_muted)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, conv_key) DO UPDATE SET
        is_pinned = COALESCE(excluded.is_pinned, is_pinned),
        is_muted  = COALESCE(excluded.is_muted,  is_muted)
    `).run(myId, convKey, pinnedVal, mutedVal);
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
    let { durationMs = 0, receiverId, groupId } = req.body;
    durationMs = Math.max(0, Math.min(Number(durationMs) || 0, 3_600_000));
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
      const muteErr = checkGroupMute(groupNum, senderId);
      if (muteErr) return res.status(403).json({ error: muteErr });
    }
    let replyToId = req.body.replyToId ? parseInt(req.body.replyToId) : null;
    if (replyToId && (!Number.isInteger(replyToId) || replyToId <= 0)) replyToId = null;
    let voiceUrl;
    if (req.file) {
      voiceUrl = `/uploads/voice/${req.file.filename}`;
    } else if (req.body.voiceUrl) {
      if (!/^\/uploads\/voice\//.test(req.body.voiceUrl)) {
        return res.status(400).json({ error: '无效的语音链接' });
      }
      voiceUrl = req.body.voiceUrl;
    } else {
      return res.status(400).json({ error: 'audio file or voiceUrl required' });
    }
    const content = JSON.stringify({ voiceUrl, durationMs: Number(durationMs) });
    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type, reply_to) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(senderId, receiverId ? Number(receiverId) : null, groupId ? Number(groupId) : null, content, 'voice', replyToId);
    const saved = db.prepare(
      'SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color,rm.content as reply_content,rm.msg_type as reply_msg_type,ru.display_name as reply_sender_name FROM messages m JOIN users u ON m.sender_id=u.id LEFT JOIN messages rm ON rm.id=m.reply_to LEFT JOIN users ru ON ru.id=rm.sender_id WHERE m.id=?'
    ).get(result.lastInsertRowid);
    const formattedMsg = formatMessage(saved);
    if (groupId) {
      io.to('group_' + Number(groupId)).emit('new_message', formattedMsg);
      const grp = db.prepare('SELECT name FROM chat_groups WHERE id=?').get(Number(groupId));
      groupPushOffline(Number(groupId), senderId, { title: grp?.name || '群消息', body: `${saved.sender_name}: [语音]`, convId: Number(groupId), convType: 'group' });
    } else if (receiverId) {
      emitTo(Number(receiverId), 'new_message', formattedMsg);
      emitTo(senderId, 'new_message', formattedMsg);
      pushIfOffline(Number(receiverId), { title: saved.sender_name, body: '[语音]', convId: senderId, convType: 'private' });
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
        const muteErr = checkGroupMute(groupNum, senderId);
        if (muteErr) return res.status(403).json({ error: muteErr });
      }
      const replyToIdFile = req.body.replyToId ? parseInt(req.body.replyToId) : null;
      const fileUrl = `/uploads/files/${req.file.filename}`;
      const content = JSON.stringify({
        fileUrl,
        fileName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      });
      const result = db.prepare(
        'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type, reply_to) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(senderId, receiverId ? Number(receiverId) : null, groupId ? Number(groupId) : null, content, 'file', replyToIdFile || null);
      const saved = db.prepare(
        'SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color,rm.content as reply_content,rm.msg_type as reply_msg_type,ru.display_name as reply_sender_name FROM messages m JOIN users u ON m.sender_id=u.id LEFT JOIN messages rm ON rm.id=m.reply_to LEFT JOIN users ru ON ru.id=rm.sender_id WHERE m.id=?'
      ).get(result.lastInsertRowid);
      const formatted = formatMessage(saved);
      if (groupId) {
        io.to('group_' + Number(groupId)).emit('new_message', formatted);
        const grp = db.prepare('SELECT name FROM chat_groups WHERE id=?').get(Number(groupId));
        groupPushOffline(Number(groupId), senderId, { title: grp?.name || '群消息', body: `${saved.sender_name}: [文件]`, convId: Number(groupId), convType: 'group' });
      } else if (receiverId) {
        emitTo(Number(receiverId), 'new_message', formatted);
        emitTo(senderId, 'new_message', formatted);
        pushIfOffline(Number(receiverId), { title: saved.sender_name, body: '[文件]', convId: senderId, convType: 'private' });
      }
      res.json(formatted);
    });
  });

  router.post('/image', (req, res, next) => {
    imageUpload.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || '图片上传失败' });
      if (!req.file) return res.status(400).json({ error: '未收到图片' });
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
        const muteErr = checkGroupMute(groupNum, senderId);
        if (muteErr) return res.status(403).json({ error: muteErr });
      }
      const replyToIdImg = req.body.replyToId ? parseInt(req.body.replyToId) : null;
      const imageUrl = `/uploads/images/${req.file.filename}`;
      const w = parseInt(req.body.width, 10);
      const h = parseInt(req.body.height, 10);
      const content = JSON.stringify({ imageUrl, width: isFinite(w) && w > 0 ? w : null, height: isFinite(h) && h > 0 ? h : null });
      const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type, reply_to) VALUES (?, ?, ?, ?, ?, ?)')
        .run(senderId, receiverId ? Number(receiverId) : null, groupId ? Number(groupId) : null, content, 'image', replyToIdImg || null);
      const saved = db.prepare(
        'SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color,rm.content as reply_content,rm.msg_type as reply_msg_type,ru.display_name as reply_sender_name FROM messages m JOIN users u ON m.sender_id=u.id LEFT JOIN messages rm ON rm.id=m.reply_to LEFT JOIN users ru ON ru.id=rm.sender_id WHERE m.id=?'
      ).get(result.lastInsertRowid);
      const formatted = formatMessage(saved);
      if (groupId) {
        io.to('group_' + Number(groupId)).emit('new_message', formatted);
        const grp = db.prepare('SELECT name FROM chat_groups WHERE id=?').get(Number(groupId));
        groupPushOffline(Number(groupId), senderId, { title: grp?.name || '群消息', body: `${saved.sender_name}: [图片]`, convId: Number(groupId), convType: 'group' });
      } else if (receiverId) {
        emitTo(Number(receiverId), 'new_message', formatted);
        emitTo(senderId, 'new_message', formatted);
        pushIfOffline(Number(receiverId), { title: saved.sender_name, body: '[图片]', convId: senderId, convType: 'private' });
      }
      res.json(formatted);
    });
  });

  // ── Batch reactions fetch ──────────────────────────────────────────
  router.post('/reactions', (req, res) => {
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) return res.json({});
    if (!messageIds.every(id => Number.isInteger(id) && id > 0)) return res.status(400).json({ error: '无效的messageIds' });
    if (messageIds.length > 200) return res.status(400).json({ error: '一次最多查询200条' });
    const rows = db.prepare(
      `SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (${messageIds.map(() => '?').join(',')})`
    ).all(...messageIds);
    const result = {};
    rows.forEach(r => {
      if (!result[r.message_id]) result[r.message_id] = {};
      if (!result[r.message_id][r.emoji]) result[r.message_id][r.emoji] = [];
      result[r.message_id][r.emoji].push(r.user_id);
    });
    res.json(result);
  });

  // ── Read receipts ─────────────────────────────────────────────────
  // ── Message search ────────────────────────────────────────────────────
  router.get('/search', (req, res) => {
    const myId = req.user.id;
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (!q) return res.json([]);
    const safe = q.replace(/[\\%_]/g, c => '\\' + c);
    const rows = db.prepare(`
      SELECT m.id, m.content, m.msg_type, m.created_at, m.sender_id, m.receiver_id, m.group_id,
             u.display_name AS sender_name, u.avatar_color AS sender_color,
             CASE WHEN m.group_id IS NOT NULL THEN g.name
                  WHEN m.sender_id = @me THEN ru.display_name
                  ELSE su.display_name END AS conv_name,
             g.avatar_color AS group_color,
             m.group_id AS conv_group_id,
             CASE WHEN m.group_id IS NULL THEN
               CASE WHEN m.sender_id = @me THEN m.receiver_id ELSE m.sender_id END
             ELSE NULL END AS conv_peer_id
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN chat_groups g ON m.group_id = g.id
      LEFT JOIN users ru ON m.receiver_id = ru.id
      LEFT JOIN users su ON m.sender_id = su.id
      WHERE m.recalled = 0
        AND m.msg_type = 'text'
        AND m.content NOT LIKE '{"v":1,%'
        AND m.content LIKE @q ESCAPE '\\'
        AND (
          (m.group_id IS NULL AND (m.sender_id = @me OR m.receiver_id = @me))
          OR (m.group_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = m.group_id AND gm.user_id = @me
          ))
        )
      ORDER BY m.id DESC
      LIMIT @limit
    `).all({ me: myId, q: `%${safe}%`, limit });
    res.json(rows);
  });

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
