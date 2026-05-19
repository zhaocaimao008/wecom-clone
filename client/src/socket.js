import { io } from 'socket.io-client';
import { useStore } from './store/useStore';
import { SERVER } from './config';
import { e2e, isEncrypted, decryptMessage } from './crypto/e2e';

let socket = null;

async function decryptIfNeeded(msg) {
  if (msg.msg_type !== 'text' || !isEncrypted(msg.content)) return msg;
  try {
    const token = useStore.getState().token;
    const peerId = msg.group_id ? null : msg.sender_id;
    if (!peerId) return { ...msg, content: '[加密消息]', encrypted: true };
    const sharedKey = await e2e.getSharedKey(peerId, token);
    if (!sharedKey) return { ...msg, content: '[加密消息]', encrypted: true };
    const plain = await decryptMessage(msg.content, sharedKey);
    return { ...msg, content: plain, encrypted: true };
  } catch {
    return { ...msg, content: '[解密失败]', encrypted: true };
  }
}

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(SERVER || '/', { auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('disconnect', () => console.log('Socket disconnected'));

  socket.on('new_message', async msg => {
    const decrypted = await decryptIfNeeded(msg);
    const normalized = decrypted.msg_type === 'voice'
      ? { ...decrypted, type: 'voice' }
      : { ...decrypted, type: decrypted.type || decrypted.msg_type || 'text' };
    useStore.getState().addMessage(normalized);

    const { activeConv, currentUser, groups } = useStore.getState();
    if (msg.sender_id === currentUser?.id) return; // own message
    const isActive = activeConv && (
      (activeConv.type === 'private' && !msg.group_id && activeConv.id === msg.sender_id) ||
      (activeConv.type === 'group'   && msg.group_id  && activeConv.id === msg.group_id)
    );
    if (isActive) return;

    const bodyText = msg.msg_type === 'voice' ? '[语音消息]'
      : msg.msg_type === 'image' ? '[图片]'
      : msg.msg_type === 'file'  ? '[文件]'
      : (msg.content || '').slice(0, 80);

    const convId   = msg.group_id ?? msg.sender_id;
    const convType = msg.group_id ? 'group' : 'private';
    let title = msg.sender_name || '新消息';
    if (msg.group_id) {
      const grp = groups.find(g => g.id === msg.group_id);
      if (grp) title = `${grp.name}：${msg.sender_name}`;
    }

    // In-app floating toast (always shown)
    useStore.getState().addToast({
      title,
      body: bodyText,
      senderName:  msg.sender_name,
      senderColor: msg.sender_color,
      convId,
      convType,
    });

    // OS / browser notification (respects wc_notify setting)
    if (localStorage.getItem('wc_notify') !== 'off') {
      if (window.electronAPI) {
        window.electronAPI.showNotification({ title, body: bodyText, convId, convType });
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body: bodyText, icon: '/favicon.ico', silent: false });
      }
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
  const typingTimers = new Map();
  socket.on('typing',           ({ userId, isTyping }) => {
    useStore.getState().setTyping(userId, isTyping);
    if (isTyping) {
      clearTimeout(typingTimers.get(userId));
      typingTimers.set(userId, setTimeout(() => {
        useStore.getState().setTyping(userId, false);
        typingTimers.delete(userId);
      }, 3000));
    } else {
      clearTimeout(typingTimers.get(userId));
      typingTimers.delete(userId);
    }
  });
  socket.on('send_error',       ({ message }) => useStore.getState().setSendError(message));
  // Generic operation errors (recall/edit/delete/reaction failures)
  socket.on('error',            ({ message }) => useStore.getState().addToast({ title: '操作失败', body: message || '请稍后重试' }));
  socket.on('message_read',     ({ messageId }) => useStore.getState().markMessageRead(messageId));

  // 跨端已读同步：其他设备标记了某会话已读，当前端同步清零角标
  socket.on('conv_read_sync', ({ peerId, groupId }) => {
    const { conversations } = useStore.getState();
    const updated = conversations.map(c => {
      const match = groupId
        ? c.group_id === groupId
        : !c.group_id && c.peer_id === peerId;
      return match ? { ...c, unread_count: 0 } : c;
    });
    useStore.setState({ conversations: updated });
    if (window.electronAPI?.setBadge) {
      window.electronAPI.setBadge(updated.reduce((s, c) => s + (c.unread_count || 0), 0));
    }
  });

  // ── @mention notification ────────────────────────────────────────────────
  socket.on('mention', data => {
    const title = `有人在群「${data.groupName}」中提到了你`;
    const body = `${data.senderName}：${data.message?.content || ''}`.slice(0, 200);
    if (localStorage.getItem('wc_notify') !== 'off') {
      if (window.electronAPI) {
        window.electronAPI.showNotification({
          title, body,
          convId: data.groupId, convType: 'group',
        });
      } else if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico' });
      }
    }
    useStore.getState().addMentionNotification?.(data);
  });

  // Groups
  socket.on('group_created',  () => useStore.getState().handleGroupCreated());
  socket.on('group_updated',  g  => useStore.getState().handleGroupUpdated(g));
  socket.on('group_kicked',   ({ groupId, groupName }) => {
    useStore.getState().handleGroupKicked(groupId);
    useStore.getState().addToast({ title: '已退出群聊', body: `你已被移出群聊「${groupName}」` });
  });
  socket.on('group_dissolved', ({ groupId, groupName }) => {
    useStore.getState().handleGroupKicked(groupId);
    useStore.getState().addToast({ title: '群聊解散', body: `群聊「${groupName}」已解散` });
  });

  // Friend requests
  socket.on('friend_request',  req => {
    useStore.getState().addFriendRequest(req);
  });
  socket.on('friend_accepted', user => {
    useStore.getState().fetchContacts();
    useStore.getState().fetchConversations();
    useStore.getState().injectContactConversation(user);
  });
  socket.on('friend_rejected', ({ name } = {}) => {
    useStore.getState().addToast({ title: '好友申请', body: `${name || '对方'}拒绝了你的好友申请` });
  });
  socket.on('friend_removed', () => {
    useStore.getState().fetchContacts();
    useStore.getState().fetchConversations();
  });

  // Calls — relay to active call handler
  socket.on('call_incoming',  data => useStore.getState().setActiveCall({ ...data, state: 'incoming' }));
  socket.on('call_answered',  data => useStore.getState().setActiveCall(c => c ? { ...c, ...data, state: 'active' } : c));
  socket.on('call_rejected',  ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'rejected' } : c));
  socket.on('call_ended',     ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'ended' } : c));
  socket.on('call_ice', data => {
    if (window.__addIceCandidate) window.__addIceCandidate(data.candidate);
  });
  socket.on('call_busy',      ()   => useStore.getState().setActiveCall(c => c ? { ...c, state: 'busy' } : c));

  socket.on('reaction_update', ({ messageId, emoji, userIds }) => {
    useStore.getState().updateReaction(messageId, emoji, userIds);
  });

  socket.on('multi_device_notice', ({ count }) => {
    useStore.getState().addToast({
      title: '多设备登录',
      body: `您的账号当前在 ${count} 台设备上同时在线`,
    });
  });

  socket.on('force_logout', ({ reason }) => {
    useStore.getState().addToast({ title: '强制下线', body: reason || '您已被强制登出' });
    setTimeout(() => useStore.getState().logout(), 1500);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

export function getSocket() { return socket; }

// Connect an unauthenticated socket just for QR login events (login page)
let anonSocket = null;
export function connectAnonSocket() {
  if (anonSocket?.connected) return anonSocket;
  if (anonSocket) { anonSocket.disconnect(); anonSocket = null; }
  anonSocket = io(SERVER || '/', { auth: {}, transports: ['websocket', 'polling'] });
  return anonSocket;
}
export function disconnectAnonSocket() {
  if (anonSocket) { anonSocket.removeAllListeners(); anonSocket.disconnect(); anonSocket = null; }
}
export function getAnonSocket() { return anonSocket; }
