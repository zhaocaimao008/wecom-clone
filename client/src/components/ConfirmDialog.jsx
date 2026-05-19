import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';

export default function ConfirmDialog() {
  const confirmDialog = useStore(s => s.confirmDialog);
  const resolve = useStore(s => s._resolveConfirm);

  useEffect(() => {
    if (!confirmDialog) return;
    const onKey = (e) => {
      if (e.key === 'Escape') resolve(false);
      if (e.key === 'Enter') resolve(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDialog, resolve]);

  if (!confirmDialog) return null;

  return (
    <div className="confirm-overlay" onClick={() => resolve(false)}>
      <div className="confirm-box" onClick={e => e.stopPropagation()}>
        <p className="confirm-msg">{confirmDialog.message}</p>
        <div className="confirm-btns">
          <button className="confirm-btn-cancel" onClick={() => resolve(false)}>取消</button>
          <button className="confirm-btn-ok" onClick={() => resolve(true)}>确认</button>
        </div>
      </div>
    </div>
  );
}
