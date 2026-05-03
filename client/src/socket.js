import { io } from 'socket.io-client';
import { useStore } from './store/useStore';
import { SERVER } from './config';

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(SERVER || '/', { auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('disconnect', () => console.log('Socket disconnected'));

  socket.on('new_message', msg => {
    const normalized = msg.msg_type === 'voice'
      ? { ...msg, type: 'voice' }
      : { ...msg, type: msg.type || msg.msg_type || 'text' };
    useStore.getState().addMessage(normalized);

    // Desktop notification for messages not in the currently focused conversation
    const { activeConv, currentUser } = useStore.getState();
    if (!msg.group_id && msg.sender_id === currentUser?.id) return; // own message
    const isActive = activeConv && (
      (activeConv.type === 'private' && !msg.group_id && activeConv.id === msg.sender_id) ||
      (activeConv.type === 'group'   && msg.group_id  && activeConv.id === msg.group_id)
    );
    if (!isActive && window.electronAPI) {
      const body = msg.msg_type === 'voice' ? '[语音消息]'
        : msg.msg_type === 'image' ? '[图片]'
        : (msg.content || '').slice(0, 100);
      window.electronAPI.showNotification({
        title: msg.sender_name || '新消息',
        body,
        convId:   msg.group_id ?? msg.sender_id,
        convType: msg.group_id ? 'group' : 'private',
      });
    }
  });
  socket.on('message_recalled',  ({ messageId }) => useStore.getState().recallMessage(messageId));
  socket.on('message_deleted',   ({ messageId }) => useStore.getState().deleteMessage(messageId));
  socket.on('message_edited',    ({ messageId, content }) => useStore.getState().editMessage(messageId, content));
  // Server confirms dedup: update local temp message id with the real server id
  socket.on('message_confirmed', ({ clientMsgId, serverId }) => {
    useStore.getState().confirmMessage?.(clientMsgId, serverId);
  });
  socket.on('conversation_cleared', ({ type, peerId, groupId }) => {
    const { activeConv, clearMessages } = useStore.getState();
    if (!activeConv) return;
    if (type === 'private' && activeConv.type === 'private' && activeConv.id === peerId) clearMessages();
    if (type === 'group'   && activeConv.type === 'group'   && activeConv.id === groupId) clearMessages();
  });
  socket.on('user_status',      ({ userId, status }) => useStore.getState().setUserStatus(userId, status));
  socket.on('typing',           ({ userId, isTyping }) => {
    useStore.getState().setTyping(userId, isTyping);
    if (isTyping) setTimeout(() => useStore.getState().setTyping(userId, false), 3000);
  });
  socket.on('send_error',       ({ message }) => useStore.getState().setSendError(message));
  socket.on('message_read',     ({ messageId }) => useStore.getState().markMessageRead(messageId));

  // ── @mention notification ────────────────────────────────────────────────
  socket.on('mention', data => {
    const title = `有人在群「${data.groupName}」中提到了你`;
    const body = `${data.senderName}：${data.message?.content || ''}`.slice(0, 200);
    if (window.electronAPI) {
      window.electronAPI.showNotification({
        title, body,
        convId: data.groupId, convType: 'group',
      });
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
    useStore.getState().addMentionNotification?.(data);
  });

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
  socket.on('call_ice', data => {
    if (window.__addIceCandidate) window.__addIceCandidate(data.candidate);
  });
  socket.on('call_busy',      ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'busy' } : c));

  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

export function getSocket() { return socket; }
