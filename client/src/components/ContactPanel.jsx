import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

// Long-press hook: fires after 500ms hold, cancels on move/end
function useLongPress(onLongPress) {
  const timer = useRef(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onTouchStart: (e) => { e.stopPropagation(); timer.current = setTimeout(() => { onLongPress(); timer.current = null; }, 500); },
    onTouchMove:  cancel,
    onTouchEnd:   cancel,
    onContextMenu: (e) => { e.preventDefault(); onLongPress(); },
  };
}

export default function ContactPanel() {
  const { contacts, departments, groups, fetchMessages, setActiveTab, fetchContacts, fetchConversations, api } = useStore();
  const { friendRequests, friendRequestCount } = useStore();
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [view, setView] = useState('members');
  const [showAddModal, setShowAddModal] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { type:'user'|'group', data, x, y }

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [ctxMenu]);

  async function handleCtxAction(action) {
    if (!ctxMenu) return;
    const { type, data } = ctxMenu;
    setCtxMenu(null);
    const convKey = type === 'user' ? `p:${data.id}` : `g:${data.id}`;
    try {
      if (action === 'pin' || action === 'mute') {
        const conversations = useStore.getState().conversations;
        const conv = conversations.find(c => type === 'user' ? c.peer_id === data.id : c.group_id === data.id);
        const cur = conv?.[action === 'pin' ? 'is_pinned' : 'is_muted'] ?? 0;
        await useStore.getState().api('/messages/conversations/settings', {
          method: 'POST', body: { convKey, [action === 'pin' ? 'isPinned' : 'isMuted']: cur ? 0 : 1 },
        });
        fetchConversations();
      } else if (action === 'delete') {
        if (type === 'user') {
          await useStore.getState().api(`/users/friends/${data.id}`, { method: 'DELETE' });
          fetchContacts();
        } else {
          await useStore.getState().api(`/groups/${data.id}/quit`, { method: 'POST' });
          fetchContacts();
        }
        fetchConversations();
      }
    } catch(e) { alert(e.message); }
  }

  function toggle(dept) { setExpanded(e => ({ ...e, [dept]: !e[dept] })); }

  function openChat(type, data) {
    const conv = type === 'user'
      ? { type: 'private', id: data.id, name: data.display_name, avatarColor: data.avatar_color }
      : { type: 'group', id: data.id, name: data.name, avatarColor: data.avatar_color };
    fetchMessages(conv);
    setActiveTab('messages');
  }

  const filteredContacts = localSearch.trim()
    ? contacts.filter(u =>
        u.display_name.includes(localSearch) ||
        (u.username && u.username.includes(localSearch))
      )
    : null;

  return (
    <div className="contact-panel contact-panel-full">
      <div className="contact-list" style={{ width: '100%', borderRight: 'none' }}>
        <div className="panel-header">
          <div className="panel-header-row">
            <div className="search-bar" style={{ flex: 1 }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="#999">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                placeholder="搜索联系人"
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value)}
              />
              {localSearch && (
                <button style={{ color: '#bbb', fontSize: 16 }} onClick={() => setLocalSearch('')}>✕</button>
              )}
            </div>
            <button className="new-group-btn" title="添加好友" onClick={() => setShowAddModal(true)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="contact-tabs">
          <button className={view === 'members' ? 'active' : ''} onClick={() => setView('members')}>联系人</button>
          <button className={view === 'groups' ? 'active' : ''} onClick={() => setView('groups')}>群聊</button>
        </div>

        {/* 好友申请入口 */}
        <div className={`friend-req-entry ${showRequests ? 'active' : ''}`}
          onClick={() => { setShowRequests(v => !v); setSelected(null); }}>
          <div className="freq-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
          <span className="freq-label">新的好友</span>
          {friendRequestCount > 0 && (
            <span className="freq-badge">{friendRequestCount}</span>
          )}
        </div>

        <div className="contact-items">
          {/* ── Search results ── */}
          {localSearch.trim() && view === 'members' && (
            filteredContacts.length === 0
              ? <div className="empty-list">未找到"{localSearch}"</div>
              : filteredContacts.map(u => (
                <ContactItem key={u.id} u={u}
                  active={selected?.type === 'user' && selected?.data?.id === u.id}
                  onClick={() => { setSelected({ type: 'user', data: u }); setShowRequests(false); }}
                  onLongPress={e => setCtxMenu({ type: 'user', data: u, x: e?.clientX, y: e?.clientY })}
                />
              ))
          )}

          {/* ── Contacts list ── */}
          {!localSearch.trim() && view === 'members' && (
            contacts.length === 0
              ? <div className="empty-list" style={{ padding: '32px 16px', color: '#999', textAlign: 'center', fontSize: 13 }}>
                  暂无好友，点击右上角添加
                </div>
              : contacts.map(u => (
                <ContactItem key={u.id} u={u}
                  active={selected?.type === 'user' && selected?.data?.id === u.id}
                  onClick={() => { setSelected({ type: 'user', data: u }); setShowRequests(false); }}
                  onLongPress={e => setCtxMenu({ type: 'user', data: u, x: e?.clientX, y: e?.clientY })}
                />
              ))
          )}

          {/* ── Groups ── */}
          {view === 'groups' && groups.map(g => (
            <GroupItem key={g.id} g={g}
              active={selected?.type === 'group' && selected?.data?.id === g.id}
              onClick={() => { setSelected({ type: 'group', data: g }); setShowRequests(false); }}
              onLongPress={() => setCtxMenu({ type: 'group', data: g })}
            />
          ))}
        </div>
      </div>

      {/* Long-press context menu */}
      {ctxMenu && (
        <div className="conv-ctx-menu" style={{ top: ctxMenu.y || '50%', left: ctxMenu.x || '50%' }}
          onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
          <button onClick={() => handleCtxAction('pin')}>置顶</button>
          <button onClick={() => handleCtxAction('mute')}>静音</button>
          <button className="ctx-delete" onClick={() => handleCtxAction('delete')}>
            {ctxMenu.type === 'group' ? '退出群聊' : '删除好友'}
          </button>
        </div>
      )}

      {/* Add friend modal */}
      {showAddModal && (
        <AddFriendModal
          onClose={() => setShowAddModal(false)}
          onSelect={u => { setSelected({ type: 'user', data: u }); setShowAddModal(false); }}
        />
      )}

      {/* Friend requests modal */}
      {showRequests && (
        <div className="modal-overlay" onClick={() => setShowRequests(false)}>
          <div className="modal-box" style={{ width: 420, maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <FriendRequestList onClose={() => setShowRequests(false)} />
          </div>
        </div>
      )}

      {/* Contact / Group detail modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-box" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{selected.type === 'group' ? '群组详情' : '联系人详情'}</span>
              <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '8px 24px 24px' }}>
              <ContactDetail item={selected} onChat={(type, data) => { openChat(type, data); setSelected(null); }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Friend Request List ──────────────────────────────── */
function FriendRequestList({ onClose }) {
  const { friendRequests, api, fetchContacts, fetchFriendRequests, removeFriendRequest } = useStore();
  const [msgs, setMsgs] = useState({});

  async function handle(fromId, action) {
    try {
      await api(`/users/friend-requests/${fromId}`, { method: 'PUT', body: { action } });
      setMsgs(m => ({ ...m, [fromId]: action === 'accept' ? '已添加好友' : '已忽略' }));
    } catch (e) {
      // Already processed — still clean up local state
      setMsgs(m => ({ ...m, [fromId]: '已处理' }));
    } finally {
      removeFriendRequest(fromId);
      fetchFriendRequests();
      if (action === 'accept') fetchContacts();
    }
  }

  return (
    <div className="freq-panel">
      <div className="freq-panel-header">
        <span>好友申请</span>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      {friendRequests.length === 0
        ? <div className="empty-state" style={{ height: 200 }}>暂无好友申请</div>
        : friendRequests.map(r => (
          <div key={r.from_id} className="freq-item">
            <AvatarCircle name={r.display_name} color={r.avatar_color} size={44} radius={22} />
            <div className="freq-info">
              <span className="freq-name">{r.display_name}</span>
              {r.message && <span className="freq-msg">"{r.message}"</span>}
            </div>
            <div className="freq-actions">
              {msgs[r.from_id]
                ? <span className="freq-done">{msgs[r.from_id]}</span>
                : <>
                    <button className="btn-accept" onClick={() => handle(r.from_id, 'accept')}>接受</button>
                    <button className="btn-reject" onClick={() => handle(r.from_id, 'reject')}>忽略</button>
                  </>
              }
            </div>
          </div>
        ))
      }
    </div>
  );
}

/* ── Add Friend Modal ─────────────────────────────────── */
function AddFriendModal({ onClose, onSelect }) {
  const { api } = useStore();
  const [mode, setMode] = useState('choose');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          {mode !== 'choose' && (
            <button className="modal-back-btn" onClick={() => setMode('choose')}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
          )}
          <span>{mode === 'scan' ? '扫一扫' : mode === 'id' ? 'ID添加好友' : '添加好友'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {mode === 'choose' && <AddChoose onId={() => setMode('id')} onScan={() => setMode('scan')} />}
        {mode === 'id'     && <AddById api={api} onSelect={onSelect} />}
        {mode === 'scan'   && <AddByScan api={api} onSelect={onSelect} onClose={onClose} />}
      </div>
    </div>
  );
}

function AddChoose({ onId, onScan }) {
  return (
    <div className="add-choose-body">
      <button className="add-choose-btn" onClick={onId}>
        <span className="add-choose-icon" style={{ background: '#1989FA' }}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        </span>
        <div className="add-choose-info">
          <span className="add-choose-title">ID添加好友</span>
          <span className="add-choose-sub">通过企业密信号搜索</span>
        </div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
      </button>
      <button className="add-choose-btn" onClick={onScan}>
        <span className="add-choose-icon" style={{ background: '#07c160' }}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-6 8h1.5v1.5H13V13zm1.5 1.5H16V16h-1.5v-1.5zM16 13h1.5v1.5H16V13zm-3 3h1.5v1.5H13V16zm1.5 1.5H16V19h-1.5v-1.5zM16 16h1.5v1.5H16V16zm1.5-1.5H19V16h-1.5v-1.5zm0 3H19V19h-1.5v-1.5zM22 7h-2V4h-3V2h5v5zm0 15v-5h-2v3h-3v2h5zM2 22h5v-2H4v-3H2v5zM2 2v5h2V4h3V2H2z"/></svg>
        </span>
        <div className="add-choose-info">
          <span className="add-choose-title">扫一扫</span>
          <span className="add-choose-sub">扫描对方的二维码添加</span>
        </div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
      </button>
    </div>
  );
}

function AddById({ api, onSelect }) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addMsg, setAddMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function search(e) {
    e?.preventDefault();
    const code = q.trim().replace(/\D/g, '');
    if (!code) return;
    setLoading(true); setResult(null); setAddMsg('');
    try {
      const u = await api(`/users/by-code/${code}`);
      setResult(u);
    } catch { setResult(false); }
    setLoading(false);
  }

  async function addFriend(u) {
    try {
      await api('/users/friend-requests', { method: 'POST', body: { targetId: u.id } });
      setAddMsg('申请已发送 ✓');
    } catch (e) { setAddMsg(e.message); }
  }

  return (
    <div className="modal-body" style={{ paddingBottom: 12 }}>
      <form onSubmit={search} className="add-search-form">
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="输入6位企业密信号"
          value={q}
          inputMode="numeric"
          maxLength={6}
          onChange={e => { setQ(e.target.value.replace(/\D/g, '')); setResult(null); setAddMsg(''); }}
        />
        <button type="submit" className="btn-modal-confirm" style={{ flex: '0 0 72px' }} disabled={loading}>
          {loading ? '…' : '搜索'}
        </button>
      </form>

      {result === null && (
        <div className="add-search-hint">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="#e0e0e0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          <p>输入对方的6位企业密信号</p>
        </div>
      )}
      {result === false && <div className="add-search-hint"><p>未找到该用户</p></div>}
      {result && (
        <div className="add-results">
          <div className="add-result-row">
            <AvatarCircle name={result.display_name} color={result.avatar_color} url={result.avatar_url} size={44} radius={22} />
            <div className="add-result-info">
              <span className="add-result-name">{result.display_name}</span>
              <span className="add-result-sub">企业密信号：{result.user_code}</span>
            </div>
            <div className="add-result-action">
              {result.is_contact
                ? <span className="already-friend">已是好友</span>
                : addMsg
                  ? <span className={`add-msg-inline ${addMsg.includes('✓') ? 'ok' : 'err'}`}>{addMsg}</span>
                  : <button className="btn-add-inline" onClick={() => addFriend(result)}>添加</button>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddByScan({ api, onSelect, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const [err, setErr] = useState('');
  const [found, setFound] = useState(null);
  const [addMsg, setAddMsg] = useState('');

  useEffect(() => {
    let active = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
        requestAnimationFrame(function scan() {
          if (!active) return;
          const v = videoRef.current; const c = canvasRef.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            const decoded = jsQR(imgData.data, imgData.width, imgData.height);
            if (decoded?.data?.startsWith('wecom_code:')) {
              const code = decoded.data.replace('wecom_code:', '');
              active = false;
              stopStream();
              lookupCode(code);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(scan);
        });
      })
      .catch(() => setErr('无法访问摄像头，请检查权限或使用 HTTPS'));
    return () => { active = false; stopStream(); cancelAnimationFrame(rafRef.current); };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  async function lookupCode(code) {
    try {
      const u = await api(`/users/by-code/${code}`);
      setFound(u);
    } catch { setErr('未找到该二维码对应的用户'); }
  }

  async function addFriend(u) {
    try {
      await api('/users/friend-requests', { method: 'POST', body: { targetId: u.id } });
      setAddMsg('申请已发送 ✓');
    } catch (e) { setAddMsg(e.message); }
  }

  if (found) {
    return (
      <div className="modal-body" style={{ paddingBottom: 12 }}>
        <div className="scan-success-tip">✅ 扫描成功</div>
        <div className="add-results">
          <div className="add-result-row">
            <AvatarCircle name={found.display_name} color={found.avatar_color} url={found.avatar_url} size={44} radius={22} />
            <div className="add-result-info">
              <span className="add-result-name">{found.display_name}</span>
              <span className="add-result-sub">企业密信号：{found.user_code}</span>
            </div>
            <div className="add-result-action">
              {found.is_contact
                ? <span className="already-friend">已是好友</span>
                : addMsg
                  ? <span className={`add-msg-inline ${addMsg.includes('✓') ? 'ok' : 'err'}`}>{addMsg}</span>
                  : <button className="btn-add-inline" onClick={() => addFriend(found)}>添加</button>
              }
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-body">
      {err ? (
        <div className="scan-err">{err}</div>
      ) : (
        <>
          <div className="scan-viewport">
            <video ref={videoRef} playsInline muted className="scan-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="scan-frame">
              <span className="scan-corner tl" /><span className="scan-corner tr" />
              <span className="scan-corner bl" /><span className="scan-corner br" />
              <span className="scan-line" />
            </div>
          </div>
          <p className="scan-tip">将对方的企业密信二维码对准框内</p>
        </>
      )}
    </div>
  );
}

/* ── Contact Detail ───────────────────────────────────── */
function ContactDetail({ item, onChat }) {
  const { type, data } = item;
  const isGroup = type === 'group';
  const { contacts, api, fetchContacts, currentUser } = useStore();
  const [addMsg, setAddMsg] = useState('');

  const isAlreadyContact = contacts.some(c => c.id === data.id);
  const isSelf = data.id === currentUser?.id;

  async function addFriend() {
    try {
      await api('/users/friend-requests', { method: 'POST', body: { targetId: data.id } });
      setAddMsg('好友申请已发送 ✓');
    } catch (e) {
      setAddMsg(e.message);
      setTimeout(() => setAddMsg(''), 3000);
    }
  }

  return (
    <div className="detail-card">
      <div className="detail-avatar">
        <AvatarCircle name={isGroup ? data.name : data.display_name} color={data.avatar_color} size={72} radius={isGroup ? 16 : 36} />
      </div>
      <div className="detail-name">{isGroup ? data.name : data.display_name}</div>
      {isGroup && <div className="detail-position">{data.member_count}位成员</div>}

      <div className="detail-fields">
        {!isGroup && (
          <>
            <DetailRow label="ID" value={data.user_code || data.username || '-'} />
            <div className={`status-badge ${data.status === 'online' ? 'online' : 'offline'}`}>
              {data.status === 'online' ? '在线' : '离线'}
            </div>
          </>
        )}
        {isGroup && data.announcement && (
          <div className="detail-announcement">
            <span className="ann-label">群公告</span>
            <p>{data.announcement}</p>
          </div>
        )}
      </div>

      {addMsg && <div className="add-friend-msg">{addMsg}</div>}

      <div className="detail-btns">
        <button className="btn-chat" onClick={() => onChat(type, data)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          发消息
        </button>
        {!isGroup && !isSelf && !isAlreadyContact && (
          <button className="btn-add-friend" onClick={addFriend}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            添加好友
          </button>
        )}
        {!isGroup && !isSelf && isAlreadyContact && (
          <span className="already-friend">已是好友</span>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 80 80" width="80" height="80" fill="none">
        <circle cx="40" cy="40" r="40" fill="#f0f0f0"/>
        <path d="M40 20c-7.7 0-14 6.3-14 14s6.3 14 14 14 14-6.3 14-14-6.3-14-14-14zm0 4c5.5 0 10 4.5 10 10S45.5 44 40 44s-10-4.5-10-10 4.5-10 10-10zm0 28c-9.33 0-28 4.67-28 14v4h56v-4c0-9.33-18.67-14-28-14z" fill="#ccc"/>
      </svg>
      <p>选择联系人查看详情</p>
    </div>
  );
}

function ContactItem({ u, active, onClick, onLongPress }) {
  const lp = useLongPress(onLongPress);
  return (
    <div className={`contact-item ${active ? 'active' : ''}`} onClick={onClick} {...lp}>
      <div style={{ position: 'relative' }}>
        <AvatarCircle name={u.display_name} color={u.avatar_color} size={38} radius={19} />
        <span className={`status-dot-sm ${u.status === 'online' ? 'online' : ''}`} />
      </div>
      <div className="contact-info">
        <span className="contact-name">{u.display_name}</span>
      </div>
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
      </div>
    </div>
  );
}
