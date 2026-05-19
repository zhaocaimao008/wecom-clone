import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';
import { SERVER } from '../config';

export default function QrConfirmPage({ qrToken }) {
  const currentUser = useStore(s => s.currentUser);
  const token       = useStore(s => s.token);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [errMsg, setErrMsg] = useState('');

  function exitScan() {
    // Remove qr param and go back to main app
    window.history.replaceState({}, '', window.location.pathname);
    window.location.reload();
  }

  async function confirm() {
    setStatus('loading');
    try {
      const res = await fetch(`${SERVER}/api/auth/qr/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ qrToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrMsg(data.error || '确认失败');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch {
      setErrMsg('网络错误，请重试');
      setStatus('error');
    }
  }

  return (
    <div className="qr-confirm-page">
      <div className="qr-confirm-card">
        <div className="qr-confirm-logo">
          <svg viewBox="0 0 40 40" width="40" height="40" fill="none">
            <rect width="40" height="40" rx="10" fill="#07c160"/>
            <path d="M12 28c-3.3 0-6-2.3-6-5 0-1.6.9-3 2.2-3.9L8 16l2.7 1.3c.4-.1.9-.2 1.3-.2 3.3 0 6 2.3 6 5s-2.7 5-6 5zm16-8c-2.3 0-4.3-1.1-5.4-2.7A7 7 0 0 0 20 21c0 3.9 3.6 7 8 7l.4.2-1.6-4c1.3-.9 2.2-2.2 2.2-3.6 0-2.7-2.7-5-6-5-.4 0-.9 0-1.3.1C22.9 14.3 24.8 13 27 13c3.3 0 6 2.3 6 5s-2.7 5-6 5z" fill="#fff"/>
          </svg>
          <span className="qr-confirm-app-name">密信</span>
        </div>

        <div className="qr-confirm-title">扫码登录确认</div>

        {status === 'idle' || status === 'loading' || status === 'error' ? (
          <>
            <div className="qr-confirm-user">
              <AvatarCircle
                name={currentUser?.display_name}
                color={currentUser?.avatar_color}
                url={currentUser?.avatar_url}
                size={56} radius={14}
              />
              <div className="qr-confirm-user-info">
                <div className="qr-confirm-name">{currentUser?.display_name}</div>
                <div className="qr-confirm-sub">@{currentUser?.username}</div>
              </div>
            </div>

            <p className="qr-confirm-desc">
              你正在授权此账号登录<strong>桌面版密信</strong>，<br/>
              确认后桌面端将使用此账号进入。
            </p>

            {status === 'error' && (
              <div className="qr-confirm-err">{errMsg}</div>
            )}

            <div className="qr-confirm-btns">
              <button className="qr-confirm-cancel" onClick={exitScan} disabled={status === 'loading'}>
                取消
              </button>
              <button className="qr-confirm-ok" onClick={confirm} disabled={status === 'loading'}>
                {status === 'loading' ? '确认中...' : '确认登录'}
              </button>
            </div>
          </>
        ) : (
          /* status === 'done' */
          <div className="qr-confirm-success">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="#07c160">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
            <div className="qr-confirm-done-title">授权成功！</div>
            <p className="qr-confirm-done-desc">桌面端已登录，你可以关闭此页面了。</p>
            <button className="qr-confirm-cancel" onClick={exitScan}>返回首页</button>
          </div>
        )}
      </div>
    </div>
  );
}
