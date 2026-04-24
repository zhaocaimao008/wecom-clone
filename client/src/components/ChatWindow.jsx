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
  const { activeConv, messages, currentUser, typingUsers, groups, clearActiveConv, contacts } = useStore();
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
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const albumRef = useRef(null);
  const cameraRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordTimerRef = useRef(null);
  const socket = getSocket();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Scroll to bottom when mobile keyboard opens
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setInput(''); setShowEmoji(false); setShowMore(false); setShowCallOptions(false); setShowManage(false); setVoiceMode(false);
    if (activeConv?.type === 'group') loadMembers(activeConv.id);
  }, [activeConv?.id]);

  function loadMembers(gid) {
    fetch(`/api/users/groups/${gid}/members`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('wc_token')}` }
    }).then(r => r.json()).then(setMembers);
  }

  function closeAll() { setShowEmoji(false); setShowMore(false); setShowCallOptions(false); }

  const sendMessage = useCallback(() => {
    if (!input.trim() || !socket) return;
    const payload = activeConv.type === 'private'
      ? { receiverId: activeConv.id, content: input.trim() }
      : { groupId: activeConv.id, content: input.trim() };
    socket.emit('send_message', payload);
    setInput(''); setShowEmoji(false); setShowMore(false);
  }, [input, activeConv, socket]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    if (socket && activeConv?.type === 'private')
      socket.emit('typing', { receiverId: activeConv.id, isTyping: true });
  }

  function recallMsg(msgId) { socket?.emit('recall_message', { messageId: msgId }); }

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
    const token = localStorage.getItem('wc_token');
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
        const payload = activeConv.type === 'private'
          ? { receiverId: activeConv.id, content: msg.voiceUrl, msgType: 'voice', durationMs }
          : { groupId: activeConv.id, content: msg.voiceUrl, msgType: 'voice', durationMs };
        socket?.emit('send_message', payload);
      }
    } catch { alert('语音上传失败'); }
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
      <div className="messages-area" onClick={closeAll}>
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
                : <MessageBubble msg={msg} isMine={isMine} showAvatar={showAvatar} onRecall={recallMsg} />
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
                onFocus={() => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 300)}
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

        {/* Hidden file inputs */}
        <input ref={albumRef} type="file" accept="image/*" style={{ display: 'none' }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} />

        {/* More panel */}
        {showMore && (
          <div className="wx-more-panel" onClick={e => e.stopPropagation()}>
            <button className="wx-more-item" onClick={() => albumRef.current?.click()}>
              <span className="wx-more-icon" style={{ background: '#1989FA' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
              </span>
              <span>相册</span>
            </button>
            <button className="wx-more-item" onClick={() => cameraRef.current?.click()}>
              <span className="wx-more-icon" style={{ background: '#07c160' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M20 5h-3.17L15 3H9L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z"/></svg>
              </span>
              <span>拍摄</span>
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

/* ── Message Bubble ── */
function playVoice(url) { new Audio(url).play().catch(() => {}); }

function MessageBubble({ msg, isMine, showAvatar, onRecall }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const canRecall = isMine && (Date.now() - new Date(msg.created_at).getTime()) < 120000;
  const isVoice = msg.type === 'voice';
  const isCard = msg.type === 'card';

  useEffect(() => {
    const handler = e => { if (!menuRef.current?.contains(e.target)) setShowMenu(false); };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  let cardData = null;
  if (isCard) {
    try {
      cardData = msg.name
        ? msg
        : (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg);
    } catch {}
  }

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
          <div className={`msg-bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'} ${isCard ? 'bubble-card' : ''}`}>
            {isVoice && (
              <div className="voice-message" onClick={() => playVoice(msg.voiceUrl)}>
                <span className="voice-icon">🎤</span>
                <div className="voice-wave">〰️〰️〰️</div>
                <span className="voice-duration">{Math.floor((msg.durationMs || 0) / 1000)}"</span>
              </div>
            )}
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
            {!isVoice && !isCard && msg.content}
          </div>
          <span className="msg-time">{dayjs(msg.created_at).format('HH:mm')}</span>
        </div>
        {showMenu && (
          <div className="ctx-menu" ref={menuRef}>
            {!isVoice && !isCard && (
              <button onClick={() => { navigator.clipboard.writeText(msg.content); setShowMenu(false); }}>复制</button>
            )}
            {canRecall && <button onClick={() => { onRecall(msg.id); setShowMenu(false); }}>撤回</button>}
            <button onClick={() => setShowMenu(false)}>取消</button>
          </div>
        )}
      </div>
      {isMine && <div className="msg-avatar" />}
    </div>
  );
}

function formatDate(t) {
  const d = dayjs(t);
  if (d.isToday()) return '今天';
  if (d.isYesterday()) return '昨天';
  return d.format('YYYY年M月D日');
}
