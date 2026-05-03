'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { normalizeVoiceMessage, formatMessage } = require('./utils/normalizeMessage');

// ── Env checks ──────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}
// Enforce minimum 32-byte (256-bit) random string for JWT secret
if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET must be at least 32 characters long for adequate entropy');
  process.exit(1);
}
const PORT = process.env.PORT || 3001;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);

// ── App setup ───────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS.length > 0
      ? CORS_ORIGINS
      : false,              // no CORS in production without explicit origin list
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

if (CORS_ORIGINS.length > 0) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
} else {
  app.use(cors());
}

app.use(express.json({ limit: '1mb' }));

// ── Health check ────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Rate limiting ────────────────────────────────────────────────────
const msgLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '消息发送太快，请稍后再试' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作太频繁，请稍后再试' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/send-code', authLimiter);

// ── Static files ────────────────────────────────────────────────────
const clientDist = require('path').join(__dirname, '../client/dist');
app.use(require('express').static(clientDist));
app.use(express.static('public'));

// ── Desktop app download ──────────────────────────────────────────────
app.get('/download/desktop', (req, res) => {
  const appImage = require('path').join(__dirname, '../desktop/release/企业密信-1.0.0.AppImage');
  const { existsSync } = require('fs');
  if (existsSync(appImage)) {
    res.download(appImage, '企业密信-1.0.0.AppImage');
  } else {
    res.status(404).json({ error: '安装包不存在' });
  }
});

app.get('/download/android', (req, res) => {
  const file = require('path').join(__dirname, '../client/android/app/build/outputs/apk/debug/app-debug.apk');
  const { existsSync } = require('fs');
  if (existsSync(file)) {
    res.download(file, '企业密信.apk');
  } else {
    res.status(404).json({ error: 'APK 不存在' });
  }
});

app.get('/download/desktop-windows', (req, res) => {
  const file = require('path').join(__dirname, '../desktop/release/企业密信-Windows.tar.gz');
  const { existsSync } = require('fs');
  if (existsSync(file)) {
    res.download(file, '企业密信-Windows.tar.gz');
  } else {
    res.status(404).json({ error: '安装包不存在' });
  }
});
// ── Protected upload routes ───────────────────────────────────────────
// Verify JWT before serving any uploaded file
function authUpload(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: '未授权' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token 无效' });
  }
}

app.use('/uploads', authUpload, express.static(require('path').join(__dirname, 'uploads')));
app.use('/uploads/avatars', authUpload, express.static(require('path').join(__dirname, 'uploads/avatars')));

// ── Socket.io ───────────────────────────────────────────────────────
const connectedUsers = new Map(); // userId (Number) → Set<socketId>
const msgRateLimit = new Map();   // userId → { count, windowStart }

const MSG_RATE_WINDOW = 60 * 1000;  // 1 minute
const MSG_RATE_MAX    = 60;         // 60 messages per window

function checkMsgRate(uid) {
  const now = Date.now();
  const entry = msgRateLimit.get(uid);
  if (!entry || now - entry.windowStart > MSG_RATE_WINDOW) {
    msgRateLimit.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MSG_RATE_MAX) return false;
  entry.count++;
  return true;
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('auth'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('auth'));
  }
});

// Track connection time for idle-timeout tracking
const connectedAt = new Map(); // socketId → timestamp

