/**
 * End-to-end encryption for private messages.
 * Protocol:
 *   - Each user has an ECDH P-256 key pair.
 *   - Private key is encrypted with a master key derived from PBKDF2(password, username).
 *   - Encrypted private key is stored on the server for multi-device access.
 *   - Two users derive a shared AES-GCM key via ECDH.
 *   - Messages are encrypted as JSON: { v:1, iv:"base64", ct:"base64" }
 */

const E2E_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function deriveMasterKey(password, username) {
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(username), iterations: 100000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function generateKeyPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}

async function exportPublicKeyJwk(kp) {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', kp.publicKey));
}

async function encryptPrivateKey(kp, masterKey) {
  const privJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, enc.encode(privJwk));
  return JSON.stringify({ iv: b64(iv), ct: b64(ct) });
}

async function decryptPrivateKey(blob, masterKey) {
  const { iv, ct } = JSON.parse(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, masterKey, unb64(ct));
  const jwk = JSON.parse(dec.decode(pt));
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

async function importPublicKey(jwkStr) {
  const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr;
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function deriveSharedKey(privateKey, recipientPublicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isEncrypted(content) {
  if (typeof content !== 'string' || !content.startsWith('{"v":1,')) return false;
  try { const o = JSON.parse(content); return o.v === E2E_VERSION && !!o.iv && !!o.ct; } catch { return false; }
}

export async function encryptMessage(plaintext, sharedKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, enc.encode(plaintext));
  return JSON.stringify({ v: E2E_VERSION, iv: b64(iv), ct: b64(ct) });
}

export async function decryptMessage(ciphertext, sharedKey) {
  const { iv, ct } = JSON.parse(ciphertext);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, sharedKey, unb64(ct));
  return dec.decode(pt);
}

// ── E2E Manager ───────────────────────────────────────────────────────────────

class E2EManager {
  constructor() {
    this._privateKey  = null;   // CryptoKey
    this._publicKeyJwk = null;  // string
    this._sharedKeys  = new Map(); // userId → CryptoKey
    this._ready       = false;
    this._setupPromise = null;
  }

  get ready() { return this._ready; }

  async setup(password, username, token) {
    if (this._setupPromise) return this._setupPromise;
    this._setupPromise = this._doSetup(password, username, token).catch(err => {
      console.warn('[e2e] setup failed:', err?.message);
      this._setupPromise = null;
    });
    return this._setupPromise;
  }

  async _doSetup(password, username, token) {
    const masterKey = await deriveMasterKey(password, username);
    const headers = { Authorization: `Bearer ${token}` };

    // Try to load existing key from server
    const res = await fetch('/api/keys/me', { headers });
    if (res.ok) {
      const { publicKey, encryptedPrivateKey } = await res.json();
      if (publicKey && encryptedPrivateKey) {
        try {
          this._privateKey  = await decryptPrivateKey(encryptedPrivateKey, masterKey);
          this._publicKeyJwk = publicKey;
          this._ready = true;
          return;
        } catch {
          // Key decryption failed (password changed?), generate new pair
        }
      }
    }

    // Generate and upload a new key pair
    const kp = await generateKeyPair();
    this._privateKey   = kp.privateKey;
    this._publicKeyJwk = await exportPublicKeyJwk(kp);
    const encPriv = await encryptPrivateKey(kp, masterKey);

    await fetch('/api/keys/setup', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: this._publicKeyJwk, encryptedPrivateKey: encPriv }),
    });
    this._ready = true;
  }

  reset() {
    this._privateKey   = null;
    this._publicKeyJwk = null;
    this._sharedKeys.clear();
    this._ready        = false;
    this._setupPromise = null;
  }

  async getSharedKey(userId, token) {
    if (!this._privateKey) return null;
    if (this._sharedKeys.has(userId)) return this._sharedKeys.get(userId);
    try {
      const res = await fetch(`/api/keys/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const { publicKey } = await res.json();
      if (!publicKey) return null;
      const recipientPub = await importPublicKey(publicKey);
      const shared = await deriveSharedKey(this._privateKey, recipientPub);
      this._sharedKeys.set(userId, shared);
      return shared;
    } catch {
      return null;
    }
  }

  evictSharedKey(userId) {
    this._sharedKeys.delete(userId);
  }
}

export const e2e = new E2EManager();
