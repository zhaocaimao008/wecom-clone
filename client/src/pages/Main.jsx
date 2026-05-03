import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { connectSocket, disconnectSocket } from '../socket';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import ChatPanel from '../components/ChatPanel';
import ContactPanel from '../components/ContactPanel';
import GroupsPanel from '../components/GroupsPanel';
import Profile from '../components/Profile';
import CallScreen from '../components/CallScreen';
import NotificationToast from '../components/NotificationToast';

export default function Main() {
  const { token, activeTab, activeConv, fetchConversations, fetchContacts, fetchFriendRequests } = useStore();
  const inChat = activeTab === 'messages' && !!activeConv;

  useEffect(() => {
    connectSocket(token);
    fetchConversations();
    fetchContacts();
    fetchFriendRequests();
    // Request browser notification permission on first load (non-Electron)
    if (!window.electronAPI && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    return () => disconnectSocket();
  }, [token]);

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
    <div className="main-layout">
      <Sidebar />
      <div className="main-content">
        {activeTab === 'messages'    && <ChatPanel />}
        {activeTab === 'contacts'    && <ContactPanel />}
        {activeTab === 'groups'      && <GroupsPanel />}
        {activeTab === 'profile'     && <Profile />}
      </div>
      {!inChat && <BottomNav />}
      <CallScreen />
      <NotificationToast />
    </div>
  );
}
