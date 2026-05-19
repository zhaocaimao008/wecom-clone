import React, { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';
import ChatWindow from './ChatWindow';
import CreateGroupModal from './CreateGroupModal';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
const SearchPanel = lazy(() => import('./SearchPanel'));
dayjs.extend(isToday);
dayjs.extend(isYesterday);

// Returns {top, left} so the menu stays fully inside the viewport
function clampMenu(x, y, menuW = 140, menuH = 140) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    top:  Math.min(y, vh - menuH - 8),
    left: Math.min(x, vw - menuW - 8),
  };
}

export default function ChatPanel() {
  const { conversations, activeConv, fetchMessages, fetchConversations, fetchContacts, currentUser } = useStore();
  const onlineUsers = useStore(s => s.onlineUsers);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { conv, x, y }
  const pressTimer = useRef(null);


  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [ctxMenu]);

  function startPress(conv, e) {
    pressTimer.current = setTimeout(() => {
      const pos = clampMenu(e?.clientX ?? 120, e?.clientY ?? 120);
      setCtxMenu({ conv, ...pos });
    }, 500);
  }
  function cancelPress() { clearTimeout(pressTimer.current); }

  async function handleCtxAction(action) {
    if (!ctxMenu) return;
    const { conv } = ctxMenu;
    setCtxMenu(null);
    const convKey = conv.group_id ? `g:${conv.group_id}` : `p:${conv.peer_id}`;
    try {
      if (action === 'pin') {
        await useStore.getState().api('/messages/conversations/settings', {
          method: 'POST', body: { convKey, isPinned: conv.is_pinned ? 0 : 1 },
        });
        fetchConversations();
      } else if (action === 'mute') {
        await useStore.getState().api('/messages/conversations/settings', {
          method: 'POST', body: { convKey, isMuted: conv.is_muted ? 0 : 1 },
        });
        fetchConversations();
      } else if (action === 'delete') {
        if (conv.group_id) {
          await useStore.getState().api(`/groups/${conv.group_id}/quit`, { method: 'POST' });
          fetchContacts();
        } else {
          await useStore.getState().api(`/users/friends/${conv.peer_id}`, { method: 'DELETE' });
          fetchContacts();
        }
        fetchConversations();
        if (isActive(conv)) useStore.getState().clearActiveConv();
      }
    } catch(e) { useStore.getState().addToast({ title: '操作失败', body: e.message }); }
  }

  const filtered = useMemo(() =>
    search.trim()
      ? conversations.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()))
      : conversations,
    [conversations, search]
  );

  function openConv(c) {
    const conv = {
      type: c.group_id ? 'group' : 'private',
      id: c.group_id || c.peer_id,
      name: c.name,
      avatarColor: c.avatar_color,
      avatarUrl: c.avatar_url || null,
    };
    fetchMessages(conv);
  }

  function fmtTime(t) {
    if (!t) return '';
    const d = dayjs(t);
    if (d.isToday()) return d.format('HH:mm');
    if (d.isYesterday()) return '昨天';
    return d.format('MM/DD');
  }

  function isActive(c) {
    if (!activeConv) return false;
    return activeConv.type === (c.group_id ? 'group' : 'private') &&
      activeConv.id === (c.group_id || c.peer_id);
  }

  return (
    <div className={`chat-panel ${activeConv ? 'chat-active' : ''}`}>
      {/* ── Left list ── */}
      <div className="conv-list">
        <div className="panel-header">
          <div className="panel-header-row">
            <div className="search-bar" style={{ flex: 1 }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="#999"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              <input placeholder="搜索" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="new-group-btn" title="搜索聊天记录" onClick={() => setShowSearch(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </button>
            <button className="new-group-btn" title="发起群聊" onClick={() => setShowCreate(true)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
            </button>
          </div>
        </div>
        {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}

        <div className="conv-items">
          {filtered.map((c) => {
            const key = c.group_id ? `g${c.group_id}` : `p${c.peer_id}`;
            const preview = c.last_type === 'voice' ? '[语音]' : c.last_type === 'image' ? '[图片]' : (c.last_message || '');
            return (
              <div key={key}
                className={`conv-item ${isActive(c) ? 'active' : ''} ${c.is_pinned ? 'pinned' : ''}`}
                onClick={() => openConv(c)}
                onTouchStart={e => startPress(c, e.touches[0])}
                onTouchMove={cancelPress}
                onTouchEnd={cancelPress}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ conv: c, ...clampMenu(e.clientX, e.clientY) }); }}
              >
                <div className="conv-avatar">
                  <AvatarCircle name={c.name} color={c.avatar_color} url={c.avatar_url} size={44} radius={c.group_id ? 10 : 22} />
                  {!c.group_id && (
                    <span className={`status-dot ${onlineUsers.has(c.peer_id) ? 'online' : 'offline'}`} />
                  )}
                </div>
                <div className="conv-info">
                  <div className="conv-top">
                    <span className="conv-name">{!!c.is_muted ? '🔇 ' : ''}{c.name}</span>
                    <div className="conv-top-right">
                      {!!c.is_pinned && <span className="pin-icon">📌</span>}
                      <span className="conv-time">{fmtTime(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="conv-bottom">
                    <span className="conv-preview">{preview}</span>
                    {(c.unread_count > 0) && (
                      c.is_muted
                        ? <span className="unread-dot-muted" />
                        : <span className="unread-badge">{c.unread_count > 99 ? '99+' : c.unread_count}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-list">暂无会话</div>
          )}
        </div>


        {/* Long-press context menu */}
        {ctxMenu && (
          <div className="conv-ctx-menu"
            style={{ top: ctxMenu.top, left: ctxMenu.left }}
            onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
            <button onClick={() => handleCtxAction('pin')}>
              {ctxMenu.conv.is_pinned ? '取消置顶' : '置顶'}
            </button>
            <button onClick={() => handleCtxAction('mute')}>
              {ctxMenu.conv.is_muted ? '取消静音' : '静音'}
            </button>
          </div>
        )}
      </div>

      {/* ── Right chat ── */}
      <div className="chat-area">
        {activeConv ? <ChatWindow /> : <EmptyState />}
      </div>

      {showSearch && (
        <Suspense fallback={null}>
          <SearchPanel onClose={() => setShowSearch(false)} />
        </Suspense>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 80 80" width="80" height="80" fill="none">
        <circle cx="40" cy="40" r="40" fill="#f0f0f0"/>
        <path d="M25 30c-6.6 0-12 4.5-12 10 0 3.1 1.7 5.9 4.4 7.8l-1.8 5 5.4-2.6c1.3.4 2.7.6 4.1.6 6.6 0 12-4.5 12-10S31.6 30 25 30z" fill="#ccc"/>
        <path d="M55 36c-5.3 0-9.5 3.7-9.5 8.2 0 2.4 1.3 4.6 3.4 6.2l-1.4 3.9 4.3-2.1c1 .2 2 .4 3.2.4 5.3 0 9.5-3.7 9.5-8.2S60.3 36 55 36z" fill="#bbb"/>
      </svg>
      <p>选择联系人开始聊天</p>
    </div>
  );
}
