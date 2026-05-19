import { useRef, useEffect, useCallback } from 'react';

export function useMarkRead({ socket, messages, currentUser, isNearBottomRef, markActiveRead }) {
  const markedRef = useRef(new Set());

  const markIfVisible = useCallback(() => {
    if (!socket || !currentUser || messages.length === 0) return;
    if (document.visibilityState !== 'visible') return;
    if (!isNearBottomRef.current) return;

    const last = [...messages].reverse().find(
      m => m.sender_id !== currentUser.id && !m.recalled && m.id
    );
    if (!last || markedRef.current.has(last.id)) return;

    socket.emit('mark_read', { messageId: last.id });
    markedRef.current.add(last.id);
    markActiveRead();
  }, [socket, currentUser, messages, isNearBottomRef, markActiveRead]);

  // Fire on new messages
  useEffect(() => { markIfVisible(); }, [markIfVisible]);

  // Fire on tab-switch / window focus
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') markIfVisible(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', markIfVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', markIfVisible);
    };
  }, [markIfVisible]);

  function reset() { markedRef.current = new Set(); }

  return { markIfVisible, reset };
}
