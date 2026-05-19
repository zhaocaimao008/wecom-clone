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
const { pushToUser } = require('./utils/webPush');

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
  },
  maxHttpBufferSize: 2e6, // 2MB per socket.io frame
});

if (CORS_ORIGINS.length > 0) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
} else {
  // No origin list configured — same-origin only (no CORS headers)
  app.use(cors({ origin: false }));
}

app.use(express.json({ limit: '5mb' }));

// ── Health check ────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// Simple request logger for debugging
app.use((req, res, next) => {
  if (!req.path.startsWith('/assets/') && !req.path.startsWith('/uploads/')) {
    console.log(`[REQ] ${req.method} ${req.path} - ${req.ip}`);
  }
  next();
});

// ── Rate limiting ────────────────────────────────────────────────────
const msgLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '消息发送太快，请稍后再试' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作太频繁，请稍后再试' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/send-code', authLimiter);

// ── Client-side error reporting ──────────────────────────────────────
app.post('/api/client-error', (req, res) => {
  const { message, stack, component, ua, ts } = req.body || {};
  console.error('[CLIENT ERROR]', new Date(ts).toISOString(), message);
  if (stack) console.error('[CLIENT STACK]', stack);
  if (component) console.error('[CLIENT COMPONENT]', component);
  if (ua) console.error('[CLIENT UA]', ua);
  res.json({ ok: true });
});

// ── Static files ────────────────────────────────────────────────────
const clientDist = require('path').join(__dirname, '../client/dist');
// HTML: never cache; hashed JS/CSS: long-term cache is fine
app.use(require('express').static(clientDist, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    } else if (filePath.match(/\.(js|css)$/)) {
      // Content-hash filenames → safe to cache 1 year
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
app.use(express.static('public'));

// ── Client downloads ──────────────────────────────────────────────────
const { existsSync } = require('fs');
const DOWNLOADS = require('path').join(__dirname, 'downloads');

app.get('/api/download/windows', (req, res) => {
  const file = require('path').join(DOWNLOADS, '密信-Windows.tar.gz');
  existsSync(file) ? res.download(file, '密信-Windows.tar.gz') : res.status(404).json({ error: '安装包不存在' });
});

app.get('/api/download/android', (req, res) => {
  const file = require('path').join(DOWNLOADS, '密信.apk');
  existsSync(file) ? res.download(file, '密信.apk') : res.status(404).json({ error: 'APK 不存在' });
});

app.get('/api/download/ios', (req, res) => {
  res.status(404).json({ error: 'iOS 版本暂未发布，敬请期待' });
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

// Avatars are profile pictures — serve publicly so <img> tags work without Bearer auth
app.use('/uploads/avatars', express.static(require('path').join(__dirname, 'uploads/avatars')));
// All other uploads (voice messages, files) remain protected
app.use('/uploads', authUpload, express.static(require('path').join(__dirname, 'uploads')));

// ── QR Login sessions ────────────────────────────────────────────────
// qrToken → { status: 'pending'|'confirmed', expires, desktopToken?, user? }
const qrSessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of qrSessions) if (v.expires < now) qrSessions.delete(k);
}, 60 * 1000).unref();

// ── Socket.io ───────────────────────────────────────────────────────
const connectedUsers = new Map(); // userId (Number) → Set<socketId>
const sessionInfo    = new Map(); // socketId → { uid, connectedAt, userAgent }
const msgRateLimit = new Map();   // userId → { count, windowStart }

const MSG_RATE_WINDOW = 60 * 1000;  // 1 minute
const MSG_RATE_MAX    = 120;        // 120 messages per minute (2/sec)

// Lightweight generic rate limiter for socket mutation events (recall/delete/edit)
const mutationRateLimit = new Map();
const MUTATION_RATE_WINDOW = 60 * 1000;
const MUTATION_RATE_MAX    = 30;

function checkMutationRate(uid) {
  const now = Date.now();
  const entry = mutationRateLimit.get(uid);
  if (!entry || now - entry.windowStart > MUTATION_RATE_WINDOW) {
    mutationRateLimit.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MUTATION_RATE_MAX) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of mutationRateLimit) {
    if (now - entry.windowStart > MUTATION_RATE_WINDOW) mutationRateLimit.delete(uid);
  }
}, MUTATION_RATE_WINDOW * 2).unref();

