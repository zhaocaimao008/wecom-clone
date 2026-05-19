import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';

export function useGroupMembers(activeConv) {
  const [members, setMembers] = useState([]);
  const [tick, setTick] = useState(0);
  const groupMembersVersion = useStore(s => s.groupMembersVersion);

  useEffect(() => {
    if (activeConv?.type === 'group') {
      fetch(`/api/users/groups/${activeConv.id}/members`, {
        headers: { Authorization: `Bearer ${useStore.getState().token}` },
      })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(setMembers)
        .catch(() => setMembers([]));
    } else {
      setMembers([]);
    }
  }, [activeConv?.id, activeConv?.type, tick, groupMembersVersion]);

  const reload = useCallback(() => setTick(t => t + 1), []);

  return { members, reload };
}
