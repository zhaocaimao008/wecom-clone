import React from 'react';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import Main from './pages/Main';
import QrConfirmPage from './components/QrConfirmPage';
import ConfirmDialog from './components/ConfirmDialog';

// Error boundary — prevents a single component crash from blanking the entire app
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    // Report to server so we can diagnose without DevTools
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message,
          stack: error?.stack?.slice(0, 1000),
          component: info?.componentStack?.slice(0, 500),
          ua: navigator.userAgent,
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 16,
          background: '#f5f5f5', color: '#333',
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>页面出现错误</div>
          <div style={{ fontSize: 13, color: '#888', maxWidth: 320, textAlign: 'center' }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: '8px 24px', borderRadius: 8, border: 'none',
              background: '#07c160', color: '#fff', cursor: 'pointer', fontSize: 14 }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const token          = useStore(s => s.token);
  const showAddAccount = useStore(s => s.showAddAccount);
  const hideAddAccountModal = useStore(s => s.hideAddAccountModal);

  // Detect QR scan mode: mobile user opened /scan?qr=TOKEN
  const qrToken = new URLSearchParams(window.location.search).get('qr');

  // QR scan mode: mobile confirming login
  if (qrToken) {
    if (!token) {
      return (
        <div>
          <Login />
        </div>
      );
    }
    return <QrConfirmPage qrToken={qrToken} />;
  }

  // Normal app flow
  return (
    <>
      {token ? <Main /> : <Login />}

      {/* Add account overlay (密码登录方式) */}
      {token && showAddAccount && (
        <div
          className="add-account-overlay"
          onClick={e => { if (e.target === e.currentTarget) hideAddAccountModal(); }}
        >
          <div className="add-account-modal">
            <Login isModal onClose={hideAddAccountModal} />
          </div>
        </div>
      )}

      <ConfirmDialog />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