function checkMsgRate(uid) {
  const now = Date.now();
  for (const [key, val] of msgRateLimit) {
    if (now - val.windowStart > MSG_RATE_WINDOW) msgRateLimit.delete(key);
  }
  const entry = msgRateLimit.get(uid);
  if (!entry || now - entry.windowStart > MSG_RATE_WINDOW) {
    msgRateLimit.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MSG_RATE_MAX) return false;
  entry.count++;
  return true;
}

// Periodically evict expired rate-limit entries to prevent unbounded Map growth
setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of msgRateLimit) {
    if (now - entry.windowStart > MSG_RATE_WINDOW) msgRateLimit.delete(uid);
  }
}, MSG_RATE_WINDOW * 2).unref();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    // Allow unauthenticated sockets for QR login polling
    socket.user = null;
    return next();
  }
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('auth'));
  }
});

// Notify only friends + shared-group members about status changes
function notifyUserStatus(uid, status) {
  const peers = db.prepare(`
    SELECT DISTINCT id FROM (
      SELECT contact_id as id FROM contacts WHERE user_id=?
      UNION
      SELECT gm2.user_id as id FROM group_members gm1
        JOIN group_members gm2 ON gm1.group_id=gm2.group_id
        WHERE gm1.user_id=? AND gm2.user_id!=?
    )
  `).all(uid, uid, uid);
  peers.forEach(p => emit(p.id, 'user_status', { userId: uid, status }));
}

// Join/leave a Socket.io group room for all sockets of a user
function joinGroupRoom(userId, gid) {
  const sockets = connectedUsers.get(Number(userId));
  if (sockets) sockets.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) s.join('group_' + gid);
  });
}
function leaveGroupRoom(userId, gid) {
  const sockets = connectedUsers.get(Number(userId));
  if (sockets) sockets.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) s.leave('group_' + gid);
  });
}

