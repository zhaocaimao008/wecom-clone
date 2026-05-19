import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { connectAnonSocket, disconnectAnonSocket } from '../socket';
import QRCode from 'qrcode';
import { SERVER } from '../config';
import TitleBar from '../components/TitleBar';
import { e2e } from '../crypto/e2e';

const PHONE_RE   = /^1[3-9]\d{9}$/;
const EXPIRE_SEC = 180;

// ── QR Code core logic ────────────────────────────────────────────────────────
function useQrLogin(onSuccess) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [status,    setStatus]    = useState('loading');
  const [countdown, setCountdown] = useState(EXPIRE_SEC);
  const mountedRef = useRef(true);
  const timerRef   = useRef(null);
  const expireRef  = useRef(null);
  const pollRef    = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    connectAnonSocket();
    return () => { mountedRef.current = false; disconnectAnonSocket(); };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    clearInterval(timerRef.current);
    clearTimeout(expireRef.current);
    clearInterval(pollRef.current);
    setStatus('loading'); setCountdown(EXPIRE_SEC); setQrDataUrl('');

    try {
      const res = await fetch(`${SERVER}/api/auth/qr/create`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const { qrToken } = await res.json();
      if (!mountedRef.current) return;

      const dataUrl = await QRCode.toDataURL(
        `${window.location.origin}/scan?qr=${qrToken}`,
        { width: 220, margin: 1, color: { dark: '#111', light: '#fff' } }
      );
      if (!mountedRef.current) return;
      setQrDataUrl(dataUrl);
      setStatus('ready');

      let remaining = EXPIRE_SEC;
      timerRef.current = setInterval(() => {
        remaining -= 1;
        if (mountedRef.current) setCountdown(remaining);
        if (remaining <= 0) { clearInterval(timerRef.current); if (mountedRef.current) setStatus('expired'); }
      }, 1000);

      const sock = connectAnonSocket();
      if (sock) {
        sock.emit('qr_subscribe', { qrToken });
        const handler = ({ token, user }) => {
          if (!mountedRef.current) return;
          clearInterval(timerRef.current); clearTimeout(expireRef.current); clearInterval(pollRef.current);
          setStatus('confirmed');
          setTimeout(() => { if (mountedRef.current) onSuccess(token, user); }, 700);
        };
        sock.once('qr_login_done', handler);
        expireRef.current = setTimeout(() => sock.off('qr_login_done', handler), EXPIRE_SEC * 1000);
      } else {
        pollRef.current = setInterval(async () => {
          try {
            const r = await fetch(`${SERVER}/api/auth/qr/status/${qrToken}`);
            const d = await r.json();
            if (!mountedRef.current) return;
            if (d.status === 'confirmed') {
              clearInterval(pollRef.current); clearInterval(timerRef.current);
              setStatus('confirmed');
              setTimeout(() => { if (mountedRef.current) onSuccess(d.token, d.user); }, 700);
            } else if (d.status === 'expired') {
              clearInterval(pollRef.current); clearInterval(timerRef.current); setStatus('expired');
            }
          } catch {}
        }, 2000);
      }
    } catch { if (mountedRef.current) setStatus('error'); }
  }, [onSuccess]);

  useEffect(() => {
    refresh();
    return () => { clearInterval(timerRef.current); clearTimeout(expireRef.current); clearInterval(pollRef.current); };
  }, []);

  return { qrDataUrl, status, countdown, refresh };
}

