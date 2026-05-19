'use strict';

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { VAPID_PUBLIC } = require('../utils/webPush');

module.exports = (db) => {
  const router = express.Router();

  // Return public VAPID key — no auth needed (client needs this before login to register SW)
  router.get('/vapid-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC });
  });

  // Save push subscription for the logged-in user
  router.post('/subscribe', authMiddleware, (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: '订阅信息不完整' });
    }
    try {
      db.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth
      `).run(req.user.id, endpoint, keys.p256dh, keys.auth);
      res.json({ ok: true });
    } catch (err) {
      console.error('[push] subscribe error', err);
      res.status(500).json({ error: '保存订阅失败' });
    }
  });

  // Remove push subscription (user unsubscribed or logged out)
  router.delete('/subscribe', authMiddleware, (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: '缺少 endpoint' });
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(req.user.id, endpoint);
    res.json({ ok: true });
  });

  return router;
};