io.on('connection', (socket) => {
  // Unauthenticated sockets: only allowed to subscribe to QR login events
  if (!socket.user) {
    socket.on('qr_subscribe', ({ qrToken }) => {
      if (typeof qrToken !== 'string' || qrToken.length !== 32) return;
      const session = qrSessions.get(qrToken);
      if (!session || Date.now() > session.expires) return;
      socket.join(`qr:${qrToken}`);
    });
    return;
  }

  const uid = socket.user.id;

  if (!connectedUsers.has(uid)) connectedUsers.set(uid, new Set());
  connectedUsers.get(uid).add(socket.id);
  sessionInfo.set(socket.id, {
    uid,
    connectedAt: Date.now(),
    userAgent: socket.handshake.headers['user-agent'] || 'Unknown',
  });

  // Notify other devices of new session
  const deviceCount = connectedUsers.get(uid).size;
  if (deviceCount > 1) socket.emit('multi_device_notice', { count: deviceCount });

  // Join all group rooms this user belongs to
  db.prepare('SELECT group_id FROM group_members WHERE user_id=?').all(uid)
    .forEach(gm => socket.join('group_' + gm.group_id));

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', uid);
  notifyUserStatus(uid, 'online');

  // ── Send message ──────────────────────────────────────────────────
  socket.on('send_message', ({ receiverId, groupId, content, msgType = 'text', durationMs = 0, replyToId = null, clientMsgId = null }) => {
    try {
    // Socket send_message type whitelist
    const SOCKET_MSG_TYPES = ['text', 'voice', 'card', 'image', 'file'];
    if (!SOCKET_MSG_TYPES.includes(msgType)) return socket.emit('send_error', { message: '不支持的消息类型' });
    // image/file via socket must reference existing internal uploads (forward use case only)
    if (msgType === 'image' || msgType === 'file') {
      try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        const urlField = msgType === 'image' ? parsed.imageUrl : parsed.fileUrl;
        const allowed = msgType === 'image' ? '/uploads/images/' : '/uploads/files/';
        if (!urlField || !String(urlField).startsWith(allowed)) {
          return socket.emit('send_error', { message: '无效的文件路径' });
        }
      } catch {
        return socket.emit('send_error', { message: '无效的文件内容' });
      }
    }
    if (!content) return;
    if (msgType !== 'voice' && msgType !== 'card' && !content.trim()) return;
    if (msgType === 'text' && content.length > 10000) return;
    // Validate durationMs for voice messages
    if (msgType === 'voice') {
      durationMs = Number(durationMs);
      if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 3_600_000)
        durationMs = 0;
    }
    // Reject oversized payloads (voice base64 ~10MB limit)
    if (typeof content === 'string' && content.length > 15_000_000) return socket.emit('send_error', { message: '内容过大，无法发送' });
    // Validate receiverId / groupId as positive integers
    if (receiverId !== undefined && receiverId !== null) {
      receiverId = Number(receiverId);
      if (!Number.isInteger(receiverId) || receiverId <= 0) return socket.emit('send_error', { message: '无效的接收方' });
    }
    if (groupId !== undefined && groupId !== null) {
      groupId = Number(groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) return socket.emit('send_error', { message: '无效的群组' });
    }
    if (!receiverId && !groupId) return socket.emit('send_error', { message: '缺少接收方' });
    // Validate replyToId: must exist and belong to same conversation
    if (replyToId !== null && replyToId !== undefined) {
      replyToId = Number(replyToId);
      if (!Number.isInteger(replyToId) || replyToId <= 0) {
        replyToId = null;
      } else {
        const refMsg = db.prepare('SELECT id, receiver_id, group_id FROM messages WHERE id=? AND recalled=0').get(replyToId);
        if (!refMsg) {
          replyToId = null;
        } else if (groupId && Number(refMsg.group_id) !== groupId) {
          replyToId = null;
        } else if (receiverId && refMsg.receiver_id !== null && Number(refMsg.receiver_id) !== receiverId && Number(refMsg.receiver_id) !== uid) {
          replyToId = null;
        }
      }
    }
    // Validate card JSON
    if (msgType === 'card') {
      try {
        const c = typeof content === 'string' ? JSON.parse(content) : content;
        if (!c || typeof c !== 'object') throw new Error();
      } catch {
        return socket.emit('send_error', { message: '无效的卡片数据' });
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
        'SELECT role, muted_until FROM group_members WHERE group_id=? AND user_id=?'
      ).get(groupId, uid);
      if (!member) return socket.emit('send_error', { message: '你不在该群组中' });

      const grp = db.prepare('SELECT mute_all FROM chat_groups WHERE id=?').get(groupId);
      if (grp?.mute_all && member.role === 'member') {
        return socket.emit('send_error', { message: '全员禁言中，只有管理员可以发言' });
      }
      // Per-member mute check
      if (member.role === 'member' && member.muted_until != null) {
        if (member.muted_until === 0 || member.muted_until > Date.now()) {
          return socket.emit('send_error', { message: '你已被群主禁言' });
        }
      }
    }

    if (receiverId) {
      const areFriends = db.prepare(
        'SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)'
      ).get(uid, receiverId, receiverId, uid);
      if (!areFriends) return socket.emit('send_error', { message: '仅好友之间可以发送消息' });

      // Drop message if receiver has blocked the sender
      const isBlocked = db.prepare(
        'SELECT 1 FROM blocked_users WHERE user_id=? AND blocked_id=?'
      ).get(receiverId, uid);
      if (isBlocked) return; // silent drop — sender is not informed

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

    let result;
    try {
      result = db.prepare(
        'INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type, reply_to, client_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(uid, receiverId || null, groupId || null, storedContent, msgType, replyToId, clientMsgId || null);
    } catch (insertErr) {
      // UNIQUE constraint on (sender_id, client_msg_id) — duplicate submission
      if (clientMsgId && insertErr.message?.includes('UNIQUE')) {
        const dup = db.prepare('SELECT id FROM messages WHERE sender_id=? AND client_msg_id=?').get(uid, clientMsgId);
        if (dup) return socket.emit('message_confirmed', { clientMsgId, serverId: dup.id });
      }
      throw insertErr;
    }

    const sender = db.prepare('SELECT display_name, avatar_color FROM users WHERE id = ?').get(uid);

    // Enrich reply_to with parent message info for immediate display (no extra fetch needed)
    let replyToInfo = null;
    if (replyToId) {
      const refMsg = db.prepare('SELECT content, msg_type, sender_id FROM messages WHERE id=?').get(replyToId);
      if (refMsg) {
        const refSender = db.prepare('SELECT display_name FROM users WHERE id=?').get(refMsg.sender_id);
        replyToInfo = {
          content: refMsg.msg_type === 'text' ? refMsg.content : null,
          msg_type: refMsg.msg_type || 'text',
          sender_name: refSender?.display_name || '',
        };
      }
    }

    const base = {
      id: result.lastInsertRowid,
      sender_id: uid,
      sender_name: sender.display_name,
      sender_color: sender.avatar_color,
      receiver_id: receiverId || null,
      group_id: groupId || null,
      msg_type: msgType,
      recalled: 0,
      reply_to_id: replyToId,
      reply_to_info: replyToInfo,
      created_at: new Date().toISOString(),
      clientMsgId: clientMsgId || null,
    };

    const msg = msgType === 'voice'
      ? { ...base, type: 'voice', voiceUrl: voiceData.voiceUrl, durationMs: voiceData.durationMs }
      : msgType === 'card'
      ? { ...base, type: 'card', content: storedContent, ...(cardData || {}) }
      : { ...base, type: msgType || 'text', content: content.trim() };

    // Helper: build a short preview string for push notification body
    function msgPreview(type, rawContent) {
      if (type === 'image') return '[图片]';
      if (type === 'voice') return '[语音]';
      if (type === 'file') return '[文件]';
      if (type === 'card') return '[名片]';
      return (rawContent || '').trim().slice(0, 60);
    }

    if (receiverId) {
      emit(uid, 'new_message', msg);
      emit(receiverId, 'new_message', msg);

      // Push to offline receiver
      if (!connectedUsers.has(Number(receiverId))) {
        pushToUser(db, receiverId, {
          title: sender.display_name,
          body: msgPreview(msgType, content),
          convId: uid,
          convType: 'private',
        }).catch(() => {});
      }
    } else if (groupId) {
      io.to('group_' + groupId).emit('new_message', msg);

      // Push to offline group members (fire-and-forget, non-blocking)
      setImmediate(() => {
        try {
          const groupInfo = db.prepare('SELECT name FROM chat_groups WHERE id=?').get(groupId);
          const offlineMembers = db.prepare(
            'SELECT user_id FROM group_members WHERE group_id=? AND user_id!=?'
          ).all(groupId, uid).filter(m => !connectedUsers.has(Number(m.user_id)));
          const pushBody = `${sender.display_name}: ${msgPreview(msgType, content)}`;
          for (const m of offlineMembers) {
            pushToUser(db, m.user_id, {
              title: groupInfo?.name || '群消息',
              body: pushBody,
              convId: groupId,
              convType: 'group',
            }).catch(() => {});
          }
        } catch {}
      });

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

        const groupName = db.prepare('SELECT name FROM chat_groups WHERE id=?').get(groupId)?.name || '';
        for (const [, username] of mentionMatches) {
          const mentionedId = nameToId[username.toLowerCase()];
          if (mentionedId && Number(mentionedId) !== uid) {
            emit(mentionedId, 'mention', {
              mentionedBy: uid,
              senderName: sender.display_name,
              groupId,
              groupName,
              message: msg,
            });
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────
    }
    } catch (err) {
      console.error('send_message error:', err);
      socket.emit('send_error', { message: '服务器错误，消息发送失败' });
    }
  });

  // ── Recall message ────────────────────────────────────────────────
  socket.on('recall_message', ({ messageId }) => {
    try {
      if (!checkMutationRate(uid)) return socket.emit('error', { message: '操作太频繁，请稍后再试' });
      const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!msg) return socket.emit('error', { message: '消息不存在' });
      if (msg.recalled) return socket.emit('error', { message: '消息已撤回' });
      const isGroupAdmin = msg.group_id
        ? db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role IN ('owner','admin')").get(msg.group_id, uid)
        : null;
      const isSender = Number(msg.sender_id) === uid;
      if (!isSender && !isGroupAdmin) {
        return socket.emit('error', { message: '无权撤回此消息' });
      }
      // 普通用户只能撤回 2 分钟内的消息；管理员不受限
      if (isSender && !isGroupAdmin) {
        const age = Date.now() - new Date(msg.created_at).getTime();
        if (age > 2 * 60 * 1000) return socket.emit('error', { message: '超过 2 分钟，无法撤回' });
      }
      db.prepare('UPDATE messages SET recalled = 1 WHERE id = ?').run(messageId);
      const payload = { messageId, recallerId: uid };
      if (msg.receiver_id) {
        emit(uid, 'message_recalled', payload);
        emit(msg.receiver_id, 'message_recalled', payload);
      } else if (msg.group_id) {
        io.to('group_' + msg.group_id).emit('message_recalled', payload);
      }
    } catch (err) { console.error('recall_message error:', err); }
  });

  // ── Delete message for all (bidirectional, no time limit) ─────────
  socket.on('delete_message', ({ messageId }) => {
    try {
      if (!checkMutationRate(uid)) return socket.emit('error', { message: '操作太频繁，请稍后再试' });
      const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
      if (!msg) return socket.emit('error', { message: '消息不存在或无权删除' });
      db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      const payload = { messageId };
      if (msg.receiver_id) {
        emit(uid, 'message_deleted', payload);
        emit(msg.receiver_id, 'message_deleted', payload);
      } else if (msg.group_id) {
        io.to('group_' + msg.group_id).emit('message_deleted', payload);
      }
    } catch (err) { console.error('delete_message error:', err); }
  });

  socket.on('edit_message', ({ messageId, content }) => {
    try {
      if (!checkMutationRate(uid)) return socket.emit('error', { message: '操作太频繁，请稍后再试' });
      const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
      if (!msg) return socket.emit('error', { message: '消息不存在或无权编辑' });
      if (msg.msg_type !== 'text') return socket.emit('error', { message: '只能编辑文字消息' });
      if (msg.recalled) return socket.emit('error', { message: '已撤回的消息不能编辑' });
      const newContent = (content || '').trim();
      if (!newContent) return socket.emit('error', { message: '消息内容不能为空' });
      if (newContent.length > 10000) return socket.emit('error', { message: '消息内容过长' });
      db.transaction(() => {
        db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(newContent, messageId);
      })();
      const payload = { messageId, content: newContent };
      if (msg.receiver_id) {
        emit(uid, 'message_edited', payload);
        emit(msg.receiver_id, 'message_edited', payload);
      } else if (msg.group_id) {
        io.to('group_' + msg.group_id).emit('message_edited', payload);
      }
    } catch (err) { console.error('edit_message error:', err); }
  });

  // ── Typing indicator ──────────────────────────────────────────────
  socket.on('typing', ({ receiverId, groupId, isTyping }) => {
    try {
      if (receiverId) {
        const areFriends = db.prepare(
          'SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)'
        ).get(uid, receiverId, receiverId, uid);
        if (!areFriends) return;
        emit(receiverId, 'typing', { userId: uid, isTyping });
      }
    } catch (err) { console.error('typing error:', err); }
  });

  // ── Read receipts ─────────────────────────────────────────────────
  socket.on('mark_read', ({ messageId }) => {
    try {
      if (!messageId) return;
      const msg = db.prepare('SELECT sender_id, receiver_id, group_id, recalled FROM messages WHERE id=?').get(messageId);
      if (!msg || msg.recalled) return;
      if (msg.sender_id === uid) return;
      if (msg.group_id) {
        const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(msg.group_id, uid);
        if (!inGroup) return;
      } else if (msg.receiver_id !== uid) {
        return;
      }
      const readAt = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)').run(messageId, uid, readAt);
      if (msg.sender_id) {
        emit(msg.sender_id, 'message_read', { messageId, readerId: uid, readAt });
      }
    } catch (err) { console.error('mark_read error:', err); }
  });

  // ── WebRTC Signaling ──────────────────────────────────────────────
  socket.on('call_offer', ({ targetId, offer, callType }) => {
    try {
      const areFriends = db.prepare(
        'SELECT 1 FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)'
      ).get(uid, targetId, targetId, uid);
      if (!areFriends) return;
      const caller = db.prepare('SELECT display_name, avatar_color FROM users WHERE id=?').get(uid);
      if (!caller) return;
      emit(targetId, 'call_incoming', { callerId: uid, callerName: caller.display_name, callerColor: caller.avatar_color, offer, callType });
    } catch (err) { console.error('call_offer error:', err); }
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
    try {
      if (!messageId || !emoji || typeof emoji !== 'string') return;
      if ([...emoji].length > 4 || emoji.trim() === '') return;
      if (!checkMutationRate(uid)) return socket.emit('error', { message: '操作太频繁，请稍后再试' });
      const msgRow = db.prepare('SELECT group_id, sender_id, receiver_id FROM messages WHERE id=?').get(messageId);
      if (!msgRow) return;
      if (msgRow.group_id) {
        const member = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(msgRow.group_id, uid);
        if (!member) return;
      } else {
        if (Number(msgRow.sender_id) !== uid && Number(msgRow.receiver_id) !== uid) return;
      }
      const existing = db.prepare('SELECT id FROM message_reactions WHERE message_id=? AND emoji=? AND user_id=?').get(messageId, emoji, uid);
      if (existing) {
        db.prepare('DELETE FROM message_reactions WHERE id=?').run(existing.id);
      } else {
        db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, uid, emoji);
      }
      const userIds = db.prepare('SELECT user_id FROM message_reactions WHERE message_id=? AND emoji=?').all(messageId, emoji).map(r => r.user_id);
      const payload = { messageId, emoji, userIds };
      if (msgRow.group_id) {
        io.to('group_' + msgRow.group_id).emit('reaction_update', payload);
      } else {
        emit(Number(msgRow.sender_id), 'reaction_update', payload);
        if (msgRow.receiver_id && Number(msgRow.receiver_id) !== Number(msgRow.sender_id)) {
          emit(Number(msgRow.receiver_id), 'reaction_update', payload);
        }
      }
    } catch (err) { console.error('toggle_reaction error:', err); }
  });

  socket.on('call_busy', ({ targetId }) => {
    emit(targetId, 'call_busy', { userId: uid });
  });

  socket.on('disconnect', () => {
    try {
      sessionInfo.delete(socket.id);
      const sockets = connectedUsers.get(uid);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          connectedUsers.delete(uid);
          db.prepare('UPDATE users SET status = ? WHERE id = ?').run('offline', uid);
          notifyUserStatus(uid, 'offline');
        }
      }
    } catch (err) {
      console.error('disconnect handler error:', err);
    }
  });
});

// userId is always coerced to Number for Map lookups
function emit(userId, event, data) {
  const sockets = connectedUsers.get(Number(userId));
  if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
}

app.use('/api/auth', require('./routes/auth')(db, io, qrSessions, connectedUsers, sessionInfo));
app.use('/api/users', require('./routes/users')(db, io, connectedUsers));
app.use('/api/messages', require('./routes/messages')(db, io, connectedUsers));
app.use('/api/groups', require('./routes/groups')(db, io, connectedUsers, joinGroupRoom, leaveGroupRoom));
app.use('/api/push', require('./routes/push')(db));
app.use('/api/keys', require('./routes/keys')(db));

// 404 for unknown API routes (must be before SPA fallback)
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// SPA fallback — must be after API routes
app.get('*', (req, res) => {
  res.sendFile(require('path').join(clientDist, 'index.html'));
});

// Global Express error handler — catches sync errors thrown in route handlers
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return;
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: '请求内容过大' });
  }
  console.error('Unhandled route error:', err);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ 密信 Server running on http://0.0.0.0:${PORT}`));
