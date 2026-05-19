import { useCallback } from 'react';
import { useStore } from '../store/useStore';

export function useCall() {
  const { setActiveCall } = useStore();
  return useCallback((targetId, targetName, targetColor, callType) => {
    setActiveCall({ state: 'outgoing', peerId: targetId, peerName: targetName, peerColor: targetColor, callType });
  }, [setActiveCall]);
}
