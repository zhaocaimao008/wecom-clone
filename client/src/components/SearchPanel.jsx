import React, { useState, useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import dayjs from 'dayjs';

function highlight(text, q) {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#07c16033', color: 'inherit', padding: 0 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default function SearchPanel({ onClose }) {
  const [q, setQ]           = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef(null);

  const doSearch = useCallback(async (keyword) => {
    if (!keyword.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const data = await useStore.getState().api(`/messages/search?q=${encodeURIComponent(keyword)}&limit=30`);
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQ(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 400);
  }

  function jumpTo(r) {
    const conv = {
      type: r.conv_group_id ? 'group' : 'private',
      id:   r.conv_group_id || r.conv_peer_id,
      name: r.conv_name,
      avatarColor: r.group_color || r.sender_color,
    };
    useStore.getState().fetchMessages(conv, r.id);
    onClose();
  }

  return (
    <div className="search-panel-overlay" onClick={onClose}>
      <div className="search-panel" onClick={e => e.stopPropagation()}>
        <div className="search-panel-header">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#999">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            autoFocus
            className="search-panel-input"
            placeholder="搜索聊天记录..."
            value={q}
            onChange={handleChange}
          />
          <button className="search-panel-close" onClick={onClose}>✕</button>
        </div>

        <div className="search-panel-results">
          {loading && <div className="search-empty">搜索中…</div>}
          {!loading && searched && results.length === 0 && (
            <div className="search-empty">没有找到相关消息</div>
          )}
          {!loading && results.map(r => (
            <div key={r.id} className="search-result-item" onClick={() => jumpTo(r)}>
              <div className="search-result-conv">
                {r.conv_group_id ? '群聊 · ' : ''}{r.conv_name}
                <span className="search-result-time">{dayjs(r.created_at).format('MM/DD HH:mm')}</span>
              </div>
              <div className="search-result-sender">{r.sender_name}</div>
              <div className="search-result-content">
                {highlight(r.content?.slice(0, 120), q)}
              </div>
            </div>
          ))}
          {!searched && (
            <div className="search-empty">输入关键词搜索</div>
          )}
        </div>
      </div>
    </div>
  );
}
