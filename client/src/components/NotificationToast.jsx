import React from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

export default function NotificationToast() {
  const { toasts, removeToast, fetchMessages, setActiveTab, contacts, groups } = useStore();

  function navigate(toast) {
    removeToast(toast.id);
    if (toast.convType === 'private') {
      const c = contacts.find(x => x.id === toast.convId);
      fetchMessages({
        type: 'private', id: toast.convId,
        name: c?.display_name || toast.senderName,
        avatarColor: c?.avatar_color || toast.senderColor,
      });
    } else {
      const g = groups.find(x => x.id === toast.convId);
      fetchMessages({
        type: 'group', id: toast.convId,
        name: g?.name || '群聊',
        avatarColor: g?.avatar_color || '#07c160',
      });
    }
    setActiveTab('messages');
  }

  if (!toasts.length) return null;

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className="toast-item" onClick={() => navigate(t)}>
          <AvatarCircle name={t.senderName} color={t.senderColor || '#07c160'} size={36} radius={18} />
          <div className="toast-content">
            <div className="toast-title">{t.title}</div>
            <div className="toast-body">{t.body || ' '}</div>
          </div>
          <button className="toast-close" onClick={e => { e.stopPropagation(); removeToast(t.id); }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
