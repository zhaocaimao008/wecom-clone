'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { normalizeVoiceMessage } = require('./utils/normalizeMessage');

// ── Env checks ──────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
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

// ── Rate limiting ────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作太频繁，请稍后再试' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Static files ────────────────────────────────────────────────────
const clientDist = require('path').join(__dirname, '../client/dist');
app.use(require('express').static(clientDist));
app.use(express.static('public'));
app.use('/uploads', require('express').static(require('path').join(__dirname, 'uploads')));
app.use('/uploads/avatars', require('express').static(require('path').join(__dirname, 'uploads/avatars')));

// ── Socket.io ───────────────────────────────────────────────────────
const connectedUsers = new Map(); // userId (Number) → Set<socketId>

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
  socket.on('send_message', ({ receiverId, groupId, content, msgType = 'text', durationMs = 0 }) => {
    if (!content) return;
    if (msgType !== 'voice' && msgType !== 'card' && !content.trim()) return;

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
      'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, receiverId || null, groupId || null, storedContent, msgType);

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
      created_at: new Date().toISOString(),
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
    }
  });

  // ── Recall message ────────────────────────────────────────────────
  socket.on('recall_message', ({ messageId }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
    if (!msg) return;   // ← was missing: safe-guard against undefined
    const diffSec = (Date.now() - new Date(msg.created_at).getTime()) / 1000;
    if (diffSec > 120) return socket.emit('error', { message: '超过2分钟，无法撤回' });

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

  // ── Typing indicator ──────────────────────────────────────────────
  socket.on('typing', ({ receiverId, groupId, isTyping }) => {
    const payload = { userId: uid, isTyping };
    if (receiverId) emit(receiverId, 'typing', payload);
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
app.use('/api/messages', require('./routes/messages')(db));
app.use('/api/groups', require('./routes/groups')(db, io, connectedUsers));

// SPA fallback — must be after API routes
app.get('*', (req, res) => {
  res.sendFile(require('path').join(clientDist, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ WeCom Server running on http://0.0.0.0:${PORT}`));
