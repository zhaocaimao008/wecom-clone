import { create } from 'zustand';
import { SERVER } from '../config';
import { e2e, isEncrypted, decryptMessage } from '../crypto/e2e';

async function decryptMessages(msgs, convType, convId, token) {
  if (convType !== 'private' || !e2e.ready) return msgs;
  const sharedKey = await e2e.getSharedKey(convId, token).catch(() => null);
  if (!sharedKey) return msgs;
  return Promise.all(msgs.map(async m => {
    if (m.msg_type !== 'text' || !isEncrypted(m.content)) return m;
    try {
      return { ...m, content: await decryptMessage(m.content, sharedKey), encrypted: true };
    } catch {
      return { ...m, content: '[解密失败]', encrypted: true };
    }
  }));
}

const API = SERVER + '/api';
const MAX_ACCOUNTS = 15;
const ACCOUNTS_KEY = 'wc_accounts';
const ACTIVE_IDX_KEY = 'wc_active_idx';
let messageRequestSeq = 0;
let fetchAbortController = null;

// 扫描所有缓存条目，对含目标消息的条目应用 transformer，返回新 cache 对象（无变化返回原对象）
function _applyToCache(cache, transformer) {
  let changed = false;
  const next = {};
  for (const [key, entry] of Object.entries(cache)) {
    const newMsgs = entry.messages.map(transformer);
    if (newMsgs.some((m, i) => m !== entry.messages[i])) {
      next[key] = { ...entry, messages: newMsgs };
      changed = true;
    } else {
      next[key] = entry;
    }
  }
  return changed ? next : null; // null = 无变化
}

// 防抖：多个 socket 事件在 400ms 内只触发一次 fetchConversations
let _fetchConvTimer = null;

// 防止并发 401 触发多次 logout
let _loggingOut = false;
function fetchConversationsDebounced() {
  clearTimeout(_fetchConvTimer);
  _fetchConvTimer = setTimeout(() => useStore.getState().fetchConversations(), 400);
}

const CACHE_KEY = 'wc_msg_cache';
const RECEIPTS_KEY = 'wc_receipts_cache';
const MAX_CACHE_CONVS = 20;  // 最多缓存20个会话
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时过期

function loadMsgCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const now = Date.now();
    // Evict expired entries
    const valid = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!v.savedAt || now - v.savedAt < CACHE_TTL_MS) valid[k] = v;
    }
    return valid;
  } catch { return {}; }
}
function saveMsgCache(cache) {
  try {
    const now = Date.now();
    const keys = Object.keys(cache);
    const entries = (keys.length <= MAX_CACHE_CONVS ? keys : keys.slice(-MAX_CACHE_CONVS))
      .map(k => [k, { ...cache[k], savedAt: now }]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}
function saveReceiptsCache(cache) {
  try {
    const receipts = Object.fromEntries(
      Object.entries(cache).map(([key, val]) => [key, val?.readReceipts || {}])
    );
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
  } catch {}
}
function clearPersistentMessageCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(RECEIPTS_KEY);
}

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
  _msgCache: loadMsgCache(), // { 'private:id' | 'group:id': { messages, reactions, readReceipts } }
  contacts: [],
  departments: {},
  groups: [],
  onlineUsers: new Set(),
  typingUsers: new Set(),
  sendError: null,
  messagesLoading: false,
  messagesError: null,
  scrollToMsgId: null,
  groupMembersVersion: 0, // incremented on group_updated to trigger member re-fetch
  toasts: [],
  friendRequests: [],
  friendRequestCount: 0,
  activeCall: null,
  readReceipts: {}, // { [msgId]: number } — count of readers
  reactions: {},    // { [msgId]: { [emoji]: userId[] } }
  accountSwitching: false,
  accountUnreads: {}, // { [accountIdx]: number } — last known unread count per account

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
        readReceipts: {}, reactions: {},
      });
      clearPersistentMessageCache();
      return;
    }
    if (accounts.length >= MAX_ACCOUNTS) {
      get().addToast({ title: '账户数量上限', body: `最多同时登录 ${MAX_ACCOUNTS} 个账户` });
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
      readReceipts: {}, reactions: {},
    });
    clearPersistentMessageCache();
  },

  switchAccount(idx) {
    const { accounts, activeAccountIdx } = get();
    if (idx < 0 || idx >= accounts.length || idx === activeAccountIdx) return;
    const { token, user } = accounts[idx];
    saveAccounts(accounts, idx);
    set({
      accountSwitching: true,
      activeAccountIdx: idx, token, currentUser: user,
      conversations: [], messages: [], activeConv: null,
      contacts: [], groups: [], friendRequests: [], friendRequestCount: 0,
      onlineUsers: new Set(), typingUsers: new Set(),
      readReceipts: {}, reactions: {},
    });
    clearPersistentMessageCache();
    setTimeout(() => set({ accountSwitching: false }), 350);
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
        readReceipts: {}, reactions: {},
      });
      clearPersistentMessageCache();
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
        readReceipts: {}, reactions: {},
      });
      clearPersistentMessageCache();
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
    const total = res.reduce((s, c) => s + (c.unread_count || 0), 0);
    const { activeAccountIdx, accountUnreads } = get();
    set({
      conversations: res,
      accountUnreads: { ...accountUnreads, [activeAccountIdx]: total },
    });
    window.electronAPI?.setBadge(total);
    // 后台预加载 Top8 会话
    get()._prefetchTopConvs(res.slice(0, 8));
  },

  // 静默预加载，不影响任何 UI 状态（3并发）
  // 无缓存或缓存超过 5 分钟的会话：重新拉取并存入缓存（含 reactions）
  // 5 分钟内的新鲜缓存：跳过，WebSocket addMessage 已实时追加保持一致
  async _prefetchTopConvs(convList) {
    const CONCURRENCY = 3;
    const STALE_MS = 5 * 60 * 1000; // 5 分钟
    const now = Date.now();
    const toFetch = convList.filter(c => {
      const type = c.group_id ? 'group' : 'private';
      const id   = c.group_id  || c.peer_id;
      const cached = get()._msgCache[`${type}:${id}`];
      if (!cached) return true;
      const age = now - (cached.fetchedAt || cached.savedAt || 0);
      return age > STALE_MS;
    });
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async c => {
        const type = c.group_id ? 'group' : 'private';
        const id   = c.group_id  || c.peer_id;
        const cacheKey = `${type}:${id}`;
        const path = type === 'private'
          ? `/messages/private/${id}?limit=30`
          : `/messages/group/${id}?limit=30`;
        try {
          const msgs = await get().api(path);
          const receipts = {};
          msgs.forEach(m => { if (m.read_count) receipts[m.id] = m.read_count; });
          // 同步预取 reactions，让缓存命中时能直接渲染表情
          let reactionsData = {};
          const ids = msgs.map(m => m.id).filter(Boolean);
          if (ids.length > 0) {
            reactionsData = await get().api('/messages/reactions', { method: 'POST', body: { messageIds: ids } }).catch(() => ({}));
          }
          set(s => ({
            _msgCache: { ...s._msgCache, [cacheKey]: { messages: msgs, readReceipts: receipts, reactions: reactionsData, fetchedAt: Date.now() } },
          }));
          saveMsgCache(get()._msgCache);
        } catch { /* 预加载失败静默忽略 */ }
      }));
    }
  },

  async fetchMessages(conv, scrollToMsgId = null) {
    // 取消上一个未完成的请求
    if (fetchAbortController) fetchAbortController.abort();
    fetchAbortController = new AbortController();
    const signal = fetchAbortController.signal;

    const requestSeq = ++messageRequestSeq;
    const cacheKey = `${conv.type}:${conv.id}`;
    const cached = get()._msgCache[cacheKey];
    // 判断当前会话是否有未读（有未读时必须强制后台刷新，缓存可能缺失新消息）
    const convInfo = get().conversations.find(c =>
      conv.type === 'private' ? c.peer_id === conv.id : c.group_id === conv.id
    );
    const hasUnread = (convInfo?.unread_count || 0) > 0;

    // 命中缓存：立即渲染，按新鲜度决定是否后台刷新
    if (cached) {
      set({
        activeConv: conv,
        messages: cached.messages,
        readReceipts: cached.readReceipts,
        reactions: cached.reactions,
        messagesError: null,
        messagesLoading: false,
        scrollToMsgId: scrollToMsgId || null,
      });
      // 缓存在 45 秒内且无未读 → 直接返回，无需后台请求（节省 RTT）
      const cacheAge = Date.now() - (cached.fetchedAt || 0);
      if (cacheAge < 45_000 && !hasUnread) return;
    } else {
      set({ activeConv: conv, messages: [], messagesError: null, messagesLoading: true, readReceipts: {}, reactions: {} });
    }

    const path = conv.type === 'private'
      ? `/messages/private/${conv.id}?limit=30`
      : `/messages/group/${conv.id}?limit=30`;

    let msgs;
    try {
      const raw = await get().api(path, { signal });
      msgs = await decryptMessages(raw, conv.type, conv.id, get().token);
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (!cached) set({ messagesError: e.message || '消息加载失败', messagesLoading: false });
      return;
    }

    if (
      requestSeq !== messageRequestSeq ||
      get().activeConv?.id !== conv.id ||
      get().activeConv?.type !== conv.type
    ) return;

    const receipts = {};
    msgs.forEach(m => { if (m.read_count) receipts[m.id] = m.read_count; });

    // 先保存消息（含上次缓存的 reactions），立即渲染
    set(s => ({
      messages: msgs,
      messagesLoading: false,
      readReceipts: receipts,
      scrollToMsgId: scrollToMsgId || null,
      _msgCache: {
        ...s._msgCache,
        [cacheKey]: {
          messages: msgs,
          readReceipts: receipts,
          reactions: cached?.reactions || {},
          fetchedAt: Date.now(),
        },
      },
    }));
    saveMsgCache(get()._msgCache);
    saveReceiptsCache(get()._msgCache);

    // reactions 完全后台，不 await，不阻塞任何渲染
    const ids = msgs.map(m => m.id).filter(Boolean);
    if (ids.length > 0) {
      get().api('/messages/reactions', { method: 'POST', body: { messageIds: ids } })
        .then(reactionsData => {
          if (
            requestSeq !== messageRequestSeq ||
            get().activeConv?.id !== conv.id ||
            get().activeConv?.type !== conv.type
          ) return;
          set(s => ({
            reactions: reactionsData,
            _msgCache: {
              ...s._msgCache,
              [cacheKey]: { messages: msgs, readReceipts: receipts, reactions: reactionsData, fetchedAt: Date.now() },
            },
          }));
          saveMsgCache(get()._msgCache);
          saveReceiptsCache(get()._msgCache);
        })
        .catch(() => {});
    }

    // 用户主动打开对话后立即清零未读角标（服务器端也同步更新 last_read_id）
    // 注意：这只针对 fetchMessages 路径（用户点击会话），不影响后台预加载
    get().markActiveRead();
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
      // Also fetch reactions for the newly loaded older messages
      const ids = older.map(m => m.id).filter(Boolean);
      if (ids.length > 0) {
        get().api('/messages/reactions', { method: 'POST', body: { messageIds: ids } })
          .then(data => set(s => ({ reactions: { ...data, ...s.reactions } })))
          .catch(() => {});
      }
      return true;
    } catch { return false; }
  },

  markActiveRead() {
    const { activeConv, messages } = get();
    if (!activeConv || messages.length === 0) return;
    const lastMsg = [...messages].reverse().find(m => m.id);
    if (!lastMsg) return;
    const lastId = lastMsg.id;
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
    const { activeConv, conversations, messages: currentMsgs, currentUser } = get();
    // Dedup: skip if we already have a message with this server ID (e.g. REST response + socket both arrive)
    if (msg.id && currentMsgs.some(m => m.id === msg.id)) return;
    const matchesActive = activeConv && (
      (activeConv.type === 'private' && !msg.group_id &&
        (msg.sender_id === activeConv.id || msg.receiver_id === activeConv.id)) ||
      (activeConv.type === 'group' && msg.group_id === activeConv.id)
    );
    if (matchesActive) {
      set(s => ({ messages: [...s.messages, msg] }));
      // 不在这里标已读——由 ChatWindow 的可视区域检测负责
    }

    // ── 同步更新 _msgCache，保持缓存与 WebSocket 推送一致 ──────────────
    if (msg.id) {
      const cacheKey = msg.group_id
        ? `group:${msg.group_id}`
        : `private:${msg.sender_id === currentUser?.id ? msg.receiver_id : msg.sender_id}`;
      const cached = get()._msgCache[cacheKey];
      if (cached && !cached.messages.some(m => m.id === msg.id)) {
        const updatedMsgs = [...cached.messages, msg].slice(-30); // 保留最新 30 条
        const newCache = { ...get()._msgCache, [cacheKey]: { ...cached, messages: updatedMsgs } };
        set({ _msgCache: newCache });
        saveMsgCache(newCache);
      }
    }

    // Update conversation list in-state (avoid full API reload on every message)
    const msgType = msg.msg_type || msg.type || 'text';
    const lastText =
      msgType === 'voice' ? '[语音]' :
      msgType === 'image' ? '[图片]' :
      msgType === 'file'  ? '[文件]' :
      msgType === 'card'  ? '[名片]' :
      msg.content || '';
    let found = false;
    const updated = conversations.map(c => {
      const match = msg.group_id
        ? c.group_id === msg.group_id
        : !c.group_id && (c.peer_id === msg.sender_id || c.peer_id === msg.receiver_id);
      if (!match) return c;
      found = true;
      return {
        ...c,
        last_message: lastText,
        last_type: msgType,
        created_at: msg.created_at || new Date().toISOString(),
        last_sender_id: msg.sender_id,
        unread_count: matchesActive ? c.unread_count : (c.unread_count || 0) + 1,
      };
    });
    if (found) {
      updated.sort((a, b) => {
        if (b.is_pinned !== a.is_pinned) return b.is_pinned - a.is_pinned;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      set({ conversations: updated });
      window.electronAPI?.setBadge(updated.reduce((s, c) => s + (c.unread_count || 0), 0));
    } else {
      // Conversation not in list yet (e.g. first message from new contact) — fetch from API
      get().fetchConversations();
    }
  },

  recallMessage(messageId) {
    set(s => ({
      messages: s.messages.map(m => m.id === messageId ? { ...m, recalled: 1 } : m)
    }));
    const next = _applyToCache(get()._msgCache, m => m.id === messageId ? { ...m, recalled: 1 } : m);
    if (next) { set({ _msgCache: next }); saveMsgCache(next); }
    fetchConversationsDebounced();
  },

  deleteMessage(messageId) {
    set(s => ({ messages: s.messages.filter(m => m.id !== messageId) }));
    const next = _applyToCache(get()._msgCache, m => m.id === messageId ? { ...m, _deleted: 1 } : m);
    if (next) {
      // 从缓存中彻底移除该消息
      const cleaned = {};
      for (const [k, v] of Object.entries(next)) {
        cleaned[k] = { ...v, messages: v.messages.filter(m => !m._deleted) };
      }
      set({ _msgCache: cleaned }); saveMsgCache(cleaned);
    }
    fetchConversationsDebounced();
  },

  editMessage(messageId, content) {
    set(s => ({
      messages: s.messages.map(m => m.id === messageId ? { ...m, content, edited: 1 } : m)
    }));
    const next = _applyToCache(get()._msgCache, m => m.id === messageId ? { ...m, content, edited: 1 } : m);
    if (next) { set({ _msgCache: next }); saveMsgCache(next); }
    fetchConversationsDebounced();
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

  // ── In-app toasts ──────────────────────────────────────────────────────────────
  addToast(toast) {
    const id = Date.now() + Math.random();
    set(s => ({ toasts: [...s.toasts.slice(-4), { id, ...toast }] }));
    setTimeout(() => get().removeToast(id), 4500);
  },
  removeToast(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },

  // ── Confirm dialog (non-blocking replacement for window.confirm) ──────────────
  confirmDialog: null, // null | { message, resolve }
  showConfirm(message) {
    return new Promise(resolve => {
      set({ confirmDialog: { message, resolve } });
    });
  },
  _resolveConfirm(result) {
    const { confirmDialog } = get();
    if (confirmDialog?.resolve) confirmDialog.resolve(result);
    set({ confirmDialog: null });
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

  // 新好友接受后立即注入会话（无需等待第一条消息）
  injectContactConversation(friend) {
    if (!friend?.id) return;
    set(s => {
      if (s.conversations.some(c => c.peer_id === friend.id)) return s;
      return {
        conversations: [{
          peer_id: friend.id,
          name: friend.display_name,
          avatar_color: friend.avatar_color,
          avatar_url: friend.avatar_url || null,
          last_message: null,
          last_type: null,
          created_at: new Date().toISOString(),
          last_sender_id: null,
          group_id: null,
          unread_count: 0,
          is_pinned: 0,
          is_muted: 0,
        }, ...s.conversations],
      };
    });
  },

  // ── Group events ──────────────────────────────────────────────────────────────
  handleGroupCreated() { get().fetchContacts(); get().fetchConversations(); },

  handleGroupUpdated(group) {
    set(s => ({
      groups: s.groups.map(g => g.id === group.id ? { ...g, ...group } : g),
      activeConv: s.activeConv?.id === group.id && s.activeConv?.type === 'group'
        ? { ...s.activeConv, name: group.name, avatarUrl: group.avatar_url } : s.activeConv,
      conversations: s.conversations.map(c =>
        c.group_id === group.id ? { ...c, name: group.name, avatar_url: group.avatar_url ?? c.avatar_url, avatar_color: group.avatar_color ?? c.avatar_color } : c
      ),
      groupMembersVersion: s.groupMembersVersion + 1,
    }));
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

  updateReaction(messageId, emoji, userIds) {
    set(s => {
      const msgReactions = { ...(s.reactions[messageId] || {}) };
      if (userIds.length === 0) { delete msgReactions[emoji]; }
      else { msgReactions[emoji] = userIds; }
      const newReactions = { ...s.reactions, [messageId]: msgReactions };
      // 同步更新 _msgCache，让 reactions 在会话切换后仍可从缓存直出
      let newCache = s._msgCache;
      for (const [key, entry] of Object.entries(s._msgCache)) {
        if (entry.messages.some(m => m.id === messageId)) {
          newCache = { ...newCache, [key]: { ...entry, reactions: { ...(entry.reactions || {}), [messageId]: msgReactions } } };
        }
      }
      return { reactions: newReactions, _msgCache: newCache };
    });
    saveMsgCache(get()._msgCache);
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
    const { signal, ...restOpts } = opts;
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        ...restOpts,
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...restOpts.headers,
        },
        body: restOpts.body ? JSON.stringify(restOpts.body) : undefined,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('网络连接失败，请稍后重试');
    }
    if (!res.ok) {
      if (res.status === 401) {
        if (!_loggingOut) {
          _loggingOut = true;
          get().logout();
          setTimeout(() => { _loggingOut = false; }, 3000);
        }
        throw new Error('登录已过期，请重新登录');
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '请求失败');
    }
    return res.json();
  },
}));
