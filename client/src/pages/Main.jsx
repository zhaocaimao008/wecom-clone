import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { connectSocket, disconnectSocket } from '../socket';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import ChatPanel from '../components/ChatPanel';
import ContactPanel from '../components/ContactPanel';
import WorkStation from '../components/WorkStation';
import Profile from '../components/Profile';
import CallScreen from '../components/CallScreen';

export default function Main() {
  const { token, activeTab, activeConv, fetchConversations, fetchContacts, fetchFriendRequests } = useStore();
  const inChat = activeTab === 'messages' && !!activeConv;

  useEffect(() => {
    connectSocket(token);
    fetchConversations();
    fetchContacts();
    fetchFriendRequests();
    return () => disconnectSocket();
  }, [token]);

  return (
    <div className="main-layout">
      <Sidebar />
      <div className="main-content">
        {activeTab === 'messages'    && <ChatPanel />}
        {activeTab === 'contacts'    && <ContactPanel />}
        {activeTab === 'workstation' && <WorkStation />}
        {activeTab === 'profile'     && <Profile />}
      </div>
      {!inChat && <BottomNav />}
      <CallScreen />
    </div>
  );
}
