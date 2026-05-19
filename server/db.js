const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const db = new Database(path.join(__dirname, 'wecom.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations — columns
['mute_all', 'restrict_add_friend', 'restrict_private_chat'].forEach(col => {
  try { db.exec(`ALTER TABLE chat_groups ADD COLUMN ${col} INTEGER DEFAULT 0`); } catch (_) {}
});
try { db.exec('ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE messages ADD COLUMN client_msg_id TEXT'); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN user_code TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE chat_groups ADD COLUMN group_code TEXT`); } catch (_) {}
try { db.exec('ALTER TABLE message_reads ADD COLUMN read_at TEXT'); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN privacy TEXT DEFAULT NULL`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN can_invite INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE chat_groups ADD COLUMN avatar_url TEXT`); } catch (_) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_code ON users(user_code) WHERE user_code IS NOT NULL`); } catch (_) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg_id ON messages(sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(sender_id, receiver_id) WHERE group_id IS NULL`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id) WHERE group_id IS NOT NULL`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id, contact_id)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_message_reads_message_id ON message_reads(message_id)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_message_reads_covering ON message_reads(message_id, user_id, read_at)`); } catch (_) {}
// Per-member mute: null=not muted, 0=permanent, future epoch ms=muted until
try { db.exec(`ALTER TABLE group_members ADD COLUMN muted_until INTEGER DEFAULT NULL`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_id_group ON messages(id, group_id) WHERE group_id IS NOT NULL`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_friend_requests_to_status ON friend_requests(to_id, status)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_recalled ON messages(recalled) WHERE recalled=0`); } catch (_) {}
// Add 'card' to msg_type CHECK constraint via table recreation (SQLite doesn't support ALTER COLUMN)
try {
  const col = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
  if (col && col.sql && col.sql.includes("'text', 'voice', 'image', 'file'") && !col.sql.includes("'card'")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          receiver_id INTEGER,
          group_id INTEGER,
          content TEXT NOT NULL,
          msg_type TEXT DEFAULT 'text'
            CHECK (msg_type IN ('text', 'voice', 'image', 'file', 'card')),
          recalled INTEGER DEFAULT 0,
          reply_to INTEGER,
          edited INTEGER DEFAULT 0,
          client_msg_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (sender_id) REFERENCES users(id)
        )
      `);
      db.exec(`INSERT INTO messages_new SELECT * FROM messages`);
      db.exec(`DROP TABLE messages`);
      db.exec(`ALTER TABLE messages_new RENAME TO messages`);
    })();
    // Recreate indexes on rebuilt table
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg_id ON messages(sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(sender_id, receiver_id) WHERE group_id IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id) WHERE group_id IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_id_group ON messages(id, group_id) WHERE group_id IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_recalled ON messages(recalled) WHERE recalled=0`);
  }
} catch (_) {}
// Add (message_id, emoji) index for toggle_reaction GROUP BY query
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reactions_msg_emoji ON message_reactions(message_id, emoji)`); } catch (_) {}

// E2EE key columns
try { db.exec(`ALTER TABLE users ADD COLUMN public_key TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN encrypted_private_key TEXT`); } catch (_) {}

// Blocked users table
db.exec(`CREATE TABLE IF NOT EXISTS blocked_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, blocked_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (blocked_id) REFERENCES users(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_user_invite', '0')").run();

// Assign unique 6-digit user_code to anyone missing one
;(function assignUserCodes() {
  const missing = db.prepare("SELECT id FROM users WHERE user_code IS NULL OR user_code = ''").all();
  const upd = db.prepare('UPDATE users SET user_code = ? WHERE id = ?');
  missing.forEach(u => {
    let code, tries = 0;
    do {
      code = String(crypto.randomInt(100000, 1000000));
      tries++;
    } while (db.prepare('SELECT id FROM users WHERE user_code = ?').get(code) && tries < 200);
    upd.run(code, u.id);
  });
})();

// Assign unique 8-digit group_code to groups missing one
;(function assignGroupCodes() {
  const missing = db.prepare("SELECT id FROM chat_groups WHERE group_code IS NULL OR group_code = ''").all();
  const upd = db.prepare('UPDATE chat_groups SET group_code = ? WHERE id = ?');
  missing.forEach(g => {
    let code, tries = 0;
    do {
      code = String(crypto.randomInt(10000000, 100000000));
      tries++;
    } while (db.prepare('SELECT id FROM chat_groups WHERE group_code = ?').get(code) && tries < 200);
    upd.run(code, g.id);
  });
})();

// Migration: ensure msg_type allows 'card'
;(function() {
  try {
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO messages(sender_id,receiver_id,group_id,content,msg_type) VALUES(999999,null,null,'__test__','card')").run();
    db.prepare("DELETE FROM messages WHERE sender_id=999999 AND content='__test__'").run();
  } catch {
    db.exec(`
      CREATE TABLE messages_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER,
        group_id INTEGER,
        content TEXT NOT NULL,
        msg_type TEXT DEFAULT 'text'
          CHECK (msg_type IN ('text','voice','image','file','card')),
        recalled INTEGER DEFAULT 0,
        reply_to INTEGER,
        edited INTEGER DEFAULT 0,
        client_msg_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id)
      );
      INSERT INTO messages_v2 (id,sender_id,receiver_id,group_id,content,msg_type,recalled,created_at)
        SELECT id,sender_id,receiver_id,group_id,content,msg_type,recalled,created_at FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v2 RENAME TO messages;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
})();

// Migrations — new tables
db.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    message TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_id, to_id),
    FOREIGN KEY (from_id) REFERENCES users(id),
    FOREIGN KEY (to_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_reads (
    user_id INTEGER NOT NULL,
    conv_key TEXT NOT NULL,
    last_read_id INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, conv_key)
  );

  CREATE TABLE IF NOT EXISTS conversation_settings (
    user_id INTEGER NOT NULL,
    conv_key TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    is_muted INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, conv_key)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, endpoint),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT,
    created_by TEXT DEFAULT 'admin',
    max_uses INTEGER DEFAULT 1,
    use_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#07c160',
    department TEXT DEFAULT '研发部',
    position TEXT DEFAULT '员工',
    phone TEXT,
    email TEXT,
    status TEXT DEFAULT 'offline',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    UNIQUE(user_id, contact_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (contact_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chat_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#07c160',
    owner_id INTEGER NOT NULL,
    announcement TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    UNIQUE(group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES chat_groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER,
    group_id INTEGER,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text'
      CHECK (msg_type IN ('text', 'voice', 'image', 'file')),
    recalled INTEGER DEFAULT 0,
    reply_to INTEGER,
    edited INTEGER DEFAULT 0,
    client_msg_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
`);


module.exports = db;
