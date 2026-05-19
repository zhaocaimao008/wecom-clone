# 语音消息统一重构方案

## 目标
统一消息格式，`msg_type=voice` 的消息统一转化为 `{ type: 'voice', voiceUrl, durationMs }` 接口。

---

## 1. TypeScript Interface（前端）

文件：`client/src/types/message.ts`（新建）

```typescript
export interface BaseMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_color: string;
  receiver_id?: number;
  group_id?: number;
  recalled: 0 | 1;
  created_at: string;
}

export interface TextMessage extends BaseMessage {
  type: 'text';
  content: string;
}

export interface VoiceMessage extends BaseMessage {
  type: 'voice';
  voiceUrl: string;    // 音频 URL 或 base64
  durationMs: number;  // 时长，毫秒
}

export type Message = TextMessage | VoiceMessage;
```

---

## 2. 后端适配函数

文件：`server/utils/normalizeMessage.js`（新建）

```javascript
/**
 * 统一将各种来源的语音数据转换为 VoiceMessage 格式
 * 兼容旧数据： { content: "data:audio/mp3;base64,..." }
 * 新格式：    { content: "/uploads/voice/xxx.mp3", duration: 5000 }
 */
function normalizeVoiceMessage(raw) {
  const { content, duration, extra = {} } = raw;

  if (typeof content === 'string' && content.startsWith('data:')) {
    const match = content.match(/data:audio\/(\w+);base64,(.+)/);
    return {
      type: 'voice',
      voiceUrl: content,
      durationMs: duration ?? extra.durationMs ?? 0,
      format: match?.[1] ?? 'unknown',
      isBase64: true,
    };
  }

  return {
    type: 'voice',
    voiceUrl: content,
    durationMs: duration ?? extra.durationMs ?? 0,
    isBase64: false,
  };
}

/**
 * 格式化数据库消息记录，转换为统一前端格式
 */
function formatMessage(msg) {
  if (msg.msg_type === 'voice') {
    let parsed = {};
    try { parsed = JSON.parse(msg.content); } catch { parsed = { content: msg.content }; }
    return {
      ...msg,
      type: 'voice',
      voiceUrl: parsed.voiceUrl || parsed.content || msg.content,
      durationMs: parsed.durationMs || parsed.duration || 0,
      content: undefined,
    };
  }
  return { ...msg, type: msg.msg_type || 'text' };
}

module.exports = { normalizeVoiceMessage, formatMessage };
```

---

## 3. 修改清单

| 文件 | 行号 | 修改内容 |
|------|------|---------|
| `server/utils/normalizeMessage.js` | 新建 | 插入上方两个函数 |
| `server/routes/messages.js` | GET 历史消息 | 头部加 `const { formatMessage } = require('../utils/normalizeMessage');`，返回前 map `rows.map(formatMessage)` |
| `server/index.js` | `send_message` handler | `msgType === 'voice'` 时调用 `insertVoiceMessage()` |
| `server/db.js` | messages 表定义 | 加 CHECK 约束：`CHECK (msg_type IN ('text', 'voice', 'image', 'file'))` |
| `server/db.js` | message_reads 表定义 | 加 `ON DELETE CASCADE` |
| `client/src/types/message.ts` | 新建 | 插入上方 TypeScript interfaces |
| `client/src/store/useStore.js` | messages 状态 | 类型标注改为 `Message[]` |
| `client/src/components/ChatWindow.jsx` | 消息渲染 | 新增 `else if ((msg as any).type === 'voice')` 分支渲染语音 |
| `client/src/components/ChatPanel.jsx` | 录音上传 | 录音完成 POST `/api/messages/voice`，body 传 `voiceUrl + durationMs` |
| `client/src/socket.js` | `new_message` handler | 增加 `type === 'voice'` 处理 |

### 路由新增（可选）

`server/routes/messages.js` 新增路由：

```javascript
// 上传语音消息
router.post('/voice', (req, res) => {
  const { voiceUrl, durationMs, receiverId, groupId } = req.body;
  // 调用 insertVoiceMessage(db, io, { ... })
});
```

---

## 4. Lint 修正

### 问题1：message_reads 无级联删除

```javascript
// server/db.js — message_reads 表修正
db.exec(`
  CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
`);
```

### 问题2：messages 表无 msg_type 约束

```javascript
// server/db.js — messages 表修正
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    ...
    msg_type TEXT DEFAULT 'text'
      CHECK (msg_type IN ('text', 'voice', 'image', 'file'))
  );
`);
```

### 问题3：历史消息未做格式转换

```javascript
// server/routes/messages.js — GET 路由统一加 formatMessage
const messages = rows.map(formatMessage);
res.json(messages);
```

### 问题4：前端语音消息无渲染分支

```jsx
// client/src/components/ChatWindow.jsx — 语音渲染
{(msg as any).type === 'voice' && (
  <div className="voice-message" onClick={() => playVoice(msg.voiceUrl)}>
    <span className="voice-icon">🎤</span>
    <div className="voice-wave">〰️〰️〰️</div>
    <span className="voice-duration">{Math.floor(msg.durationMs / 1000)}"</span>
  </div>
)}
```

---

## 5. 数据库升级 SQL

```sql
-- 加 msg_type 约束（如表已存在）
-- better-sqlite3 不支持 ADD CONSTRAINT，换用触发器或应用层校验

-- 已有 voice 类型消息的 content 是 JSON，需迁移：
UPDATE messages
SET content = (
  SELECT json_object(
    'voiceUrl', content,
    'durationMs', 0
  )
  WHERE msg_type = 'voice' AND content NOT LIKE '%voiceUrl%'
);
```

