import { create } from 'zustand';

const API = '/api';

export const useStore = create((set, get) => ({
  token: localStorage.getItem('wc_token') || null,
  currentUser: JSON.parse(localStorage.getItem('wc_user') || 'null'),
  activeTab: 'messages',
  conversations: [],
  activeConv: null,
  /** @type {import('../types/message').Message[]} */
  messages: [],
  contacts: [],
  departments: {},
  groups: [],
  onlineUsers: new Set(),
  typingUsers: new Set(),
  sendError: null,
  friendRequests: [],          // pending received requests
  friendRequestCount: 0,
  activeCall: null,            // { type, peer, state, localStream, remoteStream, ... }

  setToken(token, user) {
    localStorage.setItem('wc_token', token);
    localStorage.setItem('wc_user', JSON.stringify(user));
    set({ token, currentUser: user });
  },

  logout() {
    localStorage.removeItem('wc_token');
    localStorage.removeItem('wc_user');
    set({ token: null, currentUser: null, conversations: [], messages: [], activeConv: null });
  },

  setActiveTab(tab) { set({ activeTab: tab }); },
  clearActiveConv() { set({ activeConv: null, messages: [] }); },

  // ── Conversations ───────────────────────────────────────────────────────────
  async fetchConversations() {
    const res = await get().api('/messages/conversations');
    set({ conversations: res });
  },

  async fetchMessages(conv) {
    set({ activeConv: conv, messages: [] });
    const path = conv.type === 'private'
      ? `/messages/private/${conv.id}`
      : `/messages/group/${conv.id}`;
    const msgs = await get().api(path);
    set({ messages: msgs });
    // Mark as read
    if (msgs.length > 0) {
      const lastId = msgs[msgs.length - 1].id;
      const body = conv.type === 'private'
        ? { peerId: conv.id, lastId }
        : { groupId: conv.id, lastId };
      get().api('/users/read', { method: 'POST', body }).catch(() => {});
      set(s => ({
        conversations: s.conversations.map(c => {
          const match = conv.type === 'private'
            ? c.peer_id === conv.id
            : c.group_id === conv.id;
          return match ? { ...c, unread_count: 0 } : c;
        })
      }));
    }
  },

  markActiveRead() {
    const { activeConv, messages } = get();
    if (!activeConv || messages.length === 0) return;
    const lastId = messages[messages.length - 1].id;
    const body = activeConv.type === 'private'
      ? { peerId: activeConv.id, lastId }
      : { groupId: activeConv.id, lastId };
    get().api('/users/read', { method: 'POST', body }).catch(() => {});
    set(s => ({
      conversations: s.conversations.map(c => {
        const match = activeConv.type === 'private'
          ? c.peer_id === activeConv.id
          : c.group_id === activeConv.id;
        return match ? { ...c, unread_count: 0 } : c;
      })
    }));
  },

  // ── Contacts ────────────────────────────────────────────────────────────────
  async fetchContacts() {
    const [contacts, depts, groups] = await Promise.all([
      get().api('/users/contacts'),
      get().api('/users/departments'),
      get().api('/users/me/groups'),
    ]);
    set({ contacts, departments: depts, groups });
  },

  // ── Messages ────────────────────────────────────────────────────────────────
  addMessage(msg) {
    const { activeConv } = get();
    const matchesActive = activeConv && (
      (activeConv.type === 'private' && !msg.group_id &&
        (msg.sender_id === activeConv.id || msg.receiver_id === activeConv.id)) ||
      (activeConv.type === 'group' && msg.group_id === activeConv.id)
    );
    if (matchesActive) {
      set(s => ({ messages: [...s.messages, msg] }));
      get().markActiveRead();
    }
    get().fetchConversations();
  },

  recallMessage(messageId) {
    set(s => ({
      messages: s.messages.map(m => m.id === messageId ? { ...m, recalled: 1 } : m)
    }));
    get().fetchConversations();
  },

  setSendError(msg) {
    set({ sendError: msg });
    setTimeout(() => set({ sendError: null }), 3500);
  },

  // ── Online ──────────────────────────────────────────────────────────────────
  setUserStatus(userId, status) {
    set(s => {
      const online = new Set(s.onlineUsers);
      status === 'online' ? online.add(userId) : online.delete(userId);
      return { onlineUsers: online };
    });
  },

  setTyping(userId, isTyping) {
    set(s => {
      const t = new Set(s.typingUsers);
      isTyping ? t.add(userId) : t.delete(userId);
      return { typingUsers: t };
    });
  },

  // ── Group events ────────────────────────────────────────────────────────────
  handleGroupCreated() { get().fetchContacts(); get().fetchConversations(); },

  handleGroupUpdated(group) {
    set(s => ({
      groups: s.groups.map(g => g.id === group.id ? { ...g, ...group } : g),
      activeConv: s.activeConv?.id === group.id && s.activeConv?.type === 'group'
        ? { ...s.activeConv, name: group.name } : s.activeConv,
    }));
    get().fetchConversations();
  },

  handleGroupKicked(groupId) {
    set(s => ({
      groups: s.groups.filter(g => g.id !== groupId),
      conversations: s.conversations.filter(c => c.group_id !== groupId),
      activeConv: s.activeConv?.id === groupId && s.activeConv?.type === 'group' ? null : s.activeConv,
      messages: s.activeConv?.id === groupId && s.activeConv?.type === 'group' ? [] : s.messages,
    }));
  },

  // ── Friend requests ─────────────────────────────────────────────────────────
  async fetchFriendRequests() {
    const reqs = await get().api('/users/friend-requests');
    set({ friendRequests: reqs, friendRequestCount: reqs.length });
  },

  addFriendRequest(req) {
    set(s => ({
      friendRequests: [req, ...s.friendRequests],
      friendRequestCount: s.friendRequestCount + 1,
    }));
  },

  removeFriendRequest(fromId) {
    set(s => ({
      friendRequests: s.friendRequests.filter(r => r.from_id !== fromId),
      friendRequestCount: Math.max(0, s.friendRequestCount - 1),
    }));
  },

  // ── Calls ───────────────────────────────────────────────────────────────────
  setActiveCall(call) { set({ activeCall: call }); },
  clearCall() { set({ activeCall: null }); },

  // ── Profile ─────────────────────────────────────────────────────────────────
  updateCurrentUser(user) {
    localStorage.setItem('wc_user', JSON.stringify(user));
    set({ currentUser: user });
  },

  // ── HTTP helper ─────────────────────────────────────────────────────────────
  async api(path, opts = {}) {
    const token = get().token;
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '请求失败');
    }
    return res.json();
  },
}));
