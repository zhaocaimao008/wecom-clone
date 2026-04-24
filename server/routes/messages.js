const express = require('express');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const { formatMessage } = require('../utils/normalizeMessage');

const ALLOWED_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'];

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/voice'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
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

module.exports = (db) => {
  const router = express.Router();
  router.use(authMiddleware);

  router.get('/private/:userId', (req, res) => {
    const { userId } = req.params;
    const { before, limit = 50 } = req.query;
    const myId = req.user.id;
    const beforeInt = before ? parseInt(before) : null;
    const limitInt = Math.min(parseInt(limit) || 50, 100);
    if (!/^\d+$/.test(userId)) return res.status(400).json({ error: '无效的用户ID' });
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
    const beforeInt = before ? parseInt(before) : null;
    const limitInt = Math.min(parseInt(limit) || 50, 100);
    if (!/^\d+$/.test(groupId)) return res.status(400).json({ error: '无效的群ID' });
    const cond = beforeInt ? 'AND m.id < ?' : '';
    const params = beforeInt
      ? [parseInt(groupId), beforeInt, limitInt]
      : [parseInt(groupId), limitInt];
    const msgs = db.prepare(`
      SELECT m.*,u.display_name as sender_name,u.avatar_color as sender_color
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
        ), 0) as unread_count
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
    `).all(myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId);

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
        ), 0) as unread_count
      FROM chat_groups cg
      JOIN group_members gm ON cg.id=gm.group_id AND gm.user_id=?
      LEFT JOIN messages m ON cg.id=m.group_id AND m.recalled=0
        AND m.id=(SELECT MAX(id) FROM messages WHERE group_id=cg.id AND recalled=0)
    `).all(myId, myId, myId);

    const all = [...privates, ...groups]
      .filter(c => c.last_message)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(all);
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
    let voiceUrl;
    if (req.file) {
      voiceUrl = `/uploads/voice/${req.file.filename}`;
    } else if (req.body.voiceUrl) {
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
    res.json(formatMessage(saved));
  });

  return router;
};
