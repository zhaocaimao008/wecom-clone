import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket';
import { AvatarCircle } from './Sidebar';
import { e2e, encryptMessage, isEncrypted, decryptMessage } from '../crypto/e2e';
import { useCall } from './useCall';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
dayjs.extend(isToday);
dayjs.extend(isYesterday);

import MessageBubble, { formatDate } from './MessageBubble';
import ForwardModal from './ForwardModal';
import { useUpload } from './useUpload';
import { useVoiceRecorder } from './useVoiceRecorder';
import { useMarkRead } from './useMarkRead';
import { useGroupMembers } from './useGroupMembers';
import { useMention } from './useMention';

const GroupManagePanel = lazy(() => import('./GroupManagePanel'));

const EMOJIS = ['😀','😂','🥰','😎','🤔','😅','🙏','👍','👎','❤️','🔥','✅','⚠️','🎉','💯','🚀','😭','🤣','😊','🎊','💪','👏','🌟','💡'];
const emptyObj = {}; // 稳定引用，避免 reactions 未命中时每次 render 创建新对象击穿 memo

export default function ChatWindow() {
  const { activeConv, messages, currentUser, token, typingUsers, groups, clearActiveConv, contacts, readReceipts, reactions, messagesLoading, markActiveRead, scrollToMsgId } = useStore();
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showCallOptions, setShowCallOptions] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  // ── Reply-to state ────────────────────────────────────────────────
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [forwardMsgs, setForwardMsgs] = useState(null);  // null | Message[]
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState(new Set());
  const bottomRef = useRef(null);
  const msgAreaRef = useRef(null);
  const inputRef = useRef(null);
  const imageUploadRef = useRef(null);
  const fileUploadRef = useRef(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const cameraUploadRef = useRef(null);
  const pasteHandlerRef = useRef(null);
  const lastSendRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const socket = getSocket();

  const { uploading, uploadVoice, uploadImage, uploadFile } = useUpload(activeConv);
  const replyingToRef = useRef(null);
  const { recording, recordMs, start: startRecording, stop: stopRecording } = useVoiceRecorder(
    (blob, durationMs) => { const rid = replyingToRef.current?.id; setReplyingTo(null); uploadVoice(blob, durationMs, rid); }
  );
  const { members, reload: reloadMembers } = useGroupMembers(activeConv);
  const { showPicker: showMentionPicker, mentionFilter, detect: detectMention, insert: insertMentionText, close: closeMention } = useMention(members, activeConv?.type === 'group');
  const { markIfVisible: markReadIfVisible, reset: resetMarkRead } = useMarkRead({ socket, messages, currentUser, isNearBottomRef, markActiveRead });

  function scrollToBottom(behavior = 'instant') {
    const el = msgAreaRef.current;
    if (el) { el.scrollTo({ top: el.scrollHeight, behavior }); }
    setShowScrollBtn(false);
  }

  // 只在已接近底部时自动跟随新消息，避免打断历史浏览
  useEffect(() => {
    if (isNearBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom('instant'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, typingUsers.size]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => { setTimeout(scrollToBottom, 50); };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setInput(''); setShowEmoji(false); setShowMore(false); setShowCallOptions(false); setShowManage(false); setVoiceMode(false);
    closeMention();
    setReplyingTo(null); setHasMore(true); setLoadingMore(false);
    resetMarkRead();
    replyingToRef.current = null;
  }, [activeConv?.id]);

  // Keep ref in sync so voice recorder callback always sees latest replyingTo
  useEffect(() => { replyingToRef.current = replyingTo; }, [replyingTo]);

  // Scroll to a specific message when jumping from search results
  useEffect(() => {
    if (!scrollToMsgId || !messages.length) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${scrollToMsgId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('msg-highlight');
        setTimeout(() => el.classList.remove('msg-highlight'), 2000);
      }
      useStore.setState({ scrollToMsgId: null });
    });
  }, [scrollToMsgId, messages]);

  function closeAll() { setShowEmoji(false); setShowMore(false); setShowCallOptions(false); closeMention(); }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !socket) return;
    const now = Date.now();
    if (now - lastSendRef.current < 300) return;
    lastSendRef.current = now;
    if (editingMsg) {
      socket.emit('edit_message', { messageId: editingMsg.id, content: input.trim() });
      setEditingMsg(null);
      setInput(''); setShowEmoji(false); setShowMore(false);
      return;
    }
    let content = input.trim();
    // Encrypt private messages when E2EE is ready for both parties
    if (activeConv.type === 'private' && e2e.ready) {
      const token = useStore.getState().token;
      const sharedKey = await e2e.getSharedKey(activeConv.id, token);
      if (sharedKey) content = await encryptMessage(content, sharedKey);
    }
    const payload = activeConv.type === 'private'
      ? { receiverId: activeConv.id, content }
      : { groupId: activeConv.id, content: input.trim() };
    if (replyingTo) { payload.replyToId = replyingTo.id; setReplyingTo(null); }
    socket.emit('send_message', payload);
    setInput(''); setShowEmoji(false); setShowMore(false);
    isNearBottomRef.current = true;
    requestAnimationFrame(() => {
      const el = msgAreaRef.current;
      if (el) { el.scrollTop = el.scrollHeight; setShowScrollBtn(false); }
    });
  }, [input, activeConv, socket, replyingTo, editingMsg]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleInputChange(e) {
    const val = e.target.value;
    setInput(val);
    if (socket && activeConv?.type === 'private')
      socket.emit('typing', { receiverId: activeConv.id, isTyping: true });
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    detectMention(val);
  }

  function insertMention(member) {
    setInput(insertMentionText(member, input));
    inputRef.current?.focus();
  }

  const recallMsg  = useCallback((msgId) => { socket?.emit('recall_message',  { messageId: msgId }); }, [socket]);
  const deleteMsg  = useCallback((msgId) => { socket?.emit('delete_message',   { messageId: msgId }); }, [socket]);

  // 稳定的 msgId-based 回调，不随消息列表变化重建
  const handleReply   = useCallback((msgId) => {
    const msg = useStore.getState().messages.find(m => m.id === msgId);
    if (msg) { setEditingMsg(null); setReplyingTo(msg); inputRef.current?.focus(); }
  }, []);
  const handleEdit    = useCallback((msgId) => {
    const msg = useStore.getState().messages.find(m => m.id === msgId);
    if (msg) { setReplyingTo(null); setEditingMsg(msg); setInput(msg.content); setTimeout(() => inputRef.current?.focus(), 0); }
  }, []);
  // 直接转发单条消息（右键菜单「转发」）
  const handleDirectForward = useCallback((msgId) => {
    const msg = useStore.getState().messages.find(m => m.id === msgId);
    if (msg) setForwardMsgs([msg]);
  }, []);
  // 进入多选模式，可选预先选中某条消息
  const enterSelectMode = useCallback((msgId) => {
    setSelectMode(true);
    setSelectedMsgIds(msgId ? new Set([msgId]) : new Set());
  }, []);

  const toggleMsgSelect = useCallback((msgId) => {
    setSelectedMsgIds(s => { const n = new Set(s); n.has(msgId) ? n.delete(msgId) : n.add(msgId); return n; });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedMsgIds(new Set());
  }, []);

  const handleMultiForward = useCallback(() => {
    const allMsgs = useStore.getState().messages;
    // 保持时间顺序
    const msgs = allMsgs.filter(m => selectedMsgIds.has(m.id));
    if (!msgs.length) return;
    setForwardMsgs(msgs);
  }, [selectedMsgIds]);

  // ── Reactions ──────────────────────────────────────────────────────
  const toggleReaction = useCallback((msgId, emoji) => {
    const { reactions: cur, updateReaction } = useStore.getState();
    const userId = useStore.getState().currentUser?.id;
    if (!userId || !socket) return;
    socket.emit('toggle_reaction', { messageId: msgId, emoji });
    const emojiUsers = cur[msgId]?.[emoji] || [];
    const hasReacted = emojiUsers.includes(userId);
    const nextUsers = hasReacted ? emojiUsers.filter(id => id !== userId) : [...emojiUsers, userId];
    updateReaction(msgId, emoji, nextUsers);
  }, [socket]);

  function openReply(msg) { setEditingMsg(null); setReplyingTo(msg); inputRef.current?.focus(); }
  function closeReply() { setReplyingTo(null); }
  function openEdit(msg) { setReplyingTo(null); setEditingMsg(msg); setInput(msg.content); setTimeout(() => { inputRef.current?.focus(); }, 0); }
  function closeEdit() { setEditingMsg(null); setInput(''); }

  function forwardToTargets(targets) {
    if (!socket || !forwardMsgs?.length) return;
    for (const m of forwardMsgs) {
      let content, msgType;
      if (m.type === 'image') {
        content = JSON.stringify({ imageUrl: m.imageUrl });
        msgType = 'image';
      } else if (m.type === 'voice') {
        content = m.content || JSON.stringify({ voiceUrl: m.voiceUrl, durationMs: m.durationMs || 0 });
        msgType = 'voice';
      } else if (m.type === 'file') {
        content = JSON.stringify({ fileUrl: m.fileUrl, fileName: m.fileName, fileSize: m.fileSize });
        msgType = 'file';
      } else if (m.type === 'card') {
        content = m.content || JSON.stringify({ userId: m.userId, name: m.name, color: m.color });
        msgType = 'card';
      } else {
        content = m.content;
      }
      for (const t of targets) {
        const payload = t.type === 'private'
          ? { receiverId: t.id, content, ...(msgType ? { msgType } : {}) }
          : { groupId:    t.id, content, ...(msgType ? { msgType } : {}) };
        socket.emit('send_message', payload);
      }
    }
    setForwardMsgs(null);
    exitSelectMode();
  }

  async function handlePaste(e) {
    if (!activeConv || isMuted) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const rid = replyingToRef.current?.id;
        setReplyingTo(null);
        if (item.type.startsWith('image/')) {
          await uploadImage(file, rid);
        } else {
          await uploadFile(file, rid);
        }
        return;
      }
    }
  }

  // Keep ref pointing to latest handlePaste so document listener always uses current state
  pasteHandlerRef.current = handlePaste;

  // Document-level paste: catches Ctrl+V even when focus is outside textarea
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      // Let textarea handle its own paste (with stopPropagation)
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      pasteHandlerRef.current?.(e);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, []);

  async function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const rid = replyingToRef.current?.id;
    setReplyingTo(null);
    await uploadImage(file, rid);
    e.target.value = '';
  }

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const rid = replyingToRef.current?.id;
    setReplyingTo(null);
    await uploadFile(file, rid);
    e.target.value = '';
  }

  async function handleScroll(e) {
    const el = e.target;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasNearBottom = isNearBottomRef.current;
    isNearBottomRef.current = distFromBottom < 100;
    setShowScrollBtn(distFromBottom > 200);
    // 用户滚动到底部附近时标已读（从上方回滚到底部的情景）
    if (!wasNearBottom && isNearBottomRef.current) markReadIfVisible();
    if (loadingMore || !hasMore) return;
    if (el.scrollTop < 80) {
      setLoadingMore(true);
      // 记录当前 totalSize，loadMore 后用偏移量锚定位置
      const prevScrollHeight = el.scrollHeight;
      const got = await useStore.getState().loadMoreMessages();
      if (!got) setHasMore(false);
      requestAnimationFrame(() => {
        if (msgAreaRef.current)
          msgAreaRef.current.scrollTop += msgAreaRef.current.scrollHeight - prevScrollHeight;
      });
      setLoadingMore(false);
    }
  }

  function sendCard(user) {
    if (!socket || !activeConv) return;
    const cardJson = JSON.stringify({
      userId: user.id, name: user.display_name, color: user.avatar_color,
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
  const myMemberInfo = members.find(m => m.id === currentUser?.id);
  const myGroupRole = myMemberInfo?.role;
  const isGlobalMuted = !!(groupInfo?.mute_all && myGroupRole === 'member');
  const isPersonalMuted = !!(myGroupRole === 'member' && myMemberInfo?.muted_until != null &&
    (myMemberInfo.muted_until === 0 || myMemberInfo.muted_until > Date.now()));
  const isMuted = isGlobalMuted || isPersonalMuted;
  const sendError = useStore(s => s.sendError);

  // ── 虚拟列表数据构建 ──────────────────────────────────────────────
  // 将消息数组 + 日期分隔符 + typing 展平为单一 item 列表
  const flatItems = useMemo(() => {
    const items = [];
    messages.forEach((msg, i) => {
      const prev = messages[i - 1];
      const showDate = !prev || !dayjs(msg.created_at).isSame(dayjs(prev.created_at), 'day');
      if (showDate) items.push({ kind: 'date', id: `d-${i}`, date: msg.created_at });
      items.push({ kind: 'msg', id: msg.id ?? `tmp-${i}`, msg, idx: i });
    });
    if (isTyping) items.push({ kind: 'typing', id: 'typing' });
    return items;
  }, [messages, isTyping]);

  // O(1) 引用消息查找
  const msgMap = useMemo(() => {
    const m = new Map();
    messages.forEach(msg => { if (msg.id) m.set(msg.id, msg); });
    return m;
  }, [messages]);


  return (
    <div className="chat-window" onClick={closeAll} onPaste={handlePaste}>
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
            <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>加载中…</div>}>
              <GroupManagePanel
                groupId={activeConv.id}
                members={members}
                onClose={() => setShowManage(false)}
                onMembersChanged={reloadMembers}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* ── Messages（虚拟列表）── */}
      <div className="messages-area" ref={msgAreaRef} onClick={closeAll} onScroll={handleScroll}>
        {messagesLoading && messages.length === 0 && (
          <div className="msg-skeleton">
            {[0,1,2,3,4].map(i => (
              <div key={i} className={`msg-skeleton-row${i % 3 === 2 ? ' mine' : ''}`}>
                <div className="msg-skeleton-avatar skeleton-shine" />
                <div className="msg-skeleton-bubble skeleton-shine" style={{ width: `${40 + (i * 17) % 35}%` }} />
              </div>
            ))}
          </div>
        )}

        {(loadingMore || (!hasMore && messages.length > 0)) && (
          <div className="load-more-tip">
            {loadingMore ? '加载中…' : '已加载全部消息'}
          </div>
        )}

        {flatItems.map(item => {
          if (item.kind === 'date') {
            return <div key={item.id} className="date-separator"><span>{formatDate(item.date)}</span></div>;
          }
          if (item.kind === 'typing') {
            return (
              <div key={item.id} className="typing-indicator">
                <span>{activeConv?.name}正在输入</span>
                <span className="typing-dots"><span/><span/><span/></span>
              </div>
            );
          }
          if (item.kind === 'msg') {
            const { msg, idx } = item;
            const isMine = msg.sender_id === currentUser?.id;
            const prevMsg = messages[idx - 1];
            const prevSameDay = prevMsg && dayjs(msg.created_at).isSame(dayjs(prevMsg.created_at), 'day');
            const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id || !prevSameDay);
            const replyRef = msg.reply_to_id ?? msg.reply_to;
            // Use local message map first; fall back to enriched server data for out-of-page quotes
            const replyToMsg = replyRef ? (msgMap.get(replyRef) ?? (msg.reply_to_info ? {
              id: replyRef,
              sender_name: msg.reply_to_info.sender_name,
              content: msg.reply_to_info.content,
              type: msg.reply_to_info.msg_type,
              msg_type: msg.reply_to_info.msg_type,
            } : null)) : null;
            const isSelected = selectedMsgIds.has(msg.id);

            const bubble = msg.recalled
              ? <div className="recalled-msg">{isMine ? '你' : msg.sender_name} 撤回了一条消息</div>
              : <MessageBubble
                  msg={msg}
                  isMine={isMine}
                  showAvatar={showAvatar}
                  onRecall={recallMsg}
                  onDelete={deleteMsg}
                  onReply={handleReply}
                  onEdit={handleEdit}
                  onForward={handleDirectForward}
                  onMultiSelect={enterSelectMode}
                  onReact={toggleReaction}
                  reactions={reactions[msg.id] || emptyObj}
                  readCount={readReceipts[msg.id] || 0}
                  replyToMsg={replyToMsg}
                  currentUserId={currentUser?.id}
                  isPrivate={activeConv?.type === 'private'}
                  myGroupRole={myGroupRole}
                  selectMode={selectMode}
                />;

            if (selectMode && msg.id) {
              return (
                <div key={item.id} id={msg.id ? `msg-${msg.id}` : undefined}
                     className={`msg-select-row${isSelected ? ' msg-select-row--on' : ''}`}
                     onClick={() => toggleMsgSelect(msg.id)}
                     onContextMenu={e => e.preventDefault()}>
                  <span className={`msg-select-check${isSelected ? ' msg-select-check--on' : ''}`}>
                    {isSelected && <svg viewBox="0 0 24 24" width="13" height="13" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                  </span>
                  {bubble}
                </div>
              );
            }
            return <React.Fragment key={item.id}><div id={msg.id ? `msg-${msg.id}` : undefined}>{bubble}</div></React.Fragment>;
          }
          return null;
        })}
        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button className="msg-scroll-btn" onClick={scrollToBottom} title="滚动到底部">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        </button>
      )}

      {sendError && <div className="send-error-toast">{sendError}</div>}

      {/* ── 多选工具栏（替代输入区） ── */}
      {selectMode && (
        <div className="msg-select-bar">
          <button className="msg-select-bar-cancel" onClick={exitSelectMode}>取消</button>
          <span className="msg-select-bar-count">
            {selectedMsgIds.size > 0 ? `已选 ${selectedMsgIds.size} 条` : '点击消息选中'}
          </span>
          <button
            className="msg-select-bar-forward"
            disabled={!selectedMsgIds.size}
            onClick={handleMultiForward}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: 4 }}>
              <path d="M12 8V4l8 8-8 8v-4H4V8z"/>
            </svg>
            转发{selectedMsgIds.size > 0 ? `(${selectedMsgIds.size})` : ''}
          </button>
        </div>
      )}

      {/* ── Input area ── */}
      {!selectMode && <div className={`wx-input-wrap ${isMuted ? 'input-muted' : ''}`} onClick={e => e.stopPropagation()}>
        {isMuted && (
          <div className="mute-banner">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            {isPersonalMuted ? '你已被群主禁言' : '全员禁言中，仅群主和管理员可发言'}
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

        {/* ── Editing indicator ── */}
        {editingMsg && (
          <div className="reply-quote" style={{ borderLeftColor: '#fa9d3b' }}>
            <div className="reply-quote-content">
              <span className="reply-quote-name" style={{ color: '#fa9d3b' }}>✏️ 编辑消息</span>
              <span className="reply-quote-text">{(editingMsg.content || '').slice(0, 60)}</span>
            </div>
            <button className="reply-quote-close" onClick={closeEdit}>✕</button>
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
                {recording ? `松开发送 · ${(recordMs / 1000).toFixed(1)}s / 60s` : '按住 说话'}
              </button>
            : <textarea
                ref={inputRef}
                className="wx-textarea"
                placeholder={isMuted ? '已被禁言' : `发消息`}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={e => { e.stopPropagation(); handlePaste(e); }}
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
        <input ref={fileUploadRef} type="file" accept="*" style={{ display: 'none' }} onChange={handleFileSelect} />

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
      </div>}

      {/* Card picker modal */}
      {showCardPicker && (
        <CardPickerModal
          contacts={contacts}
          onClose={() => setShowCardPicker(false)}
          onSelect={sendCard}
        />
      )}

      {/* Forward modal */}
      {forwardMsgs && (
        <ForwardModal
          contacts={contacts}
          groups={groups}
          msgCount={forwardMsgs.length}
          onClose={() => { setForwardMsgs(null); exitSelectMode(); }}
          onConfirm={forwardToTargets}
        />
      )}
    </div>
  );
}

/* ── Card Picker Modal ── */
function CardPickerModal({ contacts, onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const filtered = contacts.filter(c =>
    !search || c.display_name?.includes(search)
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
                  <span className="add-result-sub">{u.username}</span>
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

