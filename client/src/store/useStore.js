import { create } from 'zustand';
import { SERVER } from '../config';

const API = SERVER + '/api';
const MAX_ACCOUNTS = 15;
const ACCOUNTS_KEY = 'wc_accounts';
const ACTIVE_IDX_KEY = 'wc_active_idx';

// Migrate old single-account format to new multi-account format
;(function migrate() {
  if (localStorage.getItem(ACCOUNTS_KEY)) return;
  const t = localStorage.getItem('wc_token');
  const u = localStorage.getItem('wc_user');
  if (t && u) {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([{ token: t, user: JSON.parse(u) }]));
      localStorage.setItem(ACTIVE_IDX_KEY, '0');
    } catch {}
  }
  localStorage.removeItem('wc_token');
  localStorage.removeItem('wc_user');
})();

function loadAccountsState() {
  let accounts = [];
  try { accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]'); } catch {}
  if (!Array.isArray(accounts)) accounts = [];
  let idx = 0;
  try {
    const i = parseInt(localStorage.getItem(ACTIVE_IDX_KEY) || '0');
    idx = isNaN(i) ? 0 : Math.max(0, Math.min(i, Math.max(0, accounts.length - 1)));
  } catch {}
  return { accounts, activeIdx: idx };
}

function saveAccounts(accounts, idx) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  localStorage.setItem(ACTIVE_IDX_KEY, String(idx));
}

const { accounts: initAccounts, activeIdx: initActiveIdx } = loadAccountsState();
const initActive = initAccounts[initActiveIdx] || {};

