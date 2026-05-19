import React, { useState } from 'react';
import { AvatarCircle } from './Sidebar';

export default function ForwardModal({ contacts, groups, msgCount = 1, onClose, onConfirm }) {
  const [tab, setTab] = useState('contacts');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());

  const list = tab === 'contacts'
    ? contacts.filter(c => !search || c.display_name?.includes(search)).map(c => ({ id: c.id, type: 'private', name: c.display_name, color: c.avatar_color }))
    : groups.filter(g => !search || g.name?.includes(search)).map(g => ({ id: g.id, type: 'group', name: g.name, color: g.avatar_color }));

  const allSelected = list.length > 0 && list.every(item => selected.has(item.id));

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(list.map(item => item.id)));
    }
  }

  function handleConfirm() {
    const targets = list.filter(item => selected.has(item.id));
    if (!targets.length) return;
    onConfirm(targets);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 360 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>转发{msgCount > 1 ? ` ${msgCount} 条消息` : ''}给…</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => { setTab('contacts'); setSearch(''); setSelected(new Set()); }}
              style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === 'contacts' ? '#07c160' : '#f0f0f0',
                color: tab === 'contacts' ? '#fff' : '#333', fontWeight: tab === 'contacts' ? 600 : 400 }}>
              好友
            </button>
            <button
              onClick={() => { setTab('groups'); setSearch(''); setSelected(new Set()); }}
              style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === 'groups' ? '#07c160' : '#f0f0f0',
                color: tab === 'groups' ? '#fff' : '#333', fontWeight: tab === 'groups' ? 600 : 400 }}>
              群组
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input className="modal-input" placeholder="搜索" style={{ flex: 1 }}
              value={search} onChange={e => setSearch(e.target.value)} />
            <button onClick={toggleAll}
              style={{ flexShrink: 0, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd',
                background: allSelected ? '#07c160' : '#f0f0f0',
                color: allSelected ? '#fff' : '#333', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {allSelected ? '取消全选' : `全选${tab === 'contacts' ? '好友' : '群组'}`}
            </button>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {list.length === 0 && (
              <div style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>暂无{tab === 'contacts' ? '好友' : '群组'}</div>
            )}
            {list.map(item => (
              <label key={item.id} className="modal-member-item" style={{ cursor: 'pointer', padding: '7px 4px' }}>
                <input type="checkbox" checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)} style={{ marginRight: 8 }} />
                <AvatarCircle name={item.name} color={item.color} size={34} radius={17} />
                <span style={{ marginLeft: 8, fontSize: 14 }}>{item.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}
            style={{ padding: '7px 20px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={handleConfirm} disabled={!selected.size}
            style={{ padding: '7px 20px', borderRadius: 6, border: 'none', cursor: selected.size ? 'pointer' : 'not-allowed',
              background: selected.size ? '#07c160' : '#ccc', color: '#fff', fontWeight: 600 }}>
            转发{selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
