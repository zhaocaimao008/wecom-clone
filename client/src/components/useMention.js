import { useState, useCallback } from 'react';

export function useMention(members, isGroup) {
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState([]);

  // Call this from handleInputChange with the current textarea value.
  // Returns a replacement input value when a mention is selected; otherwise undefined.
  const detect = useCallback((val) => {
    if (!isGroup) { setShow(false); return; }
    const atIdx = val.lastIndexOf('@');
    if (atIdx === -1 || (atIdx > 0 && !/\s/.test(val[atIdx - 1]))) {
      setShow(false);
      return;
    }
    const afterAt = val.slice(atIdx + 1);
    if (afterAt.includes(' ')) { setShow(false); return; }
    const search = afterAt.toLowerCase();
    setFilter(members.filter(m => !search || m.display_name?.toLowerCase().includes(search)));
    setShow(true);
  }, [members, isGroup]);

  const insert = useCallback((member, input) => {
    const atIdx = input.lastIndexOf('@');
    const before = input.slice(0, atIdx);
    const after = input.slice(atIdx).replace(/@[^ ]*/, '');
    setShow(false);
    return (before + '@' + member.display_name + ' ' + after).trim();
  }, []);

  const close = useCallback(() => setShow(false), []);

  return { showPicker: show, mentionFilter: filter, detect, insert, close };
}
