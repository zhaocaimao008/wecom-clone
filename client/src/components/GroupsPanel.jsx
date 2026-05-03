import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

function useLongPress(onLongPress) {
  const timer = React.useRef(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onTouchStart: (e) => { e.stopPropagation(); timer.current = setTimeout(() => { onLongPress(); timer.current = null; }, 500); },
    onTouchMove:  cancel,
    onTouchEnd:   cancel,
    onContextMenu: (e) => { e.preventDefault(); onLongPress(); },
  };
}

export default function GroupsPanel() {
  const { groups, fetchMessages, setActiveTab, api, fetchContacts, fetchConversations, currentUser } = useStore();
  const [selected, setSelected] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [ctxMenu]);

  async function handleCtxAction(action) {
    if (!ctxMenu) return;
    const { data } = ctxMenu;
    setCtxMenu(null);
    const convKey = `g:${data.id}`;
    try {
      if (action === 'pin' || action === 'mute') {
        const conversations = useStore.getState().conversations;
        const conv = conversations.find(c => c.group_id === data.id);
        const cur = conv?.[action === 'pin' ? 'is_pinned' : 'is_muted'] ?? 0;
        await useStore.getState().api('/messages/conversations/settings', {
          method: 'POST', body: { convKey, [action === 'pin' ? 'isPinned' : 'isMuted']: cur ? 0 : 1 },
        });
        fetchConversations();
      } else if (action === 'quit') {
        if (!confirm(`确认退出「${data.name}」群聊？`)) return;
        await useStore.getState().api(`/groups/${data.id}/quit`, { method: 'POST' });
        fetchContacts();
        fetchConversations();
        if (selected?.id === data.id) setSelected(null);
      }
    } catch (e) { alert(e.message); }
  }

  function openChat(g) {
    fetchMessages({ type: 'group', id: g.id, name: g.name, avatarColor: g.avatar_color });
    setActiveTab('messages');
  }

  return (
    <div className="contact-panel">
      {/* ── Left: groups list ── */}
      <div className="contact-list">
        <div className="panel-header">
          <div className="panel-header-row">
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>群聊</span>
          </div>
        </div>

        <div className="contact-items">
          {groups.length === 0
            ? <div className="empty-list" style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13 }}>
                暂无群聊
              </div>
            : groups.map(g => (
              <GroupItem key={g.id} g={g}
                active={selected?.id === g.id}
                onClick={() => setSelected(g)}
                onLongPress={() => setCtxMenu({ data: g })}
              />
            ))
          }
        </div>
      </div>

      {/* ── Right: group detail ── */}
      <div className="contact-detail-panel">
        {selected
          ? <GroupDetail
              g={selected}
              onClose={() => setSelected(null)}
              onChat={openChat}
              currentUser={currentUser}
              api={api}
              fetchContacts={fetchContacts}
              fetchConversations={fetchConversations}
              onQuit={() => setSelected(null)}
            />
          : <EmptyGroupDetail />
        }
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="conv-ctx-menu"
          style={{ top: ctxMenu.y || '50%', left: ctxMenu.x || '50%' }}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}>
          <button onClick={() => handleCtxAction('pin')}>置顶</button>
          <button onClick={() => handleCtxAction('mute')}>静音</button>
          <button className="ctx-delete" onClick={() => handleCtxAction('quit')}>退出群聊</button>
        </div>
      )}
    </div>
  );
}

function GroupItem({ g, active, onClick, onLongPress }) {
  const lp = useLongPress(onLongPress);
  return (
    <div className={`contact-item ${active ? 'active' : ''}`} onClick={onClick} {...lp}>
      <AvatarCircle name={g.name} color={g.avatar_color} size={38} radius={10} />
      <div className="contact-info">
        <span className="contact-name">{g.name}</span>
        {g.member_count != null && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{g.member_count}人</span>
        )}
      </div>
    </div>
  );
}

function GroupDetail({ g, onClose, onChat, currentUser, api, fetchContacts, fetchConversations, onQuit }) {
  const [addMsg, setAddMsg] = useState('');
  const isOwner = g.owner_id === currentUser?.id;

  async function quit() {
    if (!confirm(`确认退出「${g.name}」群聊？`)) return;
    try {
      await api(`/groups/${g.id}/quit`, { method: 'POST' });
      fetchContacts();
      fetchConversations();
      onQuit();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="detail-card">
      {onClose && (
        <button className="detail-close-btn" onClick={onClose} title="关闭">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      )}
      <div className="detail-avatar">
        <AvatarCircle name={g.name} color={g.avatar_color} size={72} radius={16} />
      </div>
      <div className="detail-name">{g.name}</div>
      <div className="detail-position">{g.member_count}位成员</div>

      {g.announcement && (
        <div className="detail-fields">
          <div className="detail-announcement">
            <span className="ann-label">群公告</span>
            <p>{g.announcement}</p>
          </div>
        </div>
      )}

      <div className="detail-btns">
        <button className="btn-chat" onClick={() => onChat(g)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          发消息
        </button>
        {!isOwner && (
          <button className="btn-add-friend" style={{ background: '#e64340' }} onClick={quit}>
            退出群聊
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyGroupDetail() {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 80 80" width="80" height="80" fill="none">
        <circle cx="40" cy="40" r="40" fill="#f0f0f0"/>
        <path d="M53 26H27c-2.2 0-4 1.8-4 4v16c0 2.2 1.8 4 4 4h4l-3 6 8-6h17c2.2 0 4-1.8 4-4V30c0-2.2-1.8-4-4-4z" fill="#ccc"/>
      </svg>
      <p>选择群聊查看详情</p>
    </div>
  );
}
