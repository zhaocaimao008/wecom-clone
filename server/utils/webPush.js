'use strict';

const webpush = require('web-push');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BKuWA2ICn8ReN0Ogq9i3B0gbiwc3YZH3i054NdVaKPME1zm3AUyHUgegImgbWk6JMu0QhEdMK8rSbgtyyZQkK5Q';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'kQOcv392pPX-2tbCBYkDsh-6Fh4J94Bfwi1Ni16a7Aw';
const VAPID_EMAIL   = process.env.VAPID_EMAIL        || 'mailto:admin@mixin.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

/**
 * Send a push notification to one subscription record from DB.
 * Silently ignores gone subscriptions (410) — caller should delete them.
 * Returns true on success, false on expected failure (expired/gone).
 */
async function sendPushToSubscription(sub, payload) {
  const pushSub = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  try {
    await webpush.sendNotification(pushSub, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) return false; // expired
    console.error('[webpush] send error', err.statusCode, err.message);
    return false;
  }
}

/**
 * Send push to all subscriptions of a user.
 * Cleans up expired subscriptions automatically.
 */
async function pushToUser(db, userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  const deleteSub = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');
  await Promise.all(subs.map(async sub => {
    const ok = await sendPushToSubscription(sub, payload);
    if (!ok) deleteSub.run(sub.id);
  }));
}

module.exports = { pushToUser, VAPID_PUBLIC };
