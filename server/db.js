const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'wecom.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations — columns
['mute_all', 'restrict_add_friend', 'restrict_private_chat'].forEach(col => {
  try { db.exec(`ALTER TABLE chat_groups ADD COLUMN ${col} INTEGER DEFAULT 0`); } catch (_) {}
});
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN user_code TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE chat_groups ADD COLUMN group_code TEXT`); } catch (_) {}

// Assign unique 6-digit user_code to anyone missing one
;(function assignUserCodes() {
  const missing = db.prepare("SELECT id FROM users WHERE user_code IS NULL OR user_code = ''").all();
  const upd = db.prepare('UPDATE users SET user_code = ? WHERE id = ?');
  missing.forEach(u => {
    let code, tries = 0;
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
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
      code = String(Math.floor(10000000 + Math.random() * 90000000));
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id)
      );
      INSERT INTO messages_v2 SELECT * FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v2 RENAME TO messages;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
})();

// Migrations — new tables
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

// Seed demo data
const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingUser) {
  const hash = bcrypt.hashSync('123456', 10);
  const colors = ['#07c160', '#576b95', '#fa9d3b', '#e64340', '#10aec2', '#7d7d7d'];

  const demoUsers = [
    { username: 'admin',   password: hash, display_name: '张三', avatar_color: '#07c160', department: '研发部',   position: '高级工程师', phone: '13800138001', email: 'zhangsan@company.com' },
    { username: 'lisi',    password: hash, display_name: '李四', avatar_color: '#576b95', department: '产品部',   position: '产品经理',   phone: '13800138002', email: 'lisi@company.com' },
    { username: 'wangwu',  password: hash, display_name: '王五', avatar_color: '#fa9d3b', department: '设计部',   position: 'UI设计师',   phone: '13800138003', email: 'wangwu@company.com' },
    { username: 'zhaoliu', password: hash, display_name: '赵六', avatar_color: '#e64340', department: '运营部',   position: '运营专员',   phone: '13800138004', email: 'zhaoliu@company.com' },
    { username: 'sunqi',   password: hash, display_name: '孙七', avatar_color: '#10aec2', department: '研发部',   position: '前端工程师', phone: '13800138005', email: 'sunqi@company.com' },
    { username: 'zhouba',  password: hash, display_name: '周八', avatar_color: '#7d7d7d', department: '市场部',   position: '市场经理',   phone: '13800138006', email: 'zhouba@company.com' },
    { username: 'wujiu',   password: hash, display_name: '吴九', avatar_color: '#07c160', department: '研发部',   position: '后端工程师', phone: '13800138007', email: 'wujiu@company.com' },
    { username: 'zhengshi',password: hash, display_name: '郑十', avatar_color: '#576b95', department: '人事部',   position: 'HR专员',     phone: '13800138008', email: 'zhengshi@company.com' },
  ];

  const insertUser = db.prepare(
    'INSERT INTO users (username, password, display_name, avatar_color, department, position, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  demoUsers.forEach(u => insertUser.run(u.username, u.password, u.display_name, u.avatar_color, u.department, u.position, u.phone, u.email));

  // Add contacts for admin (user 1)
  const insertContact = db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)');
  for (let i = 2; i <= 8; i++) {
    insertContact.run(1, i);
    insertContact.run(i, 1);
  }
  for (let i = 2; i <= 8; i++) {
    for (let j = 2; j <= 8; j++) {
      if (i !== j) insertContact.run(i, j);
    }
  }

  // Create demo groups
  const insertGroup = db.prepare('INSERT INTO chat_groups (name, avatar_color, owner_id, announcement) VALUES (?, ?, ?, ?)');
  const g1 = insertGroup.run('研发团队', '#07c160', 1, '欢迎加入研发团队！请遵守团队规范。');
  const g2 = insertGroup.run('全员大群', '#576b95', 1, '公司全员群，重要通知请@所有人');
  const g3 = insertGroup.run('产品需求讨论', '#fa9d3b', 2, '产品需求讨论群');

  const insertMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');
  [1, 5, 7].forEach(uid => insertMember.run(g1.lastInsertRowid, uid, uid === 1 ? 'owner' : 'member'));
  for (let i = 1; i <= 8; i++) insertMember.run(g2.lastInsertRowid, i, i === 1 ? 'owner' : 'member');
  [1, 2, 3, 5].forEach(uid => insertMember.run(g3.lastInsertRowid, uid, uid === 2 ? 'owner' : 'member'));

  // Seed messages
  const insertMsg = db.prepare('INSERT INTO messages (sender_id, receiver_id, group_id, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  const mins = (n) => new Date(now - n * 60000).toISOString();

  insertMsg.run(2, 1, null, '你好张三，下午有空吗？我想聊一下新产品的需求', 'text', mins(120));
  insertMsg.run(1, 2, null, '有空的，下午两点怎么样？', 'text', mins(115));
  insertMsg.run(2, 1, null, '好的，那我们下午两点在会议室见', 'text', mins(110));
  insertMsg.run(1, 2, null, '没问题，到时候见👍', 'text', mins(108));

  insertMsg.run(3, 1, null, '张三，这是我做的新版设计稿，帮我看看', 'text', mins(60));
  insertMsg.run(1, 3, null, '好的，我看一下', 'text', mins(58));
  insertMsg.run(3, 1, null, '主要改了首页的banner区域和导航样式', 'text', mins(55));

  insertMsg.run(4, 1, null, '周报已发，请查收', 'text', mins(30));
  insertMsg.run(1, 4, null, '收到，辛苦了', 'text', mins(28));

  insertMsg.run(1, null, g1.lastInsertRowid, '大家好，本周sprint目标已更新，请查看Jira看板', 'text', mins(200));
  insertMsg.run(5, null, g1.lastInsertRowid, '收到，我已经看了，今天开始开发', 'text', mins(195));
  insertMsg.run(7, null, g1.lastInsertRowid, '好的，有问题随时在群里说', 'text', mins(190));
  insertMsg.run(1, null, g1.lastInsertRowid, '加油！有什么技术问题可以在群里讨论', 'text', mins(185));

  insertMsg.run(1, null, g2.lastInsertRowid, '【公告】本周五下午3点全员大会，请大家准时参加，地点：5楼大会议室', 'text', mins(300));
  insertMsg.run(2, null, g2.lastInsertRowid, '收到！', 'text', mins(295));
  insertMsg.run(3, null, g2.lastInsertRowid, '好的，准时参加', 'text', mins(290));
  insertMsg.run(8, null, g2.lastInsertRowid, '请问可以远程参加吗？', 'text', mins(280));
  insertMsg.run(1, null, g2.lastInsertRowid, '可以的，会议链接稍后发出', 'text', mins(275));
}

module.exports = db;