export const useStore = create((set, get) => ({
  // ── Multi-account state ──────────────────────────────────────────────────────
  accounts: initAccounts,
  activeAccountIdx: initActiveIdx,
  token: initActive.token || null,
  currentUser: initActive.user || null,
  showAddAccount: false,

  // ── UI state ─────────────────────────────────────────────────────────────────
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
  messagesError: null,
  friendRequests: [],
  friendRequestCount: 0,
  activeCall: null,
  readReceipts: {}, // { [msgId]: number } — count of readers

  // ── Account management ───────────────────────────────────────────────────────

  addAccount(token, user) {
    const { accounts } = get();
    // If this user is already logged in, update token and switch to that account
    const existingIdx = accounts.findIndex(a => a.user?.id === user.id);
    if (existingIdx >= 0) {
      const updated = accounts.map((a, i) => i === existingIdx ? { token, user } : a);
      saveAccounts(updated, existingIdx);
      set({
        accounts: updated, activeAccountIdx: existingIdx,
        token, currentUser: user, showAddAccount: false,
        conversations: [], messages: [], activeConv: null,
        contacts: [], groups: [], friendRequests: [], friendRequestCount: 0,
        onlineUsers: new Set(), typingUsers: new Set(),
      });
      return;
    }
    if (accounts.length >= MAX_ACCOUNTS) {
      alert(`最多同时登录 ${MAX_ACCOUNTS} 个账户`);
      return;
    }
    const newAccounts = [...accounts, { token, user }];
    const newIdx = newAccounts.length - 1;
    saveAccounts(newAccounts, newIdx);
    set({
      accounts: newAccounts, activeAccountIdx: newIdx,
      token, currentUser: user, showAddAccount: false,
      conversations: [], messages: [], activeConv: null,
      contacts: [], groups: [], friendRequests: [], friendRequestCount: 0,
      onlineUsers: new Set(), typingUsers: new Set(),
    });
  },

  switchAccount(idx) {
    const { accounts } = get();
    if (idx < 0 || idx >= accounts.length) return;
    const { token, user } = accounts[idx];
    saveAccounts(accounts, idx);
    set({
      activeAccountIdx: idx, token, currentUser: user,
      conversations: [], messages: [], activeConv: null,
      contacts: [], groups: [], friendRequests: [], friendRequestCount: 0,
      onlineUsers: new Set(), typingUsers: new Set(),
    });
  },

  removeAccount(idx) {
    const { accounts, activeAccountIdx } = get();
    if (accounts.length <= 1) {
      // Last account — full logout
      localStorage.removeItem(ACCOUNTS_KEY);
      localStorage.removeItem(ACTIVE_IDX_KEY);
      set({
        accounts: [], activeAccountIdx: 0, token: null, currentUser: null,
        conversations: [], messages: [], activeConv: null,
        contacts: [], groups: [], friendRequests: [], friendRequestCount: 0,
        onlineUsers: new Set(), typingUsers: new Set(),
      });
      return;
    }
    const newAccounts = accounts.filter((_, i) => i !== idx);
    let newIdx = activeAccountIdx;
    if (idx === activeAccountIdx) {
      newIdx = Math.min(idx, newAccounts.length - 1);
      const { token, user } = newAccounts[newIdx];
      saveAccounts(newAccounts, newIdx);
      set({
        accounts: newAccounts, activeAccountIdx: newIdx, token, currentUser: user,
        conversations: [], messages: [], activeConv: null,
        contacts: [], groups: [], friendRequests: [], friendRequestCount: 0,
        onlineUsers: new Set(), typingUsers: new Set(),
      });
    } else {
      if (idx < activeAccountIdx) newIdx = activeAccountIdx - 1;
      saveAccounts(newAccounts, newIdx);
      set({ accounts: newAccounts, activeAccountIdx: newIdx });
    }
  },

  // Legacy setToken — delegates to addAccount for backwards compatibility
  setToken(token, user) {
    get().addAccount(token, user);
  },

  logout() {
    get().removeAccount(get().activeAccountIdx);
  },

  showAddAccountModal() { set({ showAddAccount: true }); },
  hideAddAccountModal() { set({ showAddAccount: false }); },

  // ── App state ────────────────────────────────────────────────────────────────

  setActiveTab(tab) { set({ activeTab: tab }); },
  clearActiveConv() { set({ activeConv: null, messages: [] }); },
  clearMessages() { set({ messages: [] }); },

  // ── Conversations ────────────────────────────────────────────────────────────
  async fetchConversations() {
    const res = await get().api('/messages/conversations');
    set({ conversations: res });
    const total = res.reduce((s, c) => s + (c.unread_count || 0), 0);
    window.electronAPI?.setBadge(total);
  },

  async fetchMessages(conv) {
    set({ activeConv: conv, messages: [], messagesError: null, readReceipts: {} });
    const path = conv.type === 'private'
      ? `/messages/private/${conv.id}`
      : `/messages/group/${conv.id}`;
    let msgs;
    try {
      msgs = await get().api(path);
      const receipts = {};
      msgs.forEach(m => { if (m.read_count) receipts[m.id] = m.read_count; });
      set({ messages: msgs, readReceipts: receipts });
    } catch (e) {
      set({ messagesError: e.message || '消息加载失败' });
      return;
    }
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

  async loadMoreMessages() {
    const { activeConv, messages } = get();
    if (!activeConv || messages.length === 0) return false;
    const firstId = messages[0]?.id;
    if (!firstId) return false;
    const path = activeConv.type === 'private'
      ? `/messages/private/${activeConv.id}?before=${firstId}`
      : `/messages/group/${activeConv.id}?before=${firstId}`;
    try {
      const older = await get().api(path);
      if (older.length === 0) return false;
      const receipts = {};
      older.forEach(m => { if (m.read_count) receipts[m.id] = m.read_count; });
      set(s => ({ messages: [...older, ...s.messages], readReceipts: { ...receipts, ...s.readReceipts } }));
      return true;
    } catch { return false; }
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

  // ── Contacts ─────────────────────────────────────────────────────────────────
  async fetchContacts() {
    const [contacts, depts, groups] = await Promise.all([
      get().api('/users/contacts'),
      get().api('/users/departments'),
      get().api('/users/me/groups'),
    ]);
    set({ contacts, departments: depts, groups });
  },

  // ── Messages ─────────────────────────────────────────────────────────────────
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

  deleteMessage(messageId) {
    set(s => ({ messages: s.messages.filter(m => m.id !== messageId) }));
    get().fetchConversations();
  },

  editMessage(messageId, content) {
    set(s => ({
      messages: s.messages.map(m => m.id === messageId ? { ...m, content, edited: 1 } : m)
    }));
    get().fetchConversations();
  },

  confirmMessage(clientMsgId, serverId) {
    set(s => ({
      messages: s.messages.map(m =>
        m.clientMsgId === clientMsgId ? { ...m, id: serverId, clientMsgId: null } : m
      )
    }));
  },

  setSendError(msg) {
    set({ sendError: msg });
    setTimeout(() => set({ sendError: null }), 3500);
  },

  // ── Online ────────────────────────────────────────────────────────────────────
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

  // ── Group events ──────────────────────────────────────────────────────────────
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

  // ── Friend requests ───────────────────────────────────────────────────────────
  async fetchFriendRequests() {
    const reqs = await get().api('/users/friend-requests');
    set({ friendRequests: reqs, friendRequestCount: reqs.length });
  },

  addFriendRequest(req) {
    set(s => {
      if (s.friendRequests.some(r => r.from_id === req.from_id)) return s;
      const next = [req, ...s.friendRequests];
      return { friendRequests: next, friendRequestCount: next.length };
    });
  },

  removeFriendRequest(fromId) {
    set(s => {
      const next = s.friendRequests.filter(r => r.from_id !== fromId);
      return { friendRequests: next, friendRequestCount: next.length };
    });
  },

  // ── Calls ─────────────────────────────────────────────────────────────────────
  setActiveCall(callOrFn) {
    if (typeof callOrFn === 'function') {
      set(s => ({ activeCall: callOrFn(s.activeCall) }));
    } else {
      set({ activeCall: callOrFn });
    }
  },
  clearCall() { set({ activeCall: null }); },

  markMessageRead(messageId) {
    set(s => ({ readReceipts: { ...s.readReceipts, [messageId]: (s.readReceipts[messageId] || 0) + 1 } }));
  },

  // ── Profile ───────────────────────────────────────────────────────────────────
  updateCurrentUser(user) {
    const { accounts, activeAccountIdx } = get();
    const updated = accounts.map((a, i) => i === activeAccountIdx ? { ...a, user } : a);
    saveAccounts(updated, activeAccountIdx);
    set({ currentUser: user, accounts: updated });
  },

  // ── HTTP helper ───────────────────────────────────────────────────────────────
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
