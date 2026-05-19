'use strict';

const express = require('express');
const authMiddleware = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();
  router.use(authMiddleware);

  // Get own encrypted key bundle (for multi-device sync)
  router.get('/me', (req, res) => {
    const row = db.prepare('SELECT public_key, encrypted_private_key FROM users WHERE id=?').get(req.user.id);
    res.json({ publicKey: row.public_key || null, encryptedPrivateKey: row.encrypted_private_key || null });
  });

  // Upload / rotate key pair
  router.post('/setup', (req, res) => {
    const { publicKey, encryptedPrivateKey } = req.body || {};
    if (typeof publicKey !== 'string' || typeof encryptedPrivateKey !== 'string')
      return res.status(400).json({ error: '缺少密钥参数' });
    if (publicKey.length > 2000 || encryptedPrivateKey.length > 8000)
      return res.status(400).json({ error: '密钥数据过长' });
    db.prepare('UPDATE users SET public_key=?, encrypted_private_key=? WHERE id=?')
      .run(publicKey, encryptedPrivateKey, req.user.id);
    res.json({ ok: true });
  });

  // Get any user's public key (needed for ECDH key exchange)
  router.get('/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0)
      return res.status(400).json({ error: '无效的用户ID' });
    const row = db.prepare('SELECT public_key FROM users WHERE id=?').get(userId);
    if (!row) return res.status(404).json({ error: '用户不存在' });
    res.json({ publicKey: row.public_key || null });
  });

  return router;
};
