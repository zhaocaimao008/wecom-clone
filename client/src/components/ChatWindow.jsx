import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket';
import { AvatarCircle } from './Sidebar';
import GroupManagePanel from './GroupManagePanel';
import { useCall } from './CallScreen';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
dayjs.extend(isToday);
dayjs.extend(isYesterday);

const EMOJIS = ['😀','😂','🥰','😎','🤔','😅','🙏','👍','👎','❤️','🔥','✅','⚠️','🎉','💯','🚀','😭','🤣','😊','🎊','💪','👏','🌟','💡'];

export default function ChatWindow() {
  const { activeConv, messages, currentUser, token, typingUsers, groups, clearActiveConv, contacts, readReceipts } = useStore();
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showCallOptions, setShowCallOptions] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [members, setMembers] = useState([]);
  // ── @mention state ────────────────────────────────────────────────
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionFilter, setMentionFilter] = useState([]);
  // ── Reply-to state ────────────────────────────────────────────────
  const [replyingTo, setReplyingTo] = useState(null);
  // ── Reactions state (messageId -> {emoji -> [userId]}) ────────────
  const [reactions, setReactions] = useState({});
  const bottomRef = useRef(null);
  const msgAreaRef = useRef(null);
  const inputRef = useRef(null);
  const imageUploadRef = useRef(null);
  const fileUploadRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cameraUploadRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordTimerRef = useRef(null);
  const socket = getSocket();

  function scrollToBottom() {
    const el = msgAreaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    if (!socket || !currentUser) return;
    messages.forEach(msg => {
      if (msg.sender_id !== currentUser.id && msg.id) {
        socket.emit('mark_read', { messageId: msg.id });
      }
    });
  }, [messages]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => { setTimeout(scrollToBottom, 50); };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setInput(''); setShowEmoji(false); setShowMore(false); setShowCallOptions(false); setShowManage(false); setVoiceMode(false);
    setShowMentionPicker(false); setMentionSearch(''); setMentionFilter([]);
    setReplyingTo(null); setHasMore(true); setLoadingMore(false);
    if (activeConv?.type === 'group') loadMembers(activeConv.id);
  }, [activeConv?.id]);

  function loadMembers(gid) {
    fetch(`/api/users/groups/${gid}/members`, {
      headers: { Authorization: `Bearer ${useStore.getState().token}` }
    }).then(r => r.json()).then(setMembers);
  }

  function closeAll() { setShowEmoji(false); setShowMore(false); setShowCallOptions(false); setShowMentionPicker(false); }

  const sendMessage = useCallback(() => {
    if (!input.trim() || !socket) return;
    const payload = activeConv.type === 'private'
      ? { receiverId: activeConv.id, content: input.trim() }
      : { groupId: activeConv.id, content: input.trim() };
    if (replyingTo) { payload.replyToId = replyingTo.id; setReplyingTo(null); }
    socket.emit('send_message', payload);
    setInput(''); setShowEmoji(false); setShowMore(false);
  }, [input, activeConv, socket, replyingTo]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleInputChange(e) {
    const val = e.target.value;
    setInput(val);
    if (socket && activeConv?.type === 'private')
      socket.emit('typing', { receiverId: activeConv.id, isTyping: true });

    // ── @mention detection ─────────────────────────────────────────
    if (activeConv?.type === 'group') {
      const atIdx = val.lastIndexOf('@');
      if (atIdx !== -1 && (atIdx === 0 || /\s/.test(val[atIdx - 1]))) {
        const afterAt = val.slice(atIdx + 1);
        if (!afterAt.includes(' ')) {
          const search = afterAt.toLowerCase();
          setMentionSearch(search);
          setMentionFilter(members.filter(m => !search || m.display_name?.toLowerCase().includes(search)));
          setShowMentionPicker(true);
        } else {
          setShowMentionPicker(false);
        }
      } else {
        setShowMentionPicker(false);
      }
    }
  }

  function insertMention(member) {
    const atIdx = input.lastIndexOf('@');
    const before = input.slice(0, atIdx);
    const after = input.slice(atIdx).replace(/@[^ ]*/, '');
    setInput((before + '@' + member.display_name + ' ' + after).trim());
    setShowMentionPicker(false);
    inputRef.current?.focus();
  }

  function recallMsg(msgId) { socket?.emit('recall_message', { messageId: msgId }); }
  function deleteMsg(msgId) { socket?.emit('delete_message', { messageId: msgId }); }

  // ── Reactions ──────────────────────────────────────────────────────
  function toggleReaction(msgId, emoji) {
    const userId = currentUser?.id;
    if (!userId || !socket) return;
    socket.emit('toggle_reaction', { messageId: msgId, emoji });
    setReactions(prev => {
      const msgReactions = prev[msgId] || {};
      const emojiUsers = msgReactions[emoji] || [];
      const hasReacted = emojiUsers.includes(userId);
      const updated = {
        ...msgReactions,
        [emoji]: hasReacted ? emojiUsers.filter(id => id !== userId) : [...emojiUsers, userId]
      };
      if (updated[emoji].length === 0) delete updated[emoji];
      return { ...prev, [msgId]: updated };
    });
  }

  function openReply(msg) { setReplyingTo(msg); inputRef.current?.focus(); }
  function closeReply() { setReplyingTo(null); }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        const dur = recordMs;
        clearInterval(recordTimerRef.current);
        setRecordMs(0); setRecording(false);
        await uploadVoice(blob, dur);
      };
      mr.start(); setRecording(true); setRecordMs(0);
      recordTimerRef.current = setInterval(() => setRecordMs(ms => ms + 100), 100);
    } catch { alert('无法访问麦克风'); }
  }

  function stopRecording() { mediaRecorderRef.current?.stop(); }

  async function uploadVoice(blob, durationMs) {
    const token = useStore.getState().token;
    const form = new FormData();
    form.append('audio', blob, `voice-${Date.now()}.webm`);
    form.append('durationMs', durationMs);
    if (activeConv.type === 'private') form.append('receiverId', activeConv.id);
    else form.append('groupId', activeConv.id);
    try {
      const res = await fetch('/api/messages/voice', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const msg = await res.json();
      if (res.ok) {
        useStore.getState().addMessage({ ...msg, type: 'voice' });
      }
    } catch { alert('语音上传失败'); }
  }

  async function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('image', file);
    if (activeConv.type === 'private') form.append('receiverId', activeConv.id);
    else form.append('groupId', activeConv.id);
    try {
      const res = await fetch('/api/messages/image', { method: 'POST', headers: { Authorization: `Bearer ${useStore.getState().token}` }, body: form });
      const msg = await res.json();
      if (res.ok) { useStore.getState().addMessage({ ...msg, type: 'image' }); }
    } catch { alert('图片上传失败'); }
    e.target.value = '';
  }

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    if (activeConv.type === 'private') form.append('receiverId', activeConv.id);
    else form.append('groupId', activeConv.id);
    try {
      const res = await fetch('/api/messages/file', {
        method: 'POST',
        headers: { Authorization: `Bearer ${useStore.getState().token}` },
        body: form,
      });
      const msg = await res.json();
      if (res.ok) useStore.getState().addMessage({ ...msg, type: 'file' });
      else alert(msg.error || '文件发送失败');
    } catch { alert('文件发送失败'); }
    setUploading(false);
    e.target.value = '';
  }

  async function handleScroll(e) {
    if (loadingMore || !hasMore) return;
    if (e.target.scrollTop < 60) {
      setLoadingMore(true);
      const prevHeight = msgAreaRef.current.scrollHeight;
      const got = await useStore.getState().loadMoreMessages();
      if (!got) setHasMore(false);
      requestAnimationFrame(() => {
        if (msgAreaRef.current)
          msgAreaRef.current.scrollTop = msgAreaRef.current.scrollHeight - prevHeight;
      });
      setLoadingMore(false);
    }
  }

  function sendCard(user) {
    if (!socket || !activeConv) return;
    const cardJson = JSON.stringify({
      userId: user.id, name: user.display_name,
      department: user.department, position: user.position, color: user.avatar_color,
    });
    const payload = activeConv.type === 'private'
      ? { receiverId: activeConv.id, content: cardJson, msgType: 'card' }
      : { groupId: activeConv.id, content: cardJson, msgType: 'card' };
    socket.emit('send_message', payload);
    setShowCardPicker(false); setShowMore(false);
  }

  const startCall = useCall();
  const isTyping = activeConv?.type === 'private' && typingUsers.has(activeConv.id);
  const groupInfo = activeConv?.type === 'group' ? groups.find(g => g.id === activeConv.id) : null;
  const myGroupRole = members.find(m => m.id === currentUser?.id)?.role;
  const isMuted = groupInfo?.mute_all && myGroupRole === 'member';
  const sendError = useStore(s => s.sendError);

  return (
    <div className="chat-window" onClick={closeAll}>
      {/* ── Header ── */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={e => { e.stopPropagation(); clearActiveConv(); }}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
          <span className="chat-back-label">返回</span>
        </button>
        <div className="chat-header-title">
          <span className="chat-name">{activeConv?.name}</span>
          {activeConv?.type === 'group' && groupInfo && (
            <span className="chat-member-count">{groupInfo.member_count}人</span>
          )}
        </div>
        <div className="chat-header-actions">
          {activeConv?.type === 'private' && (
            <>
              <button className="icon-btn" title="语音通话"
                onClick={() => startCall(activeConv.id, activeConv.name, activeConv.avatarColor, 'audio')}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z"/></svg>
              </button>
              <button className="icon-btn" title="视频通话"
                onClick={() => startCall(activeConv.id, activeConv.name, activeConv.avatarColor, 'video')}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              </button>
            </>
          )}
          {activeConv?.type === 'group' && (
            <button className="icon-btn" title="群详情"
              onClick={e => { e.stopPropagation(); setShowManage(v => !v); }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Group Manage Modal ── */}
      {showManage && activeConv?.type === 'group' && (
        <div className="modal-overlay" onClick={() => setShowManage(false)}>
          <div className="modal-box" style={{ width: 440, maxHeight: '82vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <GroupManagePanel
              groupId={activeConv.id}
              members={members}
              onClose={() => setShowManage(false)}
              onMembersChanged={() => loadMembers(activeConv.id)}
            />
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="messages-area" ref={msgAreaRef} onClick={closeAll} onScroll={handleScroll}>
        {loadingMore && <div className="load-more-tip">加载中…</div>}
        {!hasMore && messages.length > 0 && <div className="load-more-tip">已加载全部消息</div>}
        {messages.map((msg, i) => {
          const isMine = msg.sender_id === currentUser?.id;
          const prevMsg = messages[i - 1];
          const showDate = !prevMsg || !dayjs(msg.created_at).isSame(dayjs(prevMsg.created_at), 'day');
          const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id || showDate);
          return (
            <React.Fragment key={msg.id}>
              {showDate && <div className="date-separator"><span>{formatDate(msg.created_at)}</span></div>}
              {msg.recalled
                ? <div className="recalled-msg">{isMine ? '你' : msg.sender_name} 撤回了一条消息</div>
                : <MessageBubble msg={msg} isMine={isMine} showAvatar={showAvatar} onRecall={recallMsg}
                    onDelete={deleteMsg}
                    onReply={() => openReply(msg)} onReact={(emoji) => toggleReaction(msg.id, emoji)}
                    reactions={reactions[msg.id] || {}} currentUserId={currentUser?.id}
                    messages={messages} readReceipts={readReceipts}
                    isPrivate={activeConv?.type === 'private'}
                    myGroupRole={myGroupRole}
                  />
              }
            </React.Fragment>
          );
        })}
        {isTyping && (
          <div className="typing-indicator">
            <span>{activeConv?.name}正在输入</span>
            <span className="typing-dots"><span/><span/><span/></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {sendError && <div className="send-error-toast">{sendError}</div>}

      {/* ── WeChat-style Input ── */}
      <div className={`wx-input-wrap ${isMuted ? 'input-muted' : ''}`} onClick={e => e.stopPropagation()}>
        {isMuted && (
          <div className="mute-banner">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            全员禁言中，仅群主和管理员可发言
          </div>
        )}

        {/* ── Reply-to quote ── */}
        {replyingTo && (
          <div className="reply-quote">
            <div className="reply-quote-content">
              <span className="reply-quote-name">{replyingTo.sender_name}: </span>
              <span className="reply-quote-text">
                {replyingTo.type === 'voice' ? '🎤 语音消息' :
                 replyingTo.type === 'image' ? '🖼️ 图片' :
                 replyingTo.type === 'card' ? '📇 名片' :
                 replyingTo.type === 'file' ? '📎 文件' :
                 (replyingTo.content || '').slice(0, 60)}
              </span>
            </div>
            <button className="reply-quote-close" onClick={closeReply}>✕</button>
          </div>
        )}

        {/* ── @mention picker ── */}
        {showMentionPicker && activeConv?.type === 'group' && (
          <div className="mention-picker">
            <div className="mention-picker-header">选择要@的成员</div>
            <div className="mention-picker-list">
              {mentionFilter.length === 0 ? (
                <div className="mention-picker-empty">没有匹配的成员</div>
              ) : mentionFilter.map(m => (
                <div key={m.id} className="mention-picker-item" onClick={() => insertMention(m)}>
                  <AvatarCircle name={m.display_name} color={m.avatar_color} size={28} radius={14} />
                  <span>{m.display_name}</span>
                  <span className="mention-picker-dept">{m.department}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="wx-input-row">
          {/* Voice / keyboard toggle */}
          <button className="wx-ic-btn" disabled={isMuted}
            onClick={() => { setVoiceMode(v => !v); setShowEmoji(false); setShowMore(false); }}>
            {voiceMode
              ? <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M20 5H4v2h16V5zm0 4H4v2h16V9zm-7 4H4v2h9v-2z"/></svg>
              : <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            }
          </button>

          {voiceMode
            ? <button
                className={`wx-hold-talk ${recording ? 'recording' : ''}`}
                onMouseDown={!recording ? startRecording : undefined}
                onMouseUp={recording ? stopRecording : undefined}
                onTouchStart={!recording ? startRecording : undefined}
                onTouchEnd={recording ? stopRecording : undefined}
                disabled={isMuted}
              >
                {recording ? `松开发送 · ${(recordMs / 1000).toFixed(1)}s` : '按住 说话'}
              </button>
            : <textarea
                ref={inputRef}
                className="wx-textarea"
                placeholder={isMuted ? '已被禁言' : `发消息`}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => setTimeout(scrollToBottom, 300)}
                rows={1}
                disabled={isMuted}
              />
          }

          {/* Emoji */}
          <button className="wx-ic-btn" disabled={isMuted}
            onClick={e => { e.stopPropagation(); setShowEmoji(v => !v); setShowMore(false); }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
          </button>

          {/* Send or + */}
          {input.trim() && !isMuted
            ? <button className="wx-send-btn" onClick={sendMessage}>发送</button>
            : <button className="wx-ic-btn wx-plus-btn" disabled={isMuted}
                onClick={e => { e.stopPropagation(); setShowMore(v => !v); setShowEmoji(false); }}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              </button>
          }
        </div>

        {/* Emoji picker */}
        {showEmoji && (
          <div className="emoji-picker">
            {EMOJIS.map(e => (
              <button key={e} onClick={() => { setInput(i => i + e); inputRef.current?.focus(); }}>{e}</button>
            ))}
          </div>
        )}

        {/* Hidden inputs */}
        <input ref={imageUploadRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
        <input ref={cameraUploadRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleImageSelect} />
        <input ref={fileUploadRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.json,image/*,video/*" style={{ display: 'none' }} onChange={handleFileSelect} />

        {/* More panel */}
        {showMore && (
          <div className="wx-more-panel" onClick={e => e.stopPropagation()}>
            <button className="wx-more-item" onClick={() => imageUploadRef.current?.click()}>
              <span className="wx-more-icon" style={{ background: '#1989FA' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
              </span>
              <span>相册</span>
            </button>
            <button className="wx-more-item" onClick={() => cameraUploadRef.current?.click()}>
              <span className="wx-more-icon" style={{ background: '#07c160' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M20 5h-3.17L15 3H9L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z"/></svg>
              </span>
              <span>拍摄</span>
            </button>
            <button className="wx-more-item" onClick={() => fileUploadRef.current?.click()}>
              <span className="wx-more-icon" style={{ background: '#10aec2' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
              </span>
              <span>文件</span>
            </button>
            <button className="wx-more-item" onClick={e => { e.stopPropagation(); setShowCallOptions(v => !v); }}>
              <span className="wx-more-icon" style={{ background: '#FA8C16' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              </span>
              <span>视频通话</span>
            </button>
            <button className="wx-more-item" onClick={() => { setShowMore(false); setShowCardPicker(true); }}>
              <span className="wx-more-icon" style={{ background: '#722ED1' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </span>
              <span>分享名片</span>
            </button>
          </div>
        )}

        {/* Call sub-options */}
        {showMore && showCallOptions && activeConv?.type === 'private' && (
          <div className="wx-call-options" onClick={e => e.stopPropagation()}>
            <button className="wx-call-opt-btn" onClick={() => {
              startCall(activeConv.id, activeConv.name, activeConv.avatarColor, 'video');
              setShowMore(false); setShowCallOptions(false);
            }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              视频通话
            </button>
            <button className="wx-call-opt-btn" onClick={() => {
              startCall(activeConv.id, activeConv.name, activeConv.avatarColor, 'audio');
              setShowMore(false); setShowCallOptions(false);
            }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z"/></svg>
              语音通话
            </button>
          </div>
        )}
      </div>

      {/* Card picker modal */}
      {showCardPicker && (
        <CardPickerModal
          contacts={contacts}
          onClose={() => setShowCardPicker(false)}
          onSelect={sendCard}
        />
      )}
    </div>
  );
}

/* ── Card Picker Modal ── */
function CardPickerModal({ contacts, onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const filtered = contacts.filter(c =>
    !search || c.display_name?.includes(search) || c.department?.includes(search)
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 360 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>选择名片</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <input className="modal-input" placeholder="搜索联系人"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 10 }} autoFocus />
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {filtered.map(u => (
              <div key={u.id} className="add-result-row" style={{ cursor: 'pointer' }}
                onClick={() => onSelect(u)}>
                <AvatarCircle name={u.display_name} color={u.avatar_color} size={42} radius={21} />
                <div className="add-result-info">
                  <span className="add-result-name">{u.display_name}</span>
                  <span className="add-result-sub">{u.department} · {u.position}</span>
                </div>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                </svg>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>没有联系人</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── useAuthUrl: fetch a protected /uploads/... URL with JWT, return a blob objectURL ── */
function useAuthUrl(url) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!url) return;
    if (url.startsWith('data:') || url.startsWith('blob:')) { setSrc(url); return; }
    const token = useStore.getState().token;
    let objectUrl = null;
    let cancelled = false;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return src;
}

/* ── Voice Player ── */
function VoicePlayer({ msg, isMine }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const blobUrl = useAuthUrl(msg.voiceUrl);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const durationSec = Math.max(1, Math.floor((msg.durationMs || 0) / 1000));

  useEffect(() => () => {
    audioRef.current?.pause();
    clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(false);
    setElapsed(0);
    clearInterval(timerRef.current);
  }, [blobUrl]);

  function toggle() {
    if (!blobUrl) return;
    if (playing) {
      audioRef.current?.pause();
      clearInterval(timerRef.current);
      setPlaying(false);
    } else {
      if (!audioRef.current) {
        audioRef.current = new Audio(blobUrl);
        audioRef.current.onended = () => {
          setPlaying(false);
          setElapsed(0);
          clearInterval(timerRef.current);
        };
      }
      audioRef.current.currentTime = 0;
      setElapsed(0);
      audioRef.current.play().catch(() => {});
      setPlaying(true);
      if (!isMine) getSocket()?.emit('mark_read', { messageId: msg.id });
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
  }

  const displaySec = playing ? Math.max(0, durationSec - elapsed) : durationSec;
  const barHeights = [3, 5, 8, 5, 9, 6, 4, 7, 3];

  return (
    <div className={`voice-player ${playing ? 'playing' : ''}`}
      onClick={toggle}
      style={!blobUrl ? { opacity: 0.6, cursor: 'default' } : {}}>
      <div className="voice-play-btn">
        {playing
          ? <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          : <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        }
      </div>
      <div className="voice-bars">
        {barHeights.map((h, i) => (
          <span key={i} className="voice-bar" style={{ '--h': `${h}px`, animationDelay: `${i * 0.07}s` }} />
        ))}
      </div>
      <span className="voice-duration">{displaySec}"</span>
    </div>
  );
}

/* ── Message Bubble ── */

async function downloadWithAuth(url, filename) {
  const token = useStore.getState().token;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || '文件';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch {}
}

function MessageBubble({ msg, isMine, showAvatar, onRecall, onDelete, onReply, onReact, reactions, currentUserId, messages, readReceipts, isPrivate, myGroupRole }) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const menuRef = useRef(null);
  const canRecall = isMine && (Date.now() - new Date(msg.created_at).getTime()) < 300000;
  const isVoice = msg.type === 'voice';
  const isCard = msg.type === 'card';
  const isFile = msg.type === 'file';
  const isImage = msg.type === 'image';

  useEffect(() => {
    const handler = e => { if (!menuRef.current?.contains(e.target)) { setShowMenu(false); setShowReactions(false); } };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  let cardData = null;
  if (isCard) {
    try {
      cardData = msg.name ? msg : (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg);
    } catch {}
  }

  let fileData = null;
  // formatMessage already extracts fileUrl/fileName onto msg; fall back to JSON parse for legacy
  if (isFile) {
    try { fileData = msg.fileUrl ? msg : (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg); } catch {}
  }
  // formatMessage already extracts imageUrl onto msg; fall back to JSON parse for legacy
  let imageData = null;
  if (isImage) {
    try { imageData = msg.imageUrl ? msg : (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg); } catch {}
  }
  const imageSrc = useAuthUrl(imageData?.imageUrl || null);

  // Find replied message
  const replyRef = msg.reply_to_id ?? msg.reply_to;
  const replyToMsg = replyRef ? messages.find(m => m.id === replyRef) : null;

  const reactionEntries = Object.entries(reactions || {}).filter(([, users]) => users.length > 0);

  return (
    <div className={`msg-row ${isMine ? 'mine' : 'theirs'}`}>
      {!isMine && (
        <div className="msg-avatar">
          {showAvatar && <AvatarCircle name={msg.sender_name} color={msg.sender_color} size={36} radius={18} />}
        </div>
      )}
      <div className="msg-body">
        {!isMine && showAvatar && <div className="msg-sender-name">{msg.sender_name}</div>}
        <div className="msg-content-wrap" onContextMenu={e => { e.preventDefault(); setShowMenu(true); }}>
          {/* Reply-to quote */}
          {replyToMsg && (
            <div className="msg-reply-quote">
              <span className="msg-reply-name">{replyToMsg.sender_name}: </span>
              <span className="msg-reply-text">
                {replyToMsg.type === 'voice' ? '🎤 语音' :
                 replyToMsg.type === 'image' ? '🖼️ 图片' :
                 replyToMsg.type === 'card' ? '📇 名片' :
                 replyToMsg.type === 'file' ? '📎 文件' :
                 (replyToMsg.content || '').slice(0, 40)}
              </span>
            </div>
          )}
          <div className={`msg-bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'} ${isCard ? 'bubble-card' : ''}`}>
            {isVoice && <VoicePlayer msg={msg} isMine={isMine} />}
            {isCard && cardData && (
              <div className="card-bubble">
                <div className="card-bubble-top">
                  <AvatarCircle name={cardData.name} color={cardData.color} size={44} radius={8} />
                  <div className="card-bubble-info">
                    <span className="card-bubble-name">{cardData.name}</span>
                    <span className="card-bubble-dept">{cardData.department} · {cardData.position}</span>
                  </div>
                </div>
                <div className="card-bubble-footer">个人名片</div>
              </div>
            )}
            {isImage && imageData && (
              <div className="image-message" onClick={() => imageSrc && window.open(imageSrc, '_blank')}>
                {imageSrc
                  ? <img src={imageSrc} alt="图片" style={{maxWidth: 200, maxHeight: 200, borderRadius: 8}} />
                  : <div style={{width: 120, height: 80, borderRadius: 8, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12}}>加载中…</div>
                }
              </div>
            )}
            {isFile && fileData && (
              <div className="file-message" onClick={() => downloadWithAuth(fileData.fileUrl, fileData.fileName)}>
                <div className="file-icon">📎</div>
                <div className="file-info">
                  <div className="file-name">{fileData.fileName || '文件'}</div>
                  <div className="file-size">{fileData.fileSize ? (fileData.fileSize > 1024*1024 ? (fileData.fileSize/1024/1024).toFixed(1)+'MB' : (fileData.fileSize/1024).toFixed(0)+'KB') : ''}</div>
                </div>
              </div>
            )}
            {!isVoice && !isCard && !isImage && !isFile && msg.content}
          </div>
          <span className="msg-time">
            {isMine && (() => {
              const cnt = readReceipts?.[msg.id] || 0;
              if (!cnt) return null;
              if (isPrivate) return <span className="msg-read-status">已读</span>;
              const canSee = myGroupRole === 'owner' || myGroupRole === 'admin';
              if (!canSee) return null;
              return (
                <span className="msg-read-status msg-read-group" onClick={e => { e.stopPropagation(); setShowReceipts(true); }}>
                  已读 {cnt}
                </span>
              );
            })()}
            {dayjs(msg.created_at).format('HH:mm')}
          </span>
          {showReceipts && (
            <ReadReceiptsPopup messageId={msg.id} onClose={() => setShowReceipts(false)} />
          )}
          {/* Reactions */}
          {reactionEntries.length > 0 && (
            <div className="msg-reactions">
              {reactionEntries.map(([emoji, users]) => (
                <span key={emoji} className={`reaction-badge ${users.includes(currentUserId) ? 'mine' : ''}`}
                  onClick={() => onReact(emoji)}>
                  {emoji} {users.length}
                </span>
              ))}
            </div>
          )}
        </div>
        {showMenu && (
          <div className="ctx-menu" ref={menuRef}>
            {!isVoice && !isCard && !isFile && (
              <button onClick={() => { navigator.clipboard.writeText(msg.content); setShowMenu(false); }}>复制</button>
            )}
            <button onClick={() => { onReply(); setShowMenu(false); }}>引用回复</button>
            <button onClick={() => { setShowReactions(v => !v); setShowMenu(false); }}>添加反应</button>
            {canRecall && <button onClick={() => { onRecall(msg.id); setShowMenu(false); }}>撤回</button>}
            {isMine && <button className="ctx-delete" onClick={() => { if (confirm('确认删除这条消息？对方也将看不到此消息。')) { onDelete(msg.id); setShowMenu(false); } }}>删除</button>}
            <button onClick={() => setShowMenu(false)}>取消</button>
          </div>
        )}
        {/* Reaction picker */}
        {showReactions && (
          <div className="reaction-picker" ref={menuRef}>
            {EMOJIS.map(e => (
              <button key={e} className="reaction-emoji" onClick={() => { onReact(e); setShowReactions(false); }}>{e}</button>
            ))}
          </div>
        )}
      </div>
      {isMine && <div className="msg-avatar" />}
    </div>
  );
}

/* ── Read Receipts Popup ── */
function ReadReceiptsPopup({ messageId, onClose }) {
  const [readers, setReaders] = useState(null);
  const token = useStore(s => s.token);

  useEffect(() => {
    fetch(`/api/messages/read-receipts/${messageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setReaders)
      .catch(() => setReaders([]));
  }, [messageId]);

  return (
    <div className="receipts-overlay" onClick={onClose}>
      <div className="receipts-popup" onClick={e => e.stopPropagation()}>
        <div className="receipts-header">
          <span>已读成员</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="receipts-list">
          {readers === null && <div className="receipts-loading">加载中…</div>}
          {readers?.length === 0 && <div className="receipts-empty">暂无人已读</div>}
          {readers?.map(r => (
            <div key={r.user_id} className="receipts-item">
              <AvatarCircle name={r.display_name} color={r.avatar_color} size={32} radius={16} />
              <span className="receipts-name">{r.display_name}</span>
              <span className="receipts-time">{dayjs(r.read_at).format('HH:mm')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDate(t) {
  const d = dayjs(t);
  if (d.isToday()) return '今天';
  if (d.isYesterday()) return '昨天';
  return d.format('YYYY年M月D日');
}
