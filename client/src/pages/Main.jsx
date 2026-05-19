import React, { useEffect, useRef, Suspense, lazy, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { connectSocket, disconnectSocket } from '../socket';
import { usePushNotification, usePushNavigation } from '../hooks/usePushNotification';
import AccountSwitcher from '../components/AccountSwitcher';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import ChatPanel from '../components/ChatPanel';
import NotificationToast from '../components/NotificationToast';
import TitleBar from '../components/TitleBar';

// 懒加载：首屏不需要的重量级面板
const ContactPanel   = lazy(() => import('../components/ContactPanel'));
const GroupsPanel    = lazy(() => import('../components/GroupsPanel'));
const Profile        = lazy(() => import('../components/Profile'));
const CallScreen     = lazy(() => import('../components/CallScreen'));

function PanelFallback() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>加载中…</div>;
}

export default function Main() {
  const {
    token, activeTab, activeConv, accountSwitching,
    accounts, activeAccountIdx,
    fetchConversations, fetchContacts, fetchFriendRequests,
  } = useStore();
  const inChat = activeTab === 'messages' && !!activeConv;
  const traySwitchRef = useRef(null);

  // Socket lifecycle: reconnect whenever token changes (account switch)
  useEffect(() => {
    connectSocket(token);
    fetchConversations();
    fetchContacts();
    fetchFriendRequests();
    return () => disconnectSocket();
  }, [token]);

  // ── Web Push 锁屏通知 ──────────────────────────────────────────────────────
  usePushNotification(token);
  const handlePushNav = useCallback(({ convId, convType }) => {
    useStore.getState().setActiveTab('messages');
    const { contacts, groups } = useStore.getState();
    if (convType === 'private') {
      const contact = contacts.find(c => c.id === convId);
      if (contact) useStore.getState().fetchMessages({
        type: 'private', id: convId,
        name: contact.display_name, avatarColor: contact.avatar_color,
      });
    } else if (convType === 'group') {
      const group = groups.find(g => g.id === convId);
      if (group) useStore.getState().fetchMessages({
        type: 'group', id: convId,
        name: group.name, avatarColor: group.avatar_color,
      });
    }
  }, []);
  usePushNavigation(handlePushNav);

  // 从后台切回超过 2 分钟时，静默刷新会话列表（同步未读数 + 触发预加载）
  useEffect(() => {
    let blurAt = 0;
    const onBlur  = () => { blurAt = Date.now(); };
    const onFocus = () => {
      if (blurAt > 0 && Date.now() - blurAt > 120_000) {
        useStore.getState().fetchConversations();
      }
    };
    window.addEventListener('blur',  onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur',  onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // ── Electron tray: sync accounts whenever the list changes ──────────────────
  useEffect(() => {
    window.electronAPI?.updateTrayAccounts?.(accounts, activeAccountIdx);
  }, [accounts, activeAccountIdx]);

  // ── Electron tray: listen for account switch command from tray menu ─────────
  useEffect(() => {
    if (!window.electronAPI?.onTraySwitch) return;
    // Clean up previous listener before registering new one
    if (traySwitchRef.current) traySwitchRef.current();
    traySwitchRef.current = window.electronAPI.onTraySwitch((idx) => {
      useStore.getState().switchAccount(idx);
    });
    return () => { if (traySwitchRef.current) traySwitchRef.current(); };
  }, []);

  // Electron notification click → navigate to conversation
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onNavigate(({ convId, convType }) => {
      useStore.getState().setActiveTab('messages');
      const { contacts, groups } = useStore.getState();
      if (convType === 'private') {
        const contact = contacts.find(c => c.id === convId);
        if (contact) {
          useStore.getState().fetchMessages({
            type: 'private', id: convId,
            name: contact.display_name, avatarColor: contact.avatar_color,
          });
        }
      } else if (convType === 'group') {
        const group = groups.find(g => g.id === convId);
        if (group) {
          useStore.getState().fetchMessages({
            type: 'group', id: convId,
            name: group.name, avatarColor: group.avatar_color,
          });
        }
      }
    });
    return () => window.electronAPI.offNavigate();
  }, []);

  return (
    <div className={`main-layout${window.electronAPI?.framelessChrome ? ' has-titlebar' : ''}`}>
      {/* Windows 自定义标题栏 */}
      <TitleBar />

      {/* 账号 Rail — 最左侧固定列 */}
      <AccountSwitcher />

      {/* 功能导航 Sidebar */}
      <Sidebar />

      {/* 主内容区 */}
      <div className={`main-content ${inChat ? 'main-content-in-chat' : ''}`}>
        {accountSwitching ? (
          <div className="account-switching-overlay">
            <div className="account-switching-spinner" />
            <span className="account-switching-text">正在切换账号...</span>
          </div>
        ) : (
          <Suspense fallback={<PanelFallback />}>
            {activeTab === 'messages' && <ChatPanel />}
            {activeTab === 'contacts' && <ContactPanel />}
            {activeTab === 'groups'   && <GroupsPanel />}
            {activeTab === 'profile'  && <Profile />}
            {activeTab === 'settings' && <Profile section="settings" />}
          </Suspense>
        )}
      </div>

      {!inChat && <BottomNav />}
      <Suspense fallback={null}><CallScreen /></Suspense>
      <NotificationToast />
    </div>
  );
}
