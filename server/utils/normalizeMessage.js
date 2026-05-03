/**
 * 统一将各种来源的语音数据转换为 VoiceMessage 格式
 * 兼容旧数据： { content: "data:audio/mp3;base64,..." }
 * 新格式：    { content: "/uploads/voice/xxx.mp3", duration: 5000 }
 */

/**
 * HTML 转义 — 防止存储型 XSS
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  if (msg.msg_type === 'file') {
    let parsed = {};
    try { parsed = JSON.parse(msg.content); } catch { parsed = { fileUrl: msg.content, fileName: '文件' }; }
    return {
      ...msg,
      type: 'file',
      fileUrl: parsed.fileUrl || msg.content,
      fileName: parsed.fileName || '文件',
      fileSize: parsed.fileSize || 0,
      mimeType: parsed.mimeType || '',
      content: undefined,
    };
  }
  if (msg.msg_type === 'image') {
    let parsed = {};
    try { parsed = JSON.parse(msg.content); } catch { parsed = { imageUrl: msg.content }; }
    return {
      ...msg,
      type: 'image',
      imageUrl: parsed.imageUrl || msg.content,
      width: parsed.width || null,
      height: parsed.height || null,
      content: undefined,
    };
  }
  if (msg.msg_type === 'card') {
    let parsed = {};
    try { parsed = JSON.parse(msg.content); } catch {}
    return { ...msg, type: 'card', ...parsed };
  }
  return { ...msg, type: msg.msg_type || 'text', content: escapeHtml(msg.content) };
}

module.exports = { normalizeVoiceMessage, formatMessage };
