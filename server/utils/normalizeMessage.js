/**
 * 统一将各种来源的语音数据转换为 VoiceMessage 格式
 * 兼容旧数据： { content: "data:audio/mp3;base64,..." }
 * 新格式：    { content: "/uploads/voice/xxx.mp3", duration: 5000 }
 */

function normalizeVoiceMessage(raw) {
  let { content, duration, extra = {} } = raw;

  // Unwrap JSON-encoded voice objects (forwarded messages arrive pre-serialised)
  if (typeof content === 'string' && content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.voiceUrl === 'string') {
        content = parsed.voiceUrl;
        if (!duration && parsed.durationMs) duration = parsed.durationMs;
      }
    } catch {}
  }

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
  // Extract reply_to_info from enriched SQL columns present on all message types
  const replyInfo = msg.reply_content != null ? {
    content: msg.reply_content,
    msg_type: msg.reply_msg_type || 'text',
    sender_name: msg.reply_sender_name || '',
  } : null;
  const base = {
    reply_to_info: replyInfo,
    reply_content: undefined,
    reply_msg_type: undefined,
    reply_sender_name: undefined,
  };

  if (msg.msg_type === 'voice') {
    let parsed = {};
    try { parsed = JSON.parse(msg.content); } catch { parsed = { content: msg.content }; }
    return {
      ...msg,
      ...base,
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
      ...base,
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
      ...base,
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
    return { ...msg, ...base, type: 'card', ...parsed };
  }
  return { ...msg, ...base, type: msg.msg_type || 'text' };
}

module.exports = { normalizeVoiceMessage, formatMessage };
