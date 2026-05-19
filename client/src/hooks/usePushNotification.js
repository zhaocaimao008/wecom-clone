import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

function authFetch(path, options = {}) {
  const token = useStore.getState().token;
  return fetch(path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function getVapidKey() {
  const res = await fetch('/api/push/vapid-key');
  if (!res.ok) return null;
  const { publicKey } = await res.json();
  return publicKey;
}

async function registerAndSubscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;

  // Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  // Register service worker
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  // Check for existing subscription first
  let sub = await reg.pushManager.getSubscription();
  if (sub) return sub;

  // Create new subscription
  const vapidKey = await getVapidKey();
  if (!vapidKey) return null;

  sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  return sub;
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  await authFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

async function removeSubscription(sub) {
  if (!sub) return;
  const json = sub.toJSON();
  await authFetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * Register push notifications for the current user.
 * Automatically unsubscribes when the component unmounts (logout).
 */
export function usePushNotification(token) {
  const subRef = useRef(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    registerAndSubscribe()
      .then(sub => {
        if (cancelled || !sub) return;
        subRef.current = sub;
        return saveSubscription(sub);
      })
      .catch(err => console.warn('[push] setup failed:', err?.message));

    return () => {
      cancelled = true;
      // Unsubscribe on logout but keep SW registered for next login
      if (subRef.current) {
        removeSubscription(subRef.current).catch(() => {});
        subRef.current = null;
      }
    };
  }, [token]);
}

/**
 * Wire up SW → store navigation when user clicks a notification.
 */
export function usePushNavigation(onNavigate) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = event => {
      if (event.data?.type === 'OPEN_CONV') {
        onNavigate({ convId: event.data.convId, convType: event.data.convType });
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [onNavigate]);
}