// ── QR display panel ──────────────────────────────────────────────────────────
function QrDisplay({ onSuccess }) {
  const { qrDataUrl, status, countdown, refresh } = useQrLogin(onSuccess);
  const isExpired = status === 'expired' || status === 'error';
  const cdColor   = countdown <= 30 ? '#ff6b6b' : countdown <= 60 ? '#ffa94d' : 'rgba(255,255,255,0.35)';

  return (
    <div className="dl-qr-section">
      <div className="dl-qr-frame">
        {/* QR image */}
        {qrDataUrl && (
          <img src={qrDataUrl} alt="扫码登录" className="dl-qr-img"
            style={{ opacity: isExpired ? 0.12 : status === 'loading' ? 0 : 1 }} />
        )}

        {/* Loading */}
        {status === 'loading' && (
          <div className="dl-qr-overlay">
            <div className="dl-qr-spinner" />
          </div>
        )}

        {/* Confirmed */}
        {status === 'confirmed' && (
          <div className="dl-qr-overlay dl-qr-ok">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="#07c160">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
            <span>登录成功</span>
          </div>
        )}

        {/* Expired / error */}
        {isExpired && (
          <div className="dl-qr-overlay dl-qr-expired">
            <span className="dl-qr-expired-text">
              {status === 'error' ? '生成失败' : '二维码已失效'}
            </span>
            <button className="dl-qr-refresh-btn" onClick={refresh}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ marginRight: 4 }}>
                <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
              点击刷新
            </button>
          </div>
        )}
      </div>

      {/* Countdown — only visible when ready */}
      <div className="dl-qr-countdown" style={{ color: cdColor, opacity: status === 'ready' ? 1 : 0 }}>
        {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
      </div>
    </div>
  );
}