io.on('connection', (socket) => {
  const uid = socket.user.id;
  connectedAt.set(socket.id, Date.now());

  if (!connectedUsers.has(uid)) connectedUsers.set(uid, new Set());
  connectedUsers.get(uid).add(socket.id);

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', uid);
  io.emit('user_status', { userId: uid, status: 'online' });

  // ── Send message ──────────────────────────────────────────────────
  socket.on('send_message', ({ receiverId, groupId, content, msgType = 'text', durationMs = 0, replyToId = null, clientMsgId = null }) => {
    if (!content) return;
    if (msgType !== 'voice' && msgType !== 'card' && !content.trim()) return;
    if (msgType === 'text' && content.length > 10000) return;

    // ── Idempotency: 防止重复发送 ──────────────────────────────────────
    if (clientMsgId) {
      const existing = db.prepare('SELECT id FROM messages WHERE sender_id=? AND client_msg_id=?').get(uid, clientMsgId);
      if (existing) {
        // 消息已存在，查询完整消息并转发给接收方（确保对方收到）
        const existingMsg = db.prepare(
          'SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?'
        ).get(existing.id);
        if (existingMsg) {
          const formatted = formatMessage(existingMsg);
          if (receiverId) {
            emit(receiverId, 'new_message', formatted);
          } else if (groupId) {
            const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(groupId);
            members.forEach(m => emit(m.user_id, 'new_message', formatted));
          }
        }
        // 返回服务器分配的ID给客户端，让客户端更新本地消息状态
        return socket.emit('message_confirmed', { clientMsgId, serverId: existing.id });
      }
    }
    // ─────────────────────────────────────────────────────────────────

    if (!checkMsgRate(uid)) {
      return socket.emit('send_error', { message: '消息发送太快，请稍后再试' });
    }

    // ── restriction checks ──────────────────────────────────────────
    if (groupId) {
      // Security: verify sender is actually a member of this group
      const member = db.prepare(
        'SELECT role FROM group_members WHERE group_id=? AND user_id=?'
      ).get(groupId, uid);
      if (!member) return socket.emit('send_error', { message: '你不在该群组中' });

      const grp = db.prepare('SELECT mute_all FROM chat_groups WHERE id=?').get(groupId);
      if (grp?.mute_all && member.role === 'member') {
        return socket.emit('send_error', { message: '全员禁言中，只有管理员可以发言' });
      }
    }

    if (receiverId) {
      const restricted = db.prepare(`
        SELECT cg.name FROM chat_groups cg
        JOIN group_members gm1 ON cg.id=gm1.group_id AND gm1.user_id=?
        JOIN group_members gm2 ON cg.id=gm2.group_id AND gm2.user_id=?
        WHERE cg.restrict_private_chat=1 AND gm1.role='member' AND gm2.role='member'
        LIMIT 1
      `).get(uid, receiverId);
      if (restricted) {
        return socket.emit('send_error', { message: `「${restricted.name}」群已禁止成员私聊` });
      }
    }
    // ────────────────────────────────────────────────────────────────

    let storedContent;
    let voiceData;
    let cardData = null;
    if (msgType === 'voice') {
      voiceData = normalizeVoiceMessage({ content, duration: durationMs });
      storedContent = JSON.stringify({ voiceUrl: voiceData.voiceUrl, durationMs: voiceData.durationMs });
    } else if (msgType === 'card') {
      try { cardData = typeof content === 'string' ? JSON.parse(content) : content; } catch {}
      storedContent = typeof content === 'string' ? content : JSON.stringify(content);
    } else {
      storedContent = content.trim();
    }

    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type, reply_to, client_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uid, receiverId || null, groupId || null, storedContent, msgType, replyToId, clientMsgId || null);

    const sender = db.prepare('SELECT display_name, avatar_color FROM users WHERE id = ?').get(uid);

    const base = {
      id: result.lastInsertRowid,
      sender_id: uid,
      sender_name: sender.display_name,
      sender_color: sender.avatar_color,
      receiver_id: receiverId || null,
      group_id: groupId || null,
      msg_type: msgType,
      recalled: 0,
      reply_to_id: replyToId,  // keep consistent key for frontend

      created_at: new Date().toISOString(),
      clientMsgId: clientMsgId || null,
    };

    const msg = msgType === 'voice'
      ? { ...base, type: 'voice', voiceUrl: voiceData.voiceUrl, durationMs: voiceData.durationMs }
      : msgType === 'card'
      ? { ...base, type: 'card', content: storedContent, ...(cardData || {}) }
      : { ...base, type: msgType || 'text', content: content.trim() };

    if (receiverId) {
      emit(uid, 'new_message', msg);
      emit(receiverId, 'new_message', msg);
    } else if (groupId) {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
      members.forEach(m => emit(m.user_id, 'new_message', msg));

      // ── @mention support ───────────────────────────────────────────────
      // Extract @username patterns from text messages (and card content)
      const rawContent = msg.content || '';
      const mentionMatches = [...rawContent.matchAll(/@([^\s@]{1,30})/g)];
      if (mentionMatches.length > 0) {
        // Build a map of lowercase display_name → user_id for all group members
        const memberUsers = db.prepare(
          'SELECT u.id, u.display_name FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=?'
        ).all(groupId);
        const nameToId = {};
        memberUsers.forEach(u => { nameToId[u.display_name.toLowerCase()] = u.id; });

        mentionMatches.forEach(async ([, username]) => {
          const mentionedId = nameToId[username.toLowerCase()];
          if (mentionedId && Number(mentionedId) !== uid) {
            // Emit a dedicated mention event to the mentioned user (skip sender)
            emit(mentionedId, 'mention', {
              mentionedBy: uid,
              senderName: sender.display_name,
              groupId,
              groupName: db.prepare('SELECT name FROM chat_groups WHERE id=?').get(groupId)?.name || '',
              message: msg,
            });
          }
        });
      }
      // ──────────────────────────────────────────────────────────────────
    }
  });

  // ── Recall message ────────────────────────────────────────────────
  socket.on('recall_message', ({ messageId }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!msg) return socket.emit('error', { message: '消息不存在' });
    // Group owner/admin can recall any member's message without time limit
    const isGroupAdmin = msg.group_id
      ? db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role IN ('owner','admin')").get(msg.group_id, uid)
      : null;
    if (msg.sender_id !== uid && !isGroupAdmin) {
      return socket.emit('error', { message: '无权撤回此消息' });
    }
    const diffSec = (Date.now() - new Date(msg.created_at).getTime()) / 1000;
    if (msg.sender_id === uid && diffSec > 300 && !isGroupAdmin) {
      return socket.emit('error', { message: '超过5分钟，无法撤回' });
    }

    db.prepare('UPDATE messages SET recalled = 1 WHERE id = ?').run(messageId);

    const payload = { messageId, recallerId: uid };
    if (msg.receiver_id) {
      emit(uid, 'message_recalled', payload);
      emit(msg.receiver_id, 'message_recalled', payload);
    } else if (msg.group_id) {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(msg.group_id);
      members.forEach(m => emit(m.user_id, 'message_recalled', payload));
    }
  });

  // ── Delete message for all (bidirectional, no time limit) ─────────
  socket.on('delete_message', ({ messageId }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
    if (!msg) return socket.emit('error', { message: '消息不存在或无权删除' });

    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);

    const payload = { messageId };
    if (msg.receiver_id) {
      emit(uid, 'message_deleted', payload);
      emit(msg.receiver_id, 'message_deleted', payload);
    } else if (msg.group_id) {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(msg.group_id);
      members.forEach(m => emit(m.user_id, 'message_deleted', payload));
    }
  });

  socket.on('edit_message', ({ messageId, content }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
    if (!msg) return socket.emit('error', { message: '消息不存在或无权编辑' });
    if (msg.msg_type !== 'text') return socket.emit('error', { message: '只能编辑文字消息' });
    if (msg.recalled) return socket.emit('error', { message: '已撤回的消息不能编辑' });
    const diffSec = (Date.now() - new Date(msg.created_at).getTime()) / 1000;
    if (diffSec > 300) return socket.emit('error', { message: '超过5分钟，无法编辑' });
    const newContent = (content || '').trim();
    if (!newContent) return socket.emit('error', { message: '消息内容不能为空' });

    db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(newContent, messageId);

    const payload = { messageId, content: newContent };
    if (msg.receiver_id) {
      emit(uid, 'message_edited', payload);
      emit(msg.receiver_id, 'message_edited', payload);
    } else if (msg.group_id) {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(msg.group_id);
      members.forEach(m => emit(m.user_id, 'message_edited', payload));
    }
  });

  // ── Typing indicator ──────────────────────────────────────────────
  socket.on('typing', ({ receiverId, groupId, isTyping }) => {
    const payload = { userId: uid, isTyping };
    if (receiverId) emit(receiverId, 'typing', payload);
  });

  // ── Read receipts ─────────────────────────────────────────────────
  socket.on('mark_read', ({ messageId }) => {
    if (!messageId) return;
    const msg = db.prepare('SELECT sender_id, receiver_id, group_id FROM messages WHERE id=?').get(messageId);
    if (!msg) return;
    // Don't record if sender is reading their own message
    if (msg.sender_id === uid) return;
    // Record read receipt
    db.prepare('INSERT OR REPLACE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)').run(messageId, uid, new Date().toISOString());
    // Notify sender that this message was read
    if (msg.sender_id) {
      emit(msg.sender_id, 'message_read', { messageId, readerId: uid, readAt: new Date().toISOString() });
    }
  });

  // ── WebRTC Signaling ──────────────────────────────────────────────
  socket.on('call_offer', ({ targetId, offer, callType }) => {
    const caller = db.prepare('SELECT display_name, avatar_color FROM users WHERE id=?').get(uid);
    emit(targetId, 'call_incoming', { callerId: uid, callerName: caller.display_name, callerColor: caller.avatar_color, offer, callType });
  });

  socket.on('call_answer', ({ targetId, answer }) => {
    emit(targetId, 'call_answered', { answer, calleeId: uid });
  });

  socket.on('call_ice', ({ targetId, candidate }) => {
    emit(targetId, 'call_ice', { candidate, fromId: uid });
  });

  socket.on('call_reject', ({ targetId }) => {
    emit(targetId, 'call_rejected', { calleeId: uid });
  });

  socket.on('call_end', ({ targetId }) => {
    emit(targetId, 'call_ended', { fromId: uid });
  });

  // ── Reactions ──────────────────────────────────────────────────────
  socket.on('toggle_reaction', ({ messageId, emoji }) => {
    if (!messageId || !emoji) return;
    const msgRow = db.prepare('SELECT group_id, sender_id FROM messages WHERE id=?').get(messageId);
    if (!msgRow) return;
    const existing = db.prepare('SELECT id FROM message_reactions WHERE message_id=? AND emoji=? AND user_id=?').get(messageId, emoji, uid);
    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE id=?').run(existing.id);
    } else {
      db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, uid, emoji);
    }
    const rows = db.prepare('SELECT user_id FROM message_reactions WHERE message_id=? AND emoji=? ').all(messageId, emoji);
    const room = msgRow.group_id ? 'group_' + msgRow.group_id : null;
    if (room) io.to(room).emit('reaction_update', { messageId, emoji, userIds: rows.map(r => r.user_id) });
    if (msgRow.sender_id !== uid) emit(msgRow.sender_id, 'reaction_update', { messageId, emoji, userIds: rows.map(r => r.user_id) });
  });

  socket.on('call_busy', ({ targetId }) => {
    emit(targetId, 'call_busy', { userId: uid });
  });
  // ─────────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    connectedAt.delete(socket.id);
    const sockets = connectedUsers.get(uid);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        connectedUsers.delete(uid);
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run('offline', uid);
        io.emit('user_status', { userId: uid, status: 'offline' });
      }
    }
  });
});

// userId is always coerced to Number for Map lookups
function emit(userId, event, data) {
  const sockets = connectedUsers.get(Number(userId));
  if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
}

app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/users', require('./routes/users')(db, io, connectedUsers));
app.use('/api/messages', require('./routes/messages')(db, io, connectedUsers));
app.use('/api/groups', require('./routes/groups')(db, io, connectedUsers));

// SPA fallback — must be after API routes
app.get('*', (req, res) => {
  res.sendFile(require('path').join(clientDist, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ WeCom Server running on http://0.0.0.0:${PORT}`));
