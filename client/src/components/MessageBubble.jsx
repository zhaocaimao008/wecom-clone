import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket';
import { AvatarCircle } from './Sidebar';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
dayjs.extend(isToday);
dayjs.extend(isYesterday);

export function formatDate(t) {
  const d = dayjs(t);
  if (d.isToday()) return '今天';
  if (d.isYesterday()) return '昨天';
  return d.format('YYYY年M月D日');
}

export function useAuthUrl(url) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setSrc(null); setError(false);
    if (!url) return;
    if (url.startsWith('data:') || url.startsWith('blob:')) { setSrc(url); return; }
    const token = useStore.getState().token;
    let objectUrl = null;
    let cancelled = false;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error(r.status)))
      .then(blob => {
        const u = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(u); return; }
        objectUrl = u;
        setSrc(u);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return { src, error };
}

export async function downloadWithAuth(url, filename) {
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

function VoicePlayer({ msg, isMine }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const { src: blobUrl } = useAuthUrl(msg.voiceUrl);
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

// React.memo: only re-renders when props actually change
const MessageBubble = React.memo(function MessageBubble({
  msg, isMine, showAvatar, onRecall, onDelete, onReply, onEdit, onForward, onMultiSelect, onReact,
  reactions, readCount, replyToMsg, currentUserId, isPrivate, myGroupRole, selectMode,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const menuRef = useRef(null);
  // Only allow recall within 2 minutes (match server-side limit)
  const canRecall = isMine && msg.created_at && (Date.now() - new Date(msg.created_at).getTime() < 2 * 60 * 1000);
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
  if (isFile) {
    try { fileData = msg.fileUrl ? msg : (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg); } catch {}
  }
  let imageData = null;
  if (isImage) {
    try { imageData = msg.imageUrl ? msg : (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg); } catch {}
  }
  const { src: imageSrc, error: imageError } = useAuthUrl(imageData?.imageUrl || null);

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
        <div className="msg-content-wrap" onContextMenu={e => { e.preventDefault(); if (!selectMode) setShowMenu(true); }}>
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
                  </div>
                </div>
                <div className="card-bubble-footer">个人名片</div>
              </div>
            )}
            {isImage && imageData && (
              <div className="image-message" onClick={() => imageSrc && setShowLightbox(true)}>
                {imageSrc
                  ? <img src={imageSrc} alt="图片" style={{maxWidth: 200, maxHeight: 200, borderRadius: 8, cursor: 'zoom-in'}} />
                  : imageError
                    ? <div style={{width: 120, height: 80, borderRadius: 8, background: '#ffeaea', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e53e3e', fontSize: 12}}>图片加载失败</div>
                    : <div style={{width: 120, height: 80, borderRadius: 8, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12}}>加载中…</div>
                }
              </div>
            )}
            {showLightbox && imageSrc && (
              <div className="modal-overlay" style={{ zIndex: 9999 }} onClick={() => setShowLightbox(false)}>
                <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} onClick={e => e.stopPropagation()}>
                  <img src={imageSrc} alt="图片" style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={() => setShowLightbox(false)}
                      style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
                      关闭
                    </button>
                    <a href={imageSrc} download
                      style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: '#07c160', color: '#fff', cursor: 'pointer', textDecoration: 'none', fontSize: 14 }}>
                      下载
                    </a>
                  </div>
                </div>
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
              if (!readCount) return null;
              if (isPrivate) return <span className="msg-read-status">已读</span>;
              const canSee = myGroupRole === 'owner' || myGroupRole === 'admin';
              if (!canSee) return null;
              return (
                <span className="msg-read-status msg-read-group" onClick={e => { e.stopPropagation(); setShowReceipts(true); }}>
                  已读 {readCount}
                </span>
              );
            })()}
            {dayjs(msg.created_at).format('HH:mm')}
          </span>
          {showReceipts && (
            <ReadReceiptsPopup messageId={msg.id} onClose={() => setShowReceipts(false)} />
          )}
          {reactionEntries.length > 0 && (
            <div className="msg-reactions">
              {reactionEntries.map(([emoji, users]) => (
                <span key={emoji} className={`reaction-badge ${users.includes(currentUserId) ? 'mine' : ''}`}
                  onClick={() => onReact(msg.id, emoji)}>
                  {emoji} {users.length}
                </span>
              ))}
            </div>
          )}
        </div>
        {showMenu && (
          <div className="ctx-menu" ref={menuRef}>
            {!isVoice && !isCard && !isFile && !isImage && (
              <button onClick={() => { navigator.clipboard.writeText(msg.content); setShowMenu(false); }}>复制</button>
            )}
            {isImage && (
              <button onClick={async () => {
                setShowMenu(false);
                if (!imageSrc) return;
                try {
                  const img = new Image();
                  img.src = imageSrc;
                  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
                  const canvas = document.createElement('canvas');
                  canvas.width = img.naturalWidth || img.width;
                  canvas.height = img.naturalHeight || img.height;
                  canvas.getContext('2d').drawImage(img, 0, 0);
                  const dataUrl = canvas.toDataURL('image/png');
                  if (window.electronAPI?.copyImage) {
                    await window.electronAPI.copyImage(dataUrl);
                  } else {
                    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                  }
                } catch {
                  useStore.getState().addToast({ title: '复制失败', body: '请长按图片另存为后使用' });
                }
              }}>复制图片</button>
            )}
            <button onClick={() => { onReply(msg.id); setShowMenu(false); }}>回复</button>
            {!isVoice && (
              <button onClick={() => { onForward(msg.id); setShowMenu(false); }}>转发</button>
            )}
            <button onClick={() => { onMultiSelect(msg.id); setShowMenu(false); }}>多选</button>
            {isMine && !isVoice && !isCard && !isFile && !isImage && (
              <button onClick={() => { onEdit(msg.id); setShowMenu(false); }}>编辑</button>
            )}
            {canRecall && <button onClick={() => { onRecall(msg.id); setShowMenu(false); }}>撤回</button>}
            {isMine && <button className="ctx-delete" onClick={async () => { if (await useStore.getState().showConfirm('确认删除这条消息？对方也将看不到此消息。')) { onDelete(msg.id); setShowMenu(false); } }}>删除</button>}
            <button onClick={() => setShowMenu(false)}>取消</button>
          </div>
        )}
      </div>
      {isMine && <div className="msg-avatar" />}
    </div>
  );
});

export default MessageBubble;
