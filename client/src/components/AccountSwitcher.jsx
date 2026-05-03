import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

const MAX_ACCOUNTS = 15;

export default function AccountSwitcher() {
  const { accounts, activeAccountIdx, currentUser, switchAccount, removeAccount, showAddAccountModal } = useStore(s => ({
    accounts: s.accounts,
    activeAccountIdx: s.activeAccountIdx,
    currentUser: s.currentUser,
    switchAccount: s.switchAccount,
    removeAccount: s.removeAccount,
    showAddAccountModal: s.showAddAccountModal,
  }));
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (!panelRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleSwitch(idx) {
    if (idx === activeAccountIdx) return;
    switchAccount(idx);
    setOpen(false);
  }

  function handleRemove(e, idx) {
    e.stopPropagation();
    const name = accounts[idx]?.user?.display_name || '该账户';
    if (!confirm(`确认退出「${name}」？`)) return;
    removeAccount(idx);
  }

  function handleAddAccount() {
    if (accounts.length >= MAX_ACCOUNTS) {
      alert(`最多同时登录 ${MAX_ACCOUNTS} 个账户`);
      return;
    }
    setOpen(false);
    showAddAccountModal();
  }

  return (
    <div className="account-switcher" ref={panelRef}>
      <div
        className="sidebar-avatar account-avatar-trigger"
        title={`${currentUser?.display_name}（点击切换账户）`}
        onClick={() => setOpen(v => !v)}
      >
        <AvatarCircle
          name={currentUser?.display_name}
          color={currentUser?.avatar_color}
          url={currentUser?.avatar_url}
          size={36}
          radius={8}
        />
        {accounts.length > 1 && (
          <span className="account-count-badge">{accounts.length}</span>
        )}
      </div>

      {open && (
        <div className="account-panel">
          <div className="account-panel-header">账户管理</div>
          <div className="account-panel-list">
            {accounts.map((acc, idx) => (
              <div
                key={idx}
                className={`account-item ${idx === activeAccountIdx ? 'active' : ''}`}
                onClick={() => handleSwitch(idx)}
              >
                <AvatarCircle
                  name={acc.user?.display_name}
                  color={acc.user?.avatar_color}
                  url={acc.user?.avatar_url}
                  size={36}
                  radius={8}
                />
                <div className="account-item-info">
                  <div className="account-item-name">{acc.user?.display_name}</div>
                  <div className="account-item-sub">{acc.user?.username}</div>
                </div>
                {idx === activeAccountIdx && (
                  <span className="account-active-dot" title="当前账户" />
                )}
                <button
                  className="account-remove-btn"
                  title="退出该账户"
                  onClick={e => handleRemove(e, idx)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {accounts.length < MAX_ACCOUNTS && (
            <button className="account-add-btn" onClick={handleAddAccount}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              添加账户
              <span className="account-add-limit">{accounts.length}/{MAX_ACCOUNTS}</span>
            </button>
          )}
          {accounts.length >= MAX_ACCOUNTS && (
            <div className="account-limit-tip">已达到最多 {MAX_ACCOUNTS} 个账户上限</div>
          )}
        </div>
      )}
    </div>
  );
}
