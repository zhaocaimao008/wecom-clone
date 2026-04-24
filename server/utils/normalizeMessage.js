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
  if (msg.msg_type === 'card') {
    let parsed = {};
    try { parsed = JSON.parse(msg.content); } catch {}
    return { ...msg, type: 'card', ...parsed };
  }
  return { ...msg, type: msg.msg_type || 'text' };
}

module.exports = { normalizeVoiceMessage, formatMessage };
