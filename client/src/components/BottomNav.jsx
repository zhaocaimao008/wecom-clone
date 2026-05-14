import React from 'react';
import { useStore } from '../store/useStore';

export default function BottomNav() {
  const { activeTab, setActiveTab, conversations, friendRequestCount } = useStore();
  const totalUnread = conversations.reduce((n, c) => n + (c.unread_count || 0), 0);

  return (
    <nav className="bottom-nav">
      {/* 消息 */}
      <button
        className={`bnav-btn ${activeTab === 'messages' ? 'active' : ''}`}
        onClick={() => setActiveTab('messages')}
      >
        <span className="bnav-icon-wrap">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
          </svg>
          {totalUnread > 0 && (
            <span className="bnav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
          )}
        </span>
        <span className="bnav-label">消息</span>
      </button>

      {/* 通讯录 */}
      <button
        className={`bnav-btn ${activeTab === 'contacts' ? 'active' : ''}`}
        onClick={() => setActiveTab('contacts')}
      >
        <span className="bnav-icon-wrap">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
          </svg>
          {friendRequestCount > 0 && <span className="bnav-dot" />}
        </span>
        <span className="bnav-label">通讯录</span>
      </button>

      {/* 群组 */}
      <button
        className={`bnav-btn ${activeTab === 'groups' ? 'active' : ''}`}
        onClick={() => setActiveTab('groups')}
      >
        <span className="bnav-icon-wrap">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
          </svg>
        </span>
        <span className="bnav-label">群组</span>
      </button>

      {/* 我 */}
      <button
        className={`bnav-btn ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => setActiveTab('profile')}
      >
        <span className="bnav-icon-wrap">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
        </span>
        <span className="bnav-label">我的</span>
      </button>

      {/* 设置 */}
      <button
        className={`bnav-btn ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => setActiveTab('settings')}
      >
        <span className="bnav-icon-wrap">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </span>
        <span className="bnav-label">设置</span>
      </button>
    </nav>
  );
}
