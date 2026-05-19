import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

export default function CreateGroupModal({ onClose }) {
  const { departments, api, fetchConversations, fetchContacts } = useStore();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allUsers = Object.values(departments).flat();
  const allSelected = allUsers.length > 0 && allUsers.every(u => selected.has(u.id));

  function toggle(id) {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allUsers.map(u => u.id)));
    }
  }

  async function create() {
    if (!name.trim()) return setError('请输入群名称');
    if (selected.size === 0) return setError('请至少选择 1 位成员');
    setLoading(true); setError('');
    try {
      await api('/groups', { method: 'POST', body: { name: name.trim(), memberIds: [...selected] } });
      await Promise.all([fetchConversations(), fetchContacts()]);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>发起群聊</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-field">
            <input
              autoFocus
              placeholder="群聊名称（必填）"
              value={name}
              onChange={e => setName(e.target.value)}
              className="modal-input"
            />
          </div>

          <div className="modal-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>选择成员（{selected.size} 人已选）</span>
            {allUsers.length > 0 && (
              <button onClick={toggleAll} style={{
                padding: '3px 10px', borderRadius: 6, border: '1px solid #07c160',
                background: allSelected ? '#07c160' : 'transparent',
                color: allSelected ? '#fff' : '#07c160',
                fontSize: 12, cursor: 'pointer',
              }}>
                {allSelected ? '取消全选' : '全选好友'}
              </button>
            )}
          </div>

          <div className="modal-member-list">
            {allUsers.map(u => (
              <label key={u.id} className="modal-member-item">
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <AvatarCircle name={u.display_name} color={u.avatar_color} size={34} radius={17} />
                <div className="modal-member-info">
                  <span className="modal-member-name">{u.display_name}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-footer">
          <button className="btn-modal-cancel" onClick={onClose}>取消</button>
          <button className="btn-modal-confirm" onClick={create} disabled={loading}>
            {loading ? '创建中...' : '创建群聊'}
          </button>
        </div>
      </div>
    </div>
  );
}
