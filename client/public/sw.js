/* Service Worker — 企业密信推送通知处理 */

self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); } catch { return; }

  const { title = '新消息', body = '', icon = '/favicon.ico', convId, convType } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/favicon.ico',
      tag: `conv-${convType}-${convId}`,   // same conv collapses into one notification
      renotify: true,
      data: { convId, convType },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { convId, convType } = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If app window already open, focus it and navigate
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'OPEN_CONV', convId, convType });
          return;
        }
      }
      // Otherwise open a new window
      const url = convId ? `/?convId=${convId}&convType=${convType}` : '/';
      return clients.openWindow(url);
    })
  );
});
