import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

function Toggle({ checked, onChange, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'toggle-disabled' : ''}`} onClick={e => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="toggle-slider" />
    </label>
  );
}

export default function GroupManagePanel({ groupId, members, onClose, onMembersChanged }) {
  const { currentUser, departments, api, fetchConversations, fetchContacts, clearMessages, activeConv, groups, token, fetchMessages, setActiveTab, showConfirm } = useStore();
  const [tab, setTab] = useState('members');
  const [editName, setEditName] = useState('');
  const [editAnn, setEditAnn] = useState(null); // null = unchanged
  const [showAdd, setShowAdd] = useState(false);
  const [addSelected, setAddSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [mutingMember, setMutingMember] = useState(null); // { id, display_name }
  const avatarFileRef = useRef(null);

  const myMember = members.find(m => m.id === currentUser?.id);
  const myRole = myMember?.role;
  const isOwner = myRole === 'owner';
  const isPrivileged = myRole === 'owner' || myRole === 'admin';

  const groupInfo = groups.find(g => g.id === groupId) || {};

  const memberIds = new Set(members.map(m => m.id));
  const allUsers = Object.values(departments).flat().filter(u => !memberIds.has(u.id));

  function flash(text) { setMsg(text); setTimeout(() => setMsg(''), 2500); }

  async function kickMember(userId) {
    if (!await showConfirm('确认移出该成员？')) return;
    try {
      await api(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
      onMembersChanged(); flash('已移出');
    } catch (e) { flash(e.message); }
  }

  async function setRole(userId, role) {
    try {
      await api(`/groups/${groupId}/members/${userId}/role`, { method: 'PUT', body: { role } });
      onMembersChanged();
      flash(role === 'admin' ? '已设为管理员' : '已取消管理员');
    } catch (e) { flash(e.message); }
  }

  async function toggleMute(member) {
    const isMuted = member.muted_until != null && (member.muted_until === 0 || member.muted_until > Date.now());
    if (isMuted) {
      try {
        await api(`/groups/${groupId}/members/${member.id}/mute`, { method: 'PUT', body: { mute_duration: -1 } });
        onMembersChanged(); flash('已解除禁言');
      } catch (e) { flash(e.message); }
    } else {
      setMutingMember(member);
    }
  }

  async function applyMute(duration, label) {
    if (!mutingMember) return;
    const member = mutingMember;
    setMutingMember(null);
    try {
      await api(`/groups/${groupId}/members/${member.id}/mute`, { method: 'PUT', body: { mute_duration: duration } });
      onMembersChanged(); flash(`已禁言 ${label}`);
    } catch (e) { flash(e.message); }
  }

  async function addMembers() {
    if (!addSelected.size) return;
    setSaving(true);
    try {
      await api(`/groups/${groupId}/members`, { method: 'POST', body: { userIds: [...addSelected] } });
      onMembersChanged();
      setAddSelected(new Set());
      setShowAdd(false);
      flash(`已添加 ${addSelected.size} 位成员`);
    } catch (e) { flash(e.message); }
    setSaving(false);
  }

  async function toggleSetting(field, value) {
    try {
      await api(`/groups/${groupId}`, { method: 'PUT', body: { [field]: value } });
      flash(value ? '已开启' : '已关闭');
    } catch (e) { flash(e.message); }
  }

  async function handleGroupAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const res = await fetch(`/api/groups/${groupId}/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        useStore.getState().handleGroupUpdated(data);
        flash('群头像已更新');
      } else {
        flash(data.error || '上传失败');
      }
    } catch { flash('上传失败'); }
    finally { setUploadingAvatar(false); e.target.value = ''; }
  }

  async function saveSettings() {
    setSaving(true); setMsg('');
    try {
      await api(`/groups/${groupId}`, {
        method: 'PUT',
        body: {
          name: editName || activeConv?.name,
          ...(editAnn !== null ? { announcement: editAnn } : {}),
        },
      });
      await Promise.all([fetchConversations(), fetchContacts()]);
      flash('保存成功');
    } catch (e) { flash(e.message); }
    setSaving(false);
  }

  async function dissolveGroup() {
    if (!await showConfirm('确认解散该群？此操作不可恢复！')) return;
    try {
      await api(`/groups/${groupId}`, { method: 'DELETE' });
      await Promise.all([fetchConversations(), fetchContacts()]);
      onClose();
    } catch (e) { flash(e.message); }
  }

  async function clearGroupMessages() {
    if (!await showConfirm('确认清空全部群消息？所有成员都将看不到历史消息，此操作不可恢复！')) return;
    try {
      await api('/messages/clear-conversation', { method: 'DELETE', body: { groupId } });
      clearMessages();
      flash('消息已清空');
    } catch (e) { flash(e.message); }
  }

  function openPrivateChat(member) {
    onClose();
    fetchMessages({ type: 'private', id: member.id, name: member.display_name, avatarColor: member.avatar_color });
    setActiveTab('messages');
  }

  async function quitGroup() {
    if (!await showConfirm('确认退出该群？')) return;
    try {
      await api(`/groups/${groupId}/quit`, { method: 'POST' });
      await Promise.all([fetchConversations(), fetchContacts()]);
      onClose();
    } catch (e) { flash(e.message); }
  }

  async function transferOwner(userId, name) {
    if (!await showConfirm(`确认将群主转让给「${name}」？转让后你将成为普通成员。`)) return;
    try {
      await api(`/groups/${groupId}/transfer`, { method: 'POST', body: { newOwnerId: userId } });
      onMembersChanged();
      flash('群主已转让');
    } catch (e) { flash(e.message); }
  }

  return (
    <div className="gm-panel">
      <div className="gm-header">
        <div className="gm-tabs">
          <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
            成员 {members.length}
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            群管理
          </button>
        </div>
        <button className="gm-close" onClick={onClose}>✕</button>
      </div>

      {/* ── Members tab ── */}
      {tab === 'members' && (
        <div className="gm-body">
          {isPrivileged && (
            <button className="gm-add-btn" onClick={() => setShowAdd(v => !v)}>
              <span>＋</span> 添加成员
            </button>
          )}

          {showAdd && (
            <div className="gm-add-panel">
              <div className="gm-add-list">
                {allUsers.length === 0
                  ? <p className="gm-empty">所有用户已在群内</p>
                  : allUsers.map(u => (
                    <label key={u.id} className="modal-member-item">
                      <input type="checkbox" checked={addSelected.has(u.id)} onChange={() => {
                        setAddSelected(s => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; });
                      }} />
                      <AvatarCircle name={u.display_name} color={u.avatar_color} size={28} radius={14} />
                      <span style={{ fontSize: 13 }}>{u.display_name}</span>
                    </label>
                  ))
                }
              </div>
              {addSelected.size > 0 && (
                <button className="btn-modal-confirm" style={{ width: '100%', marginTop: 6 }}
                  onClick={addMembers} disabled={saving}>
                  {saving ? '添加中...' : `添加 ${addSelected.size} 人`}
                </button>
              )}
            </div>
          )}

          <div className="gm-member-list">
            {members.map(m => (
              <div key={m.id} className="gm-member-row">
                <div style={{ position: 'relative' }}>
                  <AvatarCircle name={m.display_name} color={m.avatar_color} size={34} radius={17} />
                  <span className={`status-dot-sm ${m.status === 'online' ? 'online' : ''}`} />
                </div>
                <div className="gm-member-info">
                  <span className="gm-member-name">{m.display_name}</span>
                </div>

                <div className="gm-member-actions">
                  {m.role === 'owner' && <span className="role-tag owner">群主</span>}
                  {m.role === 'admin' && <span className="role-tag admin">管理员</span>}

                  {/* Owner can promote/demote admins */}
                  {isOwner && m.role === 'member' && m.id !== currentUser?.id && (
                    <button className="gm-role-btn" onClick={() => setRole(m.id, 'admin')}>设管理</button>
                  )}
                  {isOwner && m.role === 'admin' && (
                    <button className="gm-role-btn demote" onClick={() => setRole(m.id, 'member')}>取消管理</button>
                  )}

                  {/* Admin/owner can open private chat with any member */}
                  {isPrivileged && m.id !== currentUser?.id && (
                    <button className="gm-role-btn" onClick={() => openPrivateChat(m)}>私聊</button>
                  )}

                  {/* Owner can transfer ownership */}
                  {isOwner && m.id !== currentUser?.id && (
                    <button className="gm-role-btn" style={{ color: '#fa9d3b', borderColor: '#fad9a0' }}
                      onClick={() => transferOwner(m.id, m.display_name)}>转让</button>
                  )}

                  {/* Owner/admin can mute members */}
                  {isPrivileged && m.role === 'member' && m.id !== currentUser?.id && (() => {
                    const isMuted = m.muted_until != null && (m.muted_until === 0 || m.muted_until > Date.now());
                    return (
                      <button className="gm-role-btn" style={isMuted ? { color: '#07c160', borderColor: '#07c160' } : { color: '#fa4b4b', borderColor: '#fca5a5' }}
                        onClick={() => toggleMute(m)}>
                        {isMuted ? '解禁' : '禁言'}
                      </button>
                    );
                  })()}
                  {/* Owner can also mute admins */}
                  {isOwner && m.role === 'admin' && m.id !== currentUser?.id && (() => {
                    const isMuted = m.muted_until != null && (m.muted_until === 0 || m.muted_until > Date.now());
                    return (
                      <button className="gm-role-btn" style={isMuted ? { color: '#07c160', borderColor: '#07c160' } : { color: '#fa4b4b', borderColor: '#fca5a5' }}
                        onClick={() => toggleMute(m)}>
                        {isMuted ? '解禁' : '禁言'}
                      </button>
                    );
                  })()}

                  {/* Owner/admin can kick members (admin can't kick admin) */}
                  {isPrivileged && m.role === 'member' && m.id !== currentUser?.id && (
                    <button className="gm-kick-btn" onClick={() => kickMember(m.id)}>移出</button>
                  )}
                  {isOwner && m.role === 'admin' && (
                    <button className="gm-kick-btn" onClick={() => kickMember(m.id)}>移出</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Settings tab ── */}
      {tab === 'settings' && (
        <div className="gm-body">
          {/* ── Group avatar upload (owner/admin) ── */}
          {isPrivileged && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => avatarFileRef.current?.click()} title="点击更换群头像">
                <AvatarCircle
                  name={activeConv?.name}
                  color={groupInfo.avatar_color}
                  url={groupInfo.avatar_url}
                  size={54} radius={12}
                />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-main, #111)' }}>{activeConv?.name}</div>
                <button
                  className="avatar-upload-btn"
                  style={{ marginTop: 4, fontSize: 12, padding: '3px 10px' }}
                  disabled={uploadingAvatar}
                  onClick={() => avatarFileRef.current?.click()}
                >
                  {uploadingAvatar ? '上传中...' : '更换群头像'}
                </button>
              </div>
              <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleGroupAvatarFile} />
            </div>
          )}

          {/* ── Group info (owner only: rename; owner+admin: announcement) ── */}
          {isOwner && (
            <div className="gm-field">
              <label>群名称</label>
              <input defaultValue={activeConv?.name} onChange={e => setEditName(e.target.value)}
                placeholder="修改群名称" className="gm-input" />
            </div>
          )}
          {isPrivileged && (
            <div className="gm-field">
              <label>群公告</label>
              <textarea
                value={editAnn !== null ? editAnn : (groupInfo.announcement || '')}
                onChange={e => setEditAnn(e.target.value)}
                placeholder="编辑群公告..." rows={3} className="gm-input" />
            </div>
          )}
          {isPrivileged && (
            <button className="btn-modal-confirm" style={{ width: '100%' }}
              onClick={saveSettings} disabled={saving}>
              {saving ? '保存中...' : '保存修改'}
            </button>
          )}

          {/* ── Group ID & QR (owner/admin) ── */}
          {isPrivileged && (
            <GroupIdQR groupId={groupId} groupCode={groupInfo.group_code} groupName={activeConv?.name} />
          )}

          {/* ── Restriction toggles (owner/admin) ── */}
          {isPrivileged && (
            <div className="gm-restrictions">
              <div className="restrict-title">群限制设置</div>

              <div className="restrict-row">
                <div className="restrict-info">
                  <span className="restrict-label">全员禁言</span>
                  <span className="restrict-desc">开启后仅群主/管理员可发言</span>
                </div>
                <Toggle
                  checked={!!groupInfo.mute_all}
                  onChange={e => toggleSetting('mute_all', e.target.checked)}
                />
              </div>

              <div className="restrict-row">
                <div className="restrict-info">
                  <span className="restrict-label">禁止互加好友</span>
                  <span className="restrict-desc">开启后成员间无法互加好友</span>
                </div>
                <Toggle
                  checked={!!groupInfo.restrict_add_friend}
                  onChange={e => toggleSetting('restrict_add_friend', e.target.checked)}
                />
              </div>

              <div className="restrict-row">
                <div className="restrict-info">
                  <span className="restrict-label">禁止私聊</span>
                  <span className="restrict-desc">开启后成员间无法私聊</span>
                </div>
                <Toggle
                  checked={!!groupInfo.restrict_private_chat}
                  onChange={e => toggleSetting('restrict_private_chat', e.target.checked)}
                />
              </div>
            </div>
          )}

          {isPrivileged && (
            <button className="btn-dissolve" style={{ color: '#fa9d3b', borderColor: '#fad9a0', background: '#fff9ef', marginBottom: 8 }}
              onClick={clearGroupMessages}>清空群消息</button>
          )}
          {isOwner
            ? <button className="btn-dissolve" onClick={dissolveGroup}>解散群聊</button>
            : <button className="btn-dissolve" style={{ color: '#576b95', borderColor: '#c5cfe0', background: '#f0f3fa' }}
                onClick={quitGroup}>退出群聊</button>
          }

          {!isPrivileged && (
            <p style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 8 }}>
              仅群主/管理员可修改设置
            </p>
          )}
        </div>
      )}

      {msg && <div className="gm-msg">{msg}</div>}

      {/* 禁言时长选择弹窗 */}
      {mutingMember && (
        <div className="modal-overlay" onClick={() => setMutingMember(null)}>
          <div className="modal-box" style={{ maxWidth: 280 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>禁言「{mutingMember.display_name}」</div>
            {[['10分钟', 10], ['1小时', 60], ['8小时', 480], ['24小时', 1440], ['永久', 0]].map(([label, dur]) => (
              <button key={label}
                style={{ display: 'block', width: '100%', padding: '10px 0', marginBottom: 8,
                  border: '1px solid #e5e5e5', borderRadius: 8, background: '#fff',
                  cursor: 'pointer', fontSize: 14 }}
                onClick={() => applyMute(dur, label)}
              >{label}</button>
            ))}
            <button
              style={{ display: 'block', width: '100%', padding: '10px 0',
                border: 'none', borderRadius: 8, background: '#f5f5f5',
                cursor: 'pointer', fontSize: 14, color: '#888' }}
              onClick={() => setMutingMember(null)}
            >取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupIdQR({ groupId, groupCode, groupName }) {
  const [qrUrl, setQrUrl] = useState('');
  const [showBig, setShowBig] = useState(false);
  const [bigUrl, setBigUrl] = useState('');
  const displayCode = groupCode || String(groupId);

  useEffect(() => {
    if (!displayCode) return;
    QRCode.toDataURL(`mixin_group:${displayCode}`, { width: 72, margin: 1, color: { dark: '#000', light: '#fff' } })
      .then(setQrUrl).catch(() => {});
  }, [displayCode]);

  function openBig() {
    QRCode.toDataURL(`mixin_group:${displayCode}`, { width: 280, margin: 2 })
      .then(url => { setBigUrl(url); setShowBig(true); }).catch(() => {});
  }

  return (
    <>
      <div className="gm-id-qr-row">
        <div className="gm-id-block">
          <span className="gm-id-label">群ID</span>
          <span className="gm-id-value">{displayCode}</span>
        </div>
        {qrUrl && (
          <div className="profile-qr-wrap" onClick={openBig} title="查看群二维码" style={{ cursor: 'pointer' }}>
            <img src={qrUrl} alt="群二维码" className="profile-qr-img" />
            <span className="profile-qr-hint">群二维码</span>
          </div>
        )}
      </div>

      {showBig && (
        <div className="modal-overlay" onClick={() => setShowBig(false)}>
          <div className="modal-box qr-big-box" onClick={e => e.stopPropagation()}>
            <div className="qr-big-header">
              <span>{groupName}的二维码</span>
              <button className="modal-close" onClick={() => setShowBig(false)}>✕</button>
            </div>
            <div className="qr-big-body">
              <img src={bigUrl} alt="群二维码" className="qr-big-img" />
              <p className="qr-big-code">群ID：{displayCode}</p>
              <p className="qr-big-tip">扫一扫上面的二维码，加入该群</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
