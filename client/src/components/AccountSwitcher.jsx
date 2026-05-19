import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';
import QrLoginModal from './QrLoginModal';

const MAX_ACCOUNTS = 15;

export default function AccountSwitcher() {
  const {
    accounts, activeAccountIdx, currentUser,
    switchAccount, removeAccount, showAddAccountModal,
    accountUnreads,
  } = useStore(s => ({
    accounts:          s.accounts,
    activeAccountIdx:  s.activeAccountIdx,
    currentUser:       s.currentUser,
    switchAccount:     s.switchAccount,
    removeAccount:     s.removeAccount,
    showAddAccountModal: s.showAddAccountModal,
    accountUnreads:    s.accountUnreads,
  }));

  const [addMenu, setAddMenu]   = useState(false);  // "+ 按钮弹出的选择菜单
  const [showQr, setShowQr]     = useState(false);  // QR 扫码弹窗
  const [ctxMenu, setCtxMenu]   = useState(null);   // { idx, x, y }
  const addMenuRef  = useRef(null);
  const ctxMenuRef  = useRef(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!addMenu && !ctxMenu) return;
    const close = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenu(false);
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addMenu, ctxMenu]);

  function handleSwitch(idx) {
    if (idx !== activeAccountIdx) switchAccount(idx);
  }

  function handleRightClick(e, idx) {
    e.preventDefault();
    const menuW = 140, menuH = idx === activeAccountIdx ? 48 : 88;
    setCtxMenu({
      idx,
      x: Math.min(e.clientX, window.innerWidth  - menuW - 8),
      y: Math.min(e.clientY, window.innerHeight - menuH - 8),
    });
  }

  async function handleRemove(idx) {
    setCtxMenu(null);
    const name = accounts[idx]?.user?.display_name || '该账户';
    if (!await useStore.getState().showConfirm(`确认退出「${name}」账号？`)) return;
    removeAccount(idx);
  }

  function handleAddPassword() {
    setAddMenu(false);
    showAddAccountModal();
  }

  function handleAddQr() {
    setAddMenu(false);
    setShowQr(true);
  }

  return (
    <>
      <div className="account-rail">
        {/* 账号头像列表 */}
        {accounts.map((acc, idx) => {
          const isActive  = idx === activeAccountIdx;
          const unread    = accountUnreads[idx] || 0;
          return (
            <div
              key={idx}
              className={`rail-item ${isActive ? 'rail-item-active' : ''}`}
              onClick={() => handleSwitch(idx)}
              onContextMenu={e => handleRightClick(e, idx)}
              title={acc.user?.display_name || '账号'}
            >
              {isActive && <span className="rail-active-bar" />}
              <AvatarCircle
                name={acc.user?.display_name}
                color={acc.user?.avatar_color}
                url={acc.user?.avatar_url}
                size={38} radius={10}
              />
              {unread > 0 && (
                <span className="rail-badge">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
          );
        })}

        {/* 添加账号按钮 */}
        {accounts.length < MAX_ACCOUNTS && (
          <div className="rail-add-wrap" ref={addMenuRef}>
            <button
              className="rail-add-btn"
              title="添加账号"
              onClick={() => setAddMenu(v => !v)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>

            {addMenu && (
              <div className="rail-add-menu">
                <button className="rail-add-menu-item" onClick={handleAddPassword}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                  </svg>
                  账号密码登录
                </button>
                <button className="rail-add-menu-item" onClick={handleAddQr}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM17 17h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2zM13 19h2v2h-2z"/>
                  </svg>
                  扫码登录
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="rail-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          {ctxMenu.idx !== activeAccountIdx && (
            <button onClick={() => { setCtxMenu(null); handleSwitch(ctxMenu.idx); }}>
              切换到此账号
            </button>
          )}
          <button className="rail-ctx-danger" onClick={() => handleRemove(ctxMenu.idx)}>
            退出此账号
          </button>
        </div>
      )}

      {/* 扫码登录弹窗 */}
      {showQr && <QrLoginModal onClose={() => setShowQr(false)} />}
    </>
  );
}
