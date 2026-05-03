import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { connectSocket } from '../socket';

const PHONE_RE = /^1[3-9]\d{9}$/;
const DEPTS = ['研发部','产品部','设计部','运营部','市场部','人事部','财务部','销售部'];

export default function Login({ isModal = false, onClose = null }) {
  // 'phone-pwd' | 'phone-code' | 'account' | 'register'
  const [mode, setMode] = useState('phone-pwd');
  const [form, setForm] = useState({
    phone: '', password: '', code: '',
    username: '', acc_pwd: '',
    display_name: '', reg_phone: '', reg_pwd: '', reg_confirm: '',
    department: '研发部', position: '员工', invite_code: '',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [demoCode, setDemoCode] = useState('');
  const timerRef = useRef(null);
  const { api, setToken } = useStore();

  useEffect(() => () => clearInterval(timerRef.current), []);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const switchMode = (m) => { setMode(m); setError(''); setDemoCode(''); };

  async function sendCode() {
    if (!PHONE_RE.test(form.phone)) { setError('请输入正确的11位手机号'); return; }
    setLoading(true); setError('');
    try {
      const res = await api('/auth/send-code', { method: 'POST', body: { phone: form.phone } });
      setDemoCode(res.demo_code);
      setCountdown(60);
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown(c => { if (c <= 1) { clearInterval(timerRef.current); return 0; } return c - 1; });
      }, 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      let res;
      if (mode === 'phone-pwd') {
        res = await api('/auth/login', { method: 'POST', body: { username: form.phone, password: form.password } });
      } else if (mode === 'phone-code') {
        if (!form.code.trim()) { setError('请输入验证码'); setLoading(false); return; }
        res = await api('/auth/login-phone', { method: 'POST', body: { phone: form.phone, code: form.code } });
      } else if (mode === 'account') {
        res = await api('/auth/login', { method: 'POST', body: { username: form.username, password: form.acc_pwd } });
      } else {
        if (form.reg_pwd !== form.reg_confirm) { setError('两次密码输入不一致'); setLoading(false); return; }
        res = await api('/auth/register', {
          method: 'POST',
          body: {
            username: form.reg_phone,
            password: form.reg_pwd,
            password_confirm: form.reg_confirm,
            display_name: form.display_name,
            department: form.department,
            position: form.position,
            invite_code: form.invite_code,
          },
        });
      }
      setToken(res.token, res.user);
      connectSocket(res.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode !== 'register';

  return (
    <div className={isModal ? 'lp-modal-inner' : 'lp-page'}>
      <div className="lp-box">

        {/* ── Logo / Modal header ── */}
        {isModal ? (
          <div className="lp-modal-header">
            <h2 className="lp-modal-title">添加账户</h2>
            <button className="lp-modal-close" onClick={onClose} title="关闭">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        ) : (
          <div className="lp-logo">
            <div className="lp-logo-icon">
              <svg viewBox="0 0 60 60" width="60" height="60" fill="none">
                <rect width="60" height="60" rx="14" fill="#07c160"/>
                <path d="M25 17c-6.6 0-12 4.5-12 10 0 2.9 1.5 5.5 3.9 7.3l-1.4 4.2 4.7-2.3c1.2.3 2.4.5 3.8.5 6.6 0 12-4.5 12-10S31.6 17 25 17z" fill="white" opacity=".95"/>
                <path d="M41 24c-5.5 0-10 3.7-10 8.3 0 2.4 1.3 4.6 3.4 6.1l-1.3 3.8 4.2-2c1 .3 2.1.4 3.7.4 5.5 0 10-3.7 10-8.3S46.5 24 41 24z" fill="white"/>
              </svg>
            </div>
            <h1 className="lp-logo-title">企业密信</h1>
            <p className="lp-logo-sub">连接企业，沟通未来</p>
          </div>
        )}

        {/* ── Mode tabs ── */}
        <div className="lp-tabs">
          <button className={mode === 'phone-pwd' || mode === 'phone-code' ? 'active' : ''}
            onClick={() => switchMode('phone-pwd')}>手机登录</button>
          <button className={mode === 'account' ? 'active' : ''}
            onClick={() => switchMode('account')}>账号登录</button>
          {!isModal && (
            <button className={mode === 'register' ? 'active' : ''}
              onClick={() => switchMode('register')}>注册</button>
          )}
        </div>

        {/* ── Form ── */}
        <form className="lp-form" onSubmit={submit}>

          {/* 手机登录 */}
          {(mode === 'phone-pwd' || mode === 'phone-code') && (
            <>
              <div className="lp-field">
                <span className="lp-prefix">+86</span>
                <div className="lp-divider" />
                <input
                  className="lp-input"
                  type="tel" inputMode="numeric" maxLength={11}
                  placeholder="请输入手机号"
                  value={form.phone} onChange={set('phone')} required
                  autoComplete="tel"
                />
              </div>

              {mode === 'phone-pwd' ? (
                <div className="lp-field">
                  <input
                    className="lp-input lp-input-full"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="请输入密码"
                    value={form.password} onChange={set('password')} required
                    autoComplete="current-password"
                  />
                  <button type="button" className="lp-eye" onClick={() => setShowPwd(v => !v)}>
                    {showPwd
                      ? <svg viewBox="0 0 24 24" width="18" height="18" fill="#aaa"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                      : <svg viewBox="0 0 24 24" width="18" height="18" fill="#aaa"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                    }
                  </button>
                </div>
              ) : (
                <div className="lp-field lp-code-field">
                  <input
                    className="lp-input lp-input-code"
                    type="text" inputMode="numeric" maxLength={6}
                    placeholder="请输入验证码"
                    value={form.code} onChange={set('code')}
                    autoComplete="one-time-code"
                  />
                  <button
                    type="button"
                    className={`lp-code-btn ${countdown > 0 ? 'sent' : ''}`}
                    onClick={sendCode}
                    disabled={countdown > 0 || loading}
                  >
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </button>
                </div>
              )}

              {demoCode && (
                <div className="lp-demo-code">
                  <span>【演示】验证码</span>
                  <strong>{demoCode}</strong>
                </div>
              )}

              <button
                type="button"
                className="lp-switch-link"
                onClick={() => switchMode(mode === 'phone-pwd' ? 'phone-code' : 'phone-pwd')}
              >
                {mode === 'phone-pwd' ? '短信验证码登录 ›' : '密码登录 ›'}
              </button>
            </>
          )}

          {/* 账号登录 */}
          {mode === 'account' && (
            <>
              <div className="lp-field">
                <input className="lp-input lp-input-full" placeholder="账号 / 手机号"
                  value={form.username} onChange={set('username')} required autoComplete="username" />
              </div>
              <div className="lp-field">
                <input className="lp-input lp-input-full" type="password" placeholder="密码"
                  value={form.acc_pwd} onChange={set('acc_pwd')} required autoComplete="current-password" />
              </div>
            </>
          )}

          {/* 注册 */}
          {mode === 'register' && (
            <>
              <div className="lp-field">
                <span className="lp-prefix">+86</span>
                <div className="lp-divider" />
                <input className="lp-input" type="tel" inputMode="numeric" maxLength={11}
                  placeholder="手机号（作为账号）"
                  value={form.reg_phone} onChange={set('reg_phone')} required autoComplete="tel" />
              </div>
              <div className="lp-field">
                <input className="lp-input lp-input-full" placeholder="姓名"
                  value={form.display_name} onChange={set('display_name')} required />
              </div>
              <div className="lp-field">
                <input className="lp-input lp-input-full" type="password" placeholder="密码（至少6位）"
                  value={form.reg_pwd} onChange={set('reg_pwd')} required autoComplete="new-password" />
              </div>
              <div className="lp-field">
                <input className="lp-input lp-input-full" type="password" placeholder="确认密码"
                  value={form.reg_confirm} onChange={set('reg_confirm')} required autoComplete="new-password" />
              </div>
              <div className="lp-field">
                <input className="lp-input lp-input-full" placeholder="邀请码"
                  value={form.invite_code} onChange={set('invite_code')} required />
              </div>
            </>
          )}

          {error && <p className="lp-error">{error}</p>}

          <button type="submit" className="lp-submit" disabled={loading}>
            {loading ? '请稍候...' : isLogin ? '登录' : '注册'}
          </button>
        </form>

        {/* ── Demo hint ── */}
        {isLogin && !isModal && (
          <div className="lp-demo">
            <p>演示：账号 <strong>admin</strong> 或手机号 <strong>13800138001</strong></p>
            <p>密码均为 <strong>Admin2024</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}