// ── Form login (account / phone / register) ───────────────────────────────────
function FormPanel({ initTab = 'account', isModal = false, onClose, onBackToQr }) {
  const [tab,       setTab]     = useState(initTab);
  const [form,      setForm]    = useState({
    phone: '', password: '', code: '',
    username: '', acc_pwd: '',
    display_name: '', reg_phone: '', reg_pwd: '', reg_confirm: '', invite_code: '',
  });
  const [showPwd,   setShowPwd] = useState(false);
  const [error,     setError]   = useState('');
  const [loading,   setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef(null);
  const { api, addAccount } = useStore();

  useEffect(() => () => clearInterval(timerRef.current), []);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const switchTab = t => { setTab(t); setError(''); setShowPwd(false); };

  async function sendCode() {
    if (!PHONE_RE.test(form.phone)) { setError('请输入正确的11位手机号'); return; }
    setLoading(true); setError('');
    try {
      await api('/auth/send-code', { method: 'POST', body: { phone: form.phone } });
      setCountdown(60);
      timerRef.current = setInterval(() => {
        setCountdown(c => { if (c <= 1) { clearInterval(timerRef.current); return 0; } return c - 1; });
      }, 1000);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      let res;
      if (tab === 'phone-pwd') {
        res = await api('/auth/login', { method: 'POST', body: { username: form.phone, password: form.password } });
      } else if (tab === 'phone-code') {
        if (!form.code.trim()) { setError('请输入验证码'); setLoading(false); return; }
        res = await api('/auth/login-phone', { method: 'POST', body: { phone: form.phone, code: form.code } });
      } else if (tab === 'account') {
        res = await api('/auth/login', { method: 'POST', body: { username: form.username, password: form.acc_pwd } });
      } else {
        if (form.reg_pwd !== form.reg_confirm) { setError('两次密码输入不一致'); setLoading(false); return; }
        res = await api('/auth/register', {
          method: 'POST',
          body: { username: form.reg_phone, password: form.reg_pwd, password_confirm: form.reg_confirm, display_name: form.display_name, invite_code: form.invite_code },
        });
      }
      addAccount(res.token, res.user);
      // Set up E2EE keys (password-based logins only)
      const pwd = tab === 'phone-pwd' ? form.password : tab === 'account' ? form.acc_pwd : tab === 'register' ? form.reg_pwd : null;
      if (pwd && res.user?.username) {
        e2e.setup(pwd, res.user.username, res.token).catch(() => {});
      }
      if (onClose) onClose();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className={isModal ? 'fp-modal' : 'fp-page'}>
      {/* Back arrow */}
      {!isModal && onBackToQr && (
        <button className="fp-back" onClick={onBackToQr}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          返回扫码
        </button>
      )}

      {/* Tabs */}
      <div className="fp-tabs">
        <button className={tab === 'phone-pwd' || tab === 'phone-code' ? 'active' : ''} onClick={() => switchTab('phone-pwd')}>手机登录</button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => switchTab('account')}>账号登录</button>
        {!isModal && <button className={tab === 'register' ? 'active' : ''} onClick={() => switchTab('register')}>注册</button>}
      </div>

      <form className="fp-form" onSubmit={submit}>
        {/* 手机登录 */}
        {(tab === 'phone-pwd' || tab === 'phone-code') && (<>
          <div className="fp-field">
            <span className="fp-prefix">+86</span>
            <div className="fp-line" />
            <input className="fp-input" type="tel" inputMode="numeric" maxLength={11}
              placeholder="手机号" value={form.phone} onChange={set('phone')} required autoComplete="tel" />
          </div>
          {tab === 'phone-pwd' ? (
            <div className="fp-field">
              <input className="fp-input" type={showPwd ? 'text' : 'password'}
                placeholder="密码" value={form.password} onChange={set('password')} required autoComplete="current-password" />
              <button type="button" className="fp-eye" onClick={() => setShowPwd(v => !v)}>
                {showPwd
                  ? <svg viewBox="0 0 24 24" width="17" height="17" fill="rgba(255,255,255,0.4)"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                  : <svg viewBox="0 0 24 24" width="17" height="17" fill="rgba(255,255,255,0.4)"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                }
              </button>
            </div>
          ) : (
            <div className="fp-field fp-code-row">
              <input className="fp-input" type="text" inputMode="numeric" maxLength={6}
                placeholder="验证码" value={form.code} onChange={set('code')} autoComplete="one-time-code" />
              <button type="button" className={`fp-sms-btn ${countdown > 0 ? 'sent' : ''}`}
                onClick={sendCode} disabled={countdown > 0 || loading}>
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          )}
          <button type="button" className="fp-toggle"
            onClick={() => switchTab(tab === 'phone-pwd' ? 'phone-code' : 'phone-pwd')}>
            {tab === 'phone-pwd' ? '短信验证码登录 ›' : '密码登录 ›'}
          </button>
        </>)}

        {/* 账号登录 */}
        {tab === 'account' && (<>
          <div className="fp-field">
            <input className="fp-input" placeholder="账号 / 手机号"
              value={form.username} onChange={set('username')} required autoComplete="username" />
          </div>
          <div className="fp-field">
            <input className="fp-input" type="password" placeholder="密码"
              value={form.acc_pwd} onChange={set('acc_pwd')} required autoComplete="current-password" />
          </div>
        </>)}

        {/* 注册 */}
        {tab === 'register' && (<>
          <div className="fp-field">
            <span className="fp-prefix">+86</span><div className="fp-line" />
            <input className="fp-input" type="tel" inputMode="numeric" maxLength={11}
              placeholder="手机号（作为账号）" value={form.reg_phone} onChange={set('reg_phone')} required autoComplete="tel" />
          </div>
          <div className="fp-field"><input className="fp-input" placeholder="昵称" value={form.display_name} onChange={set('display_name')} required /></div>
          <div className="fp-field"><input className="fp-input" type="password" placeholder="密码（至少6位）" value={form.reg_pwd} onChange={set('reg_pwd')} required autoComplete="new-password" /></div>
          <div className="fp-field"><input className="fp-input" type="password" placeholder="确认密码" value={form.reg_confirm} onChange={set('reg_confirm')} required autoComplete="new-password" /></div>
          <div className="fp-field"><input className="fp-input" placeholder="邀请码" value={form.invite_code} onChange={set('invite_code')} required /></div>
        </>)}

        {error && <p className="fp-error">{error}</p>}
        <button type="submit" className="fp-submit" disabled={loading}>
          {loading ? '请稍候...' : tab === 'register' ? '注册' : '登录'}
        </button>
      </form>
    </div>
  );
}

// ── Main Login ─────────────────────────────────────────────────────────────────
export default function Login({ isModal = false, onClose = null }) {
  const [view,    setView]    = useState('qr');   // 'qr' | 'account' | 'phone' | 'register'
  const { addAccount } = useStore();

  function handleQrSuccess(token, user) {
    addAccount(token, user);
    if (onClose) onClose();
  }

  // ── Modal (adding second account) ──────────────────────────────────────────
  if (isModal) {
    return (
      <div className="lp-modal-inner">
        <div className="lp-box">
          <div className="lp-modal-header">
            <h2 className="lp-modal-title">添加账户</h2>
            <button className="lp-modal-close" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          {view === 'qr' ? (
            <>
              <QrDisplay onSuccess={handleQrSuccess} />
              <div className="dl-or"><span>或</span></div>
              <button className="dl-alt-btn" onClick={() => setView('account')}>账号密码登录</button>
            </>
          ) : (
            <FormPanel isModal onClose={onClose} onBackToQr={() => setView('qr')}
              initTab={view === 'phone' ? 'phone-pwd' : view === 'register' ? 'register' : 'account'} />
          )}
        </div>
      </div>
    );
  }

  // ── Full-page (dark 密信 style) ───────────────────────────────────────────
  return (
    <div className="dl-page">
      <TitleBar />

      {view === 'qr' ? (
        /* ── QR view ── */
        <div className="dl-center">
          {/* Logo */}
          <div className="dl-logo">
            <svg viewBox="0 0 60 60" width="52" height="52" fill="none">
              <rect width="60" height="60" rx="13" fill="#07c160"/>
              <path d="M25 17c-6.6 0-12 4.5-12 10 0 2.9 1.5 5.5 3.9 7.3l-1.4 4.2 4.7-2.3c1.2.3 2.4.5 3.8.5 6.6 0 12-4.5 12-10S31.6 17 25 17z" fill="white" opacity=".95"/>
              <path d="M41 24c-5.5 0-10 3.7-10 8.3 0 2.4 1.3 4.6 3.4 6.1l-1.3 3.8 4.2-2c1 .3 2.1.4 3.7.4 5.5 0 10-3.7 10-8.3S46.5 24 41 24z" fill="white"/>
            </svg>
            <span className="dl-logo-name">密信</span>
          </div>

          {/* QR */}
          <QrDisplay onSuccess={handleQrSuccess} />

          {/* Hint */}
          <p className="dl-hint">使用手机「密信」扫一扫登录</p>

          {/* Login entry links */}
          <div className="dl-entries">
            <button onClick={() => setView('account')}>账号密码登录</button>
            <span className="dl-dot" />
            <button onClick={() => setView('phone')}>手机号登录</button>
            <span className="dl-dot" />
            <button onClick={() => setView('register')}>注册</button>
          </div>
        </div>
      ) : (
        /* ── Form view ── */
        <div className="dl-center dl-center-form">
          <div className="dl-logo dl-logo-sm">
            <svg viewBox="0 0 60 60" width="38" height="38" fill="none">
              <rect width="60" height="60" rx="13" fill="#07c160"/>
              <path d="M25 17c-6.6 0-12 4.5-12 10 0 2.9 1.5 5.5 3.9 7.3l-1.4 4.2 4.7-2.3c1.2.3 2.4.5 3.8.5 6.6 0 12-4.5 12-10S31.6 17 25 17z" fill="white" opacity=".95"/>
              <path d="M41 24c-5.5 0-10 3.7-10 8.3 0 2.4 1.3 4.6 3.4 6.1l-1.3 3.8 4.2-2c1 .3 2.1.4 3.7.4 5.5 0 10-3.7 10-8.3S46.5 24 41 24z" fill="white"/>
            </svg>
            <span className="dl-logo-name">密信</span>
          </div>
          <FormPanel
            initTab={view === 'phone' ? 'phone-pwd' : view === 'register' ? 'register' : 'account'}
            onBackToQr={() => setView('qr')}
          />
        </div>
      )}
    </div>
  );
}
