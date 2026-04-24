import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../store/useStore';
import { AvatarCircle } from './Sidebar';

const AVATAR_COLORS = [
  '#07c160','#576b95','#fa9d3b','#e64340','#10aec2',
  '#7d7d7d','#722ED1','#1989FA','#FF6B6B','#4ECDC4',
];

function applyDarkMode(mode) {
  const root = document.documentElement;
  if (mode === 'on') {
    root.classList.add('dark');
  } else if (mode === 'off') {
    root.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  }
}

export default function Profile() {
  const { currentUser, api, updateCurrentUser, logout } = useStore();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(currentUser || {});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [notifyOn, setNotifyOn] = useState(() => localStorage.getItem('wc_notify') !== 'off');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('wc_dark') || 'system');
  const avatarFileRef = useRef(null);

  useEffect(() => {
    applyDarkMode(darkMode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (darkMode === 'system') applyDarkMode('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [darkMode]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setSaving(true); setMsg('');
    try {
      const user = await api('/users/me', { method: 'PUT', body: form });
      updateCurrentUser(user);
      setEditing(false);
      setMsg('保存成功');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg(e.message);
    } finally { setSaving(false); }
  }

  async function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const res = await fetch('/api/users/me/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('wc_token')}` },
        body: form,
      });
      const user = await res.json();
      if (res.ok) { updateCurrentUser(user); setShowAvatarPicker(false); }
      else setMsg(user.error || '上传失败');
    } catch { setMsg('上传失败'); }
    finally { setUploadingAvatar(false); e.target.value = ''; }
  }

  async function handleColorPick(color) {
    try {
      const user = await api('/users/me', { method: 'PUT', body: { avatar_color: color } });
      updateCurrentUser(user);
      setShowAvatarPicker(false);
    } catch (e) { setMsg(e.message); }
  }

  async function toggleNotify() {
    const next = !notifyOn;
    if (next && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setMsg('请在浏览器设置中允许通知权限');
          setTimeout(() => setMsg(''), 3000);
          return;
        }
      } else if (Notification.permission === 'denied') {
        setMsg('通知权限已被拒绝，请在浏览器设置中手动开启');
        setTimeout(() => setMsg(''), 3000);
        return;
      }
    }
    setNotifyOn(next);
    localStorage.setItem('wc_notify', next ? 'on' : 'off');
  }

  function cycleDark() {
    const cycle = { system: 'on', on: 'off', off: 'system' };
    const next = cycle[darkMode];
    setDarkMode(next);
    localStorage.setItem('wc_dark', next);
  }

  const darkLabel = { system: '跟随系统', on: '已开启', off: '已关闭' };

  if (!currentUser) return null;

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-header">
          {/* Tappable avatar */}
          <div className="avatar-edit-wrap" onClick={() => setShowAvatarPicker(true)} title="修改头像">
            <AvatarCircle
              name={currentUser.display_name}
              color={currentUser.avatar_color}
              url={currentUser.avatar_url}
              size={80} radius={16}
            />
            {/* Always-visible camera badge in corner */}
            <div className="avatar-camera-badge">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="white">
                <path d="M20 5h-3.17L15 3H9L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
              </svg>
            </div>
          </div>
          <div className="profile-header-info">
            <h2>{currentUser.display_name}</h2>
            <p>{currentUser.department} · {currentUser.position}</p>
            <span className="status-online-badge">在线</span>
            <div className="profile-id-row">
              <span className="profile-id-label">企业微信号</span>
              <span className="profile-id-value">{currentUser.user_code}</span>
            </div>
          </div>
          <MyQRCode code={currentUser.user_code} name={currentUser.display_name} />
        </div>

        {/* Avatar picker modal */}
        {showAvatarPicker && (
          <div className="modal-overlay" onClick={() => setShowAvatarPicker(false)}>
            <div className="modal-box" style={{ width: 320 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span>修改头像</span>
                <button className="modal-close" onClick={() => setShowAvatarPicker(false)}>✕</button>
              </div>
              <div className="modal-body">
                <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={handleAvatarFile} />
                <button className="avatar-upload-btn" disabled={uploadingAvatar}
                  onClick={() => avatarFileRef.current?.click()}>
                  {uploadingAvatar ? '上传中...' : '📷 从相册选择图片'}
                </button>
                <div className="avatar-color-label">或选择颜色头像</div>
                <div className="avatar-color-grid">
                  {AVATAR_COLORS.map(c => (
                    <div key={c} className={`avatar-color-swatch ${currentUser.avatar_color === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => handleColorPick(c)}>
                      <span>{currentUser.display_name?.slice(-2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="profile-body">
          {editing ? (
            <div className="profile-form">
              {[
                { key: 'display_name', label: '姓名' },
                { key: 'phone', label: '手机' },
              ].map(f => (
                <div key={f.key} className="profile-field">
                  <label>{f.label}</label>
                  <input value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                </div>
              ))}
              <div className="profile-actions">
                <button className="btn-save" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
                <button className="btn-cancel" onClick={() => { setEditing(false); setForm(currentUser); }}>取消</button>
              </div>
            </div>
          ) : (
            <div className="profile-info">
              {[
                { label: '账号', value: currentUser.username },
                { label: '姓名', value: currentUser.display_name },
                { label: '手机', value: currentUser.phone || '未设置' },
              ].map(f => (
                <div key={f.label} className="info-row">
                  <span className="info-label">{f.label}</span>
                  <span className="info-value">{f.value}</span>
                </div>
              ))}
              <button className="btn-edit" onClick={() => setEditing(true)}>编辑资料</button>
            </div>
          )}
        </div>

        {msg && <div className="save-msg">{msg}</div>}

        <div className="profile-settings">
          <h3>设置</h3>

          <div className="settings-row" onClick={toggleNotify} style={{ cursor: 'pointer' }}>
            <span className="settings-icon">🔔</span>
            <span className="settings-label">消息通知</span>
            <div className={`toggle-switch ${notifyOn ? 'on' : ''}`}>
              <div className="toggle-knob" />
            </div>
          </div>

          <div className="settings-row" style={{ cursor: 'pointer' }}
            onClick={() => setShowPrivacy(v => !v)}>
            <span className="settings-icon">🔒</span>
            <span className="settings-label">隐私设置</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc"
              style={{ transform: showPrivacy ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
            </svg>
          </div>
          {showPrivacy && (
            <div className="privacy-sub">
              {[
                { label: '允许通过手机号添加我', defaultOn: true },
                { label: '允许搜索我的账号', defaultOn: true },
                { label: '加我为好友需要验证', defaultOn: false },
                { label: '允许查看我的朋友圈', defaultOn: true },
              ].map(item => <PrivacyRow key={item.label} label={item.label} defaultOn={item.defaultOn} />)}
            </div>
          )}

          <div className="settings-row" onClick={cycleDark} style={{ cursor: 'pointer' }}>
            <span className="settings-icon">🌙</span>
            <span className="settings-label">深色模式</span>
            <span className="settings-value">{darkLabel[darkMode]}</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
          </div>

          <div className="settings-row">
            <span className="settings-icon">📱</span>
            <span className="settings-label">关于企业微信</span>
            <span className="settings-value">v4.1.0</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
          </div>
        </div>

        <button className="btn-logout" onClick={logout}>退出登录</button>
      </div>
    </div>
  );
}

function PrivacyRow({ label, defaultOn }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="settings-row privacy-row" onClick={() => setOn(v => !v)} style={{ cursor: 'pointer' }}>
      <span className="settings-label" style={{ fontSize: 13 }}>{label}</span>
      <div className={`toggle-switch ${on ? 'on' : ''}`}>
        <div className="toggle-knob" />
      </div>
    </div>
  );
}

function MyQRCode({ code, name }) {
  const [qrUrl, setQrUrl] = useState('');
  const [showBig, setShowBig] = useState(false);
  const [bigUrl, setBigUrl] = useState('');

  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`wecom_code:${code}`, { width: 80, margin: 1, color: { dark: '#000', light: '#fff' } })
      .then(setQrUrl).catch(() => {});
  }, [code]);

  function openBig() {
    QRCode.toDataURL(`wecom_code:${code}`, { width: 280, margin: 2 })
      .then(url => { setBigUrl(url); setShowBig(true); }).catch(() => {});
  }

  if (!qrUrl) return null;
  return (
    <>
      <div className="profile-qr-wrap" onClick={openBig} title="查看我的二维码">
        <img src={qrUrl} alt="QR" className="profile-qr-img" />
        <span className="profile-qr-hint">二维码</span>
      </div>
      {showBig && (
        <div className="modal-overlay" onClick={() => setShowBig(false)}>
          <div className="modal-box qr-big-box" onClick={e => e.stopPropagation()}>
            <div className="qr-big-header">
              <span>{name}的二维码</span>
              <button className="modal-close" onClick={() => setShowBig(false)}>✕</button>
            </div>
            <div className="qr-big-body">
              <img src={bigUrl} alt="QR" className="qr-big-img" />
              <p className="qr-big-code">企业微信号：{code}</p>
              <p className="qr-big-tip">扫一扫上面的二维码，可以添加好友</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
