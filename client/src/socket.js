import { io } from 'socket.io-client';
import { useStore } from './store/useStore';

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io('/', { auth: { token }, transports: ['websocket'] });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('disconnect', () => console.log('Socket disconnected'));

  socket.on('new_message', msg => {
    const normalized = msg.msg_type === 'voice'
      ? { ...msg, type: 'voice' }
      : { ...msg, type: msg.type || msg.msg_type || 'text' };
    useStore.getState().addMessage(normalized);
  });
  socket.on('message_recalled', ({ messageId }) => useStore.getState().recallMessage(messageId));
  socket.on('user_status',      ({ userId, status }) => useStore.getState().setUserStatus(userId, status));
  socket.on('typing',           ({ userId, isTyping }) => {
    useStore.getState().setTyping(userId, isTyping);
    if (isTyping) setTimeout(() => useStore.getState().setTyping(userId, false), 3000);
  });
  socket.on('send_error',       ({ message }) => useStore.getState().setSendError(message));

  // Groups
  socket.on('group_created',  () => useStore.getState().handleGroupCreated());
  socket.on('group_updated',  g  => useStore.getState().handleGroupUpdated(g));
  socket.on('group_kicked',   ({ groupId, groupName }) => {
    useStore.getState().handleGroupKicked(groupId);
    alert(`你已被移出群聊「${groupName}」`);
  });
  socket.on('group_dissolved', ({ groupId, groupName }) => {
    useStore.getState().handleGroupKicked(groupId);
    alert(`群聊「${groupName}」已解散`);
  });

  // Friend requests
  socket.on('friend_request',  req => {
    useStore.getState().addFriendRequest(req);
  });
  socket.on('friend_accepted', user => {
    useStore.getState().fetchContacts();
    useStore.getState().fetchConversations();
  });
  socket.on('friend_rejected', () => {});

  // Calls — relay to active call handler
  socket.on('call_incoming',  data => useStore.getState().setActiveCall({ ...data, state: 'incoming' }));
  socket.on('call_answered',  data => useStore.getState().setActiveCall(c => c ? { ...c, ...data, state: 'active' } : c));
  socket.on('call_rejected',  ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'rejected' } : c));
  socket.on('call_ended',     ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'ended' } : c));
  socket.on('call_ice',       data => { if (window.__peerConn) window.__peerConn.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {}); });
  socket.on('call_busy',      ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'busy' } : c));

  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

export function getSocket() { return socket; }
