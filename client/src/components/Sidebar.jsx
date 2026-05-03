import React from 'react';
import { useStore } from '../store/useStore';
import AccountSwitcher from './AccountSwitcher';

const NAV = [
  {
    id: 'messages',
    label: '消息',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
      </svg>
    ),
  },
  {
    id: 'contacts',
    label: '通讯录',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const { activeTab, setActiveTab, logout, conversations, friendRequestCount } = useStore();

  const totalUnread = conversations.reduce((n, c) => n + (c.unread_count || 0), 0);

  return (
    <div className="sidebar">
      <AccountSwitcher />

      <nav className="sidebar-nav">
        {NAV.map(n => (
          <button
            key={n.id}
            className={`nav-btn ${activeTab === n.id ? 'active' : ''}`}
            onClick={() => setActiveTab(n.id)}
            title={n.label}
          >
            {n.icon}
            {n.id === 'messages' && totalUnread > 0 && (
              <span className="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
            )}
            {n.id === 'contacts' && friendRequestCount > 0 && (
              <span className="nav-badge">{friendRequestCount > 99 ? '99+' : friendRequestCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button
          className={`nav-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
          title="我"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
        </button>
        <button className="nav-btn" onClick={logout} title="退出登录">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
          </svg>
        </button>
      </div>
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
