import React from 'react';
import { useStore } from '../store/useStore';

const NAV = [
  {
    id: 'profile',
    label: '我的',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    ),
  },
  {
    id: 'messages',
    label: '消息',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
      </svg>
    ),
    badge: 'unread',
  },
  {
    id: 'contacts',
    label: '通讯录',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    ),
    badge: 'friend-requests',
  },
  {
    id: 'groups',
    label: '群组',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    label: '设置',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const { activeTab, setActiveTab, conversations, friendRequestCount } = useStore();
  const totalUnread = conversations.reduce((n, c) => n + (c.unread_count || 0), 0);

  return (
    <div className="sidebar">
      <nav className="sidebar-nav">
        {NAV.map(n => (
          <button
            key={n.id}
            className={`nav-btn ${activeTab === n.id ? 'active' : ''}`}
            onClick={() => setActiveTab(n.id)}
            title={n.label}
          >
            <span className="nav-btn-icon">
              {n.icon}
              {n.badge === 'unread' && totalUnread > 0 && (
                <span className="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
              )}
              {n.badge === 'friend-requests' && friendRequestCount > 0 && (
                <span className="nav-badge">{friendRequestCount > 99 ? '99+' : friendRequestCount}</span>
              )}
            </span>
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
      </nav>

    </div>
  );
}

export function AvatarCircle({ name, color, url, size = 40, radius = 6 }) {
  const initial = name ? name.slice(-2) : '?';
  if (url) {
    return (
      <div style={{
        width: size, height: size, borderRadius: radius,
        flexShrink: 0, overflow: 'hidden', background: color || '#07c160',
      }}>
        <img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: color || '#07c160',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.38, fontWeight: 500,
      flexShrink: 0, userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}
