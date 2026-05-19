import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket';
import { SERVER } from '../config';

const EXPIRE_SEC = 180; // 3 minutes

export default function QrLoginModal({ onClose }) {
  const addAccount = useStore(s => s.addAccount);

  const [qrToken,   setQrToken]   = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [scanUrl,   setScanUrl]   = useState('');
  const [status,    setStatus]    = useState('loading'); // loading|ready|confirmed|expired|error
  const [countdown, setCountdown] = useState(EXPIRE_SEC);
  const [copied,    setCopied]    = useState(false);

  const timerRef    = useRef(null); // countdown interval
  const expireRef   = useRef(null); // expiry timeout
  const pollRef     = useRef(null); // fallback polling interval
  const mountedRef  = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Generate QR ────────────────────────────────────────────────────────
  const createQr = useCallback(async () => {
    if (!mountedRef.current) return;
    // Clean previous timers
    clearInterval(timerRef.current);
    clearTimeout(expireRef.current);
    clearInterval(pollRef.current);

    setStatus('loading');
    setCountdown(EXPIRE_SEC);
    setQrDataUrl('');
    setQrToken(null);

    try {
      const res = await fetch(`${SERVER}/api/auth/qr/create`, { method: 'POST' });
      if (!res.ok) throw new Error('创建失败');
      const { qrToken: token } = await res.json();
      if (!mountedRef.current) return;

      // QR content: the /scan URL (works for mobile browser)
      const scanUrl = `${window.location.origin}/scan?qr=${token}`;
      setScanUrl(scanUrl);
      const dataUrl = await QRCode.toDataURL(scanUrl, {
        width: 240, margin: 2,
        color: { dark: '#111', light: '#fff' },
      });
      if (!mountedRef.current) return;

      setQrToken(token);
      setQrDataUrl(dataUrl);
      setStatus('ready');

      // Countdown timer
      let remaining = EXPIRE_SEC;
      timerRef.current = setInterval(() => {
        remaining -= 1;
        if (mountedRef.current) setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(timerRef.current);
          if (mountedRef.current) setStatus('expired');
        }
      }, 1000);

      // Subscribe via Socket for instant notification
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('qr_subscribe', { qrToken: token });
        const handler = ({ token: jwt, user }) => {
          if (!mountedRef.current) return;
          clearInterval(timerRef.current);
          clearTimeout(expireRef.current);
          clearInterval(pollRef.current);
          setStatus('confirmed');
          setTimeout(() => {
            if (mountedRef.current) { addAccount(jwt, user); onClose(); }
          }, 900);
        };
        socket.once('qr_login_done', handler);
        // Remove listener if modal closes before scan
        expireRef.current = setTimeout(() => socket.off('qr_login_done', handler), EXPIRE_SEC * 1000);
      } else {
        // Fallback: poll every 2s
        pollRef.current = setInterval(async () => {
          try {
            const r  = await fetch(`${SERVER}/api/auth/qr/status/${token}`);
            const data = await r.json();
            if (!mountedRef.current) return;
            if (data.status === 'confirmed') {
              clearInterval(pollRef.current);
              clearInterval(timerRef.current);
              setStatus('confirmed');
              setTimeout(() => {
                if (mountedRef.current) { addAccount(data.token, data.user); onClose(); }
              }, 900);
            } else if (data.status === 'expired') {
              clearInterval(pollRef.current);
              clearInterval(timerRef.current);
              setStatus('expired');
            }
          } catch { /* network hiccup, keep polling */ }
        }, 2000);
      }
    } catch {
      if (mountedRef.current) setStatus('error');
    }
  }, [addAccount, onClose]);

  useEffect(() => {
    createQr();
    return () => {
      clearInterval(timerRef.current);
      clearTimeout(expireRef.current);
      clearInterval(pollRef.current);
    };
  }, []);

  // ── Backdrop click to close ───────────────────────────────────────────
  function handleMask(e) {
    if (e.target === e.currentTarget) onClose();
  }

  // ── Countdown color ───────────────────────────────────────────────────
  const countdownColor = countdown <= 30 ? '#e64340' : countdown <= 60 ? '#fa9d3b' : '#888';

  return (
    <div className="qr-modal-mask" onClick={handleMask}>
      <div className="qr-modal-box">
        {/* 关闭 */}
        <button className="qr-modal-close" onClick={onClose} title="关闭">✕</button>

        <div className="qr-modal-title">扫码添加账号</div>
        <div className="qr-modal-subtitle">使用手机端「密信」扫描二维码</div>

        {/* QR 区域 */}
        <div className="qr-code-area">
          {status === 'loading' && (
            <div className="qr-state-center">
              <div className="qr-spinner" />
              <span>生成中...</span>
            </div>
          )}

          {(status === 'ready') && qrDataUrl && (
            <img src={qrDataUrl} alt="登录二维码" className="qr-code-img" />
          )}

          {status === 'confirmed' && (
            <div className="qr-state-center qr-state-success">
              <svg viewBox="0 0 24 24" width="56" height="56" fill="#07c160">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              <span>登录成功，正在切换…</span>
            </div>
          )}

          {(status === 'expired' || status === 'error') && (
            <div className="qr-state-center qr-state-expired">
              {qrDataUrl && (
                <img src={qrDataUrl} alt="" className="qr-code-img qr-code-dim" />
              )}
              <div className="qr-expired-overlay">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="#e64340">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <span>{status === 'expired' ? '二维码已失效' : '生成失败'}</span>
                <button className="qr-refresh-btn" onClick={createQr}>点击刷新</button>
              </div>
            </div>
          )}
        </div>

        {/* 倒计时 */}
        {status === 'ready' && (
          <div className="qr-countdown" style={{ color: countdownColor }}>
            二维码有效期 {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
          </div>
        )}

        {/* 扫码链接（可复制，方便手动打开）*/}
        {status === 'ready' && scanUrl && (
          <div className="qr-scan-url-row">
            <span className="qr-scan-url-text" title={scanUrl}>
              {scanUrl.length > 42 ? scanUrl.slice(0, 42) + '…' : scanUrl}
            </span>
            <button
              className="qr-copy-btn"
              onClick={async () => {
                try { await navigator.clipboard.writeText(scanUrl); } catch { }
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        )}

        {/* 底部切换 */}
        <div className="qr-modal-footer">
          <span style={{ fontSize: 12, color: '#bbb' }}>没有手机？</span>
          <button className="qr-alt-btn" onClick={() => { onClose(); useStore.getState().showAddAccountModal(); }}>
            账号密码登录
          </button>
        </div>
      </div>
    </div>
  );
}
