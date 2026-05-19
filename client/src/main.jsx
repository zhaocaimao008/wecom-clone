import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Capacitor native plugins (no-op on web)
async function initNative() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;

    const [{ StatusBar, Style }, { SplashScreen }, { Keyboard }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
      import('@capacitor/keyboard'),
    ]);

    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#07c160' });
    await StatusBar.setOverlaysWebView({ overlay: true });

    await SplashScreen.hide({ fadeOutDuration: 300 });

    Keyboard.addListener('keyboardWillShow', info => {
      document.documentElement.style.setProperty(
        '--keyboard-height', `${info.keyboardHeight}px`
      );
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
    });
  } catch {
    // Not a native build, skip
  }
}

initNative();

// Global error traps — catch errors that happen outside React's ErrorBoundary
window.addEventListener('error', e => {
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: e.message,
        stack: e.error?.stack?.slice(0, 1000),
        source: e.filename + ':' + e.lineno,
        ua: navigator.userAgent,
        ts: Date.now(),
        kind: 'global-error',
      }),
    }).catch(() => {});
  } catch {}
});

window.addEventListener('unhandledrejection', e => {
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(e.reason?.message || e.reason),
        stack: e.reason?.stack?.slice(0, 1000),
        ua: navigator.userAgent,
        ts: Date.now(),
        kind: 'unhandled-rejection',
      }),
    }).catch(() => {});
  } catch {}
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// Remove the HTML loading spinner once React has rendered
requestAnimationFrame(() => {
  const loader = document.getElementById('app-loading');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 300);
  }
});
