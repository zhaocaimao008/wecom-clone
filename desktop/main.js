'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, Notification, shell, dialog, session, globalShortcut, clipboard,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');

// ── Config (persisted next to main.js) ────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function saveConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

let config = { serverUrl: 'http://104.244.95.70:3001', ...loadConfig() };

// ── Allow microphone/camera on HTTP origins ───────────────────────────────────
// Chromium blocks getUserMedia on non-HTTPS non-localhost pages; tell it to
// treat our server URL as secure so voice recording works without HTTPS.
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', config.serverUrl);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-http-cache');

const NO_CACHE_HEADERS = 'pragma: no-cache\nCache-Control: no-cache, no-store\n';

// ── Globals ───────────────────────────────────────────────────────────────────
let mainWindow       = null;
let tray             = null;
let isQuiting        = false;
let trayAccounts     = [];   // [{ user: { display_name, ... } }]
let trayActiveIdx    = 0;

// ── Single instance ───────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

// ── Create tray icon (1x1 pixel encoded as base64 fallback) ──────────────────
// Generate icon from raw BGRA pixels — no external file needed
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = (size - 1) / 2, cy = (size - 1) / 2, r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * size + x) * 4;
        buf[i] = 96; buf[i+1] = 193; buf[i+2] = 7; buf[i+3] = 255; // #07c160 BGRA
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}
function createTrayIcon() { return makeIcon(16); }
function createAppIcon()  { return makeIcon(32); }

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  const savedBounds = config.windowBounds || { width: 1200, height: 800 };

  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    ...savedBounds,
    minWidth:  900,
    minHeight: 600,
    title:    '密信',
    icon:     createAppIcon(),
    backgroundColor: '#2e2e2e',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      spellcheck:       false,
      devTools:         false,
    },
    // macOS: keep native traffic lights; Windows/Linux: fully frameless
    frame:           isMac,
    titleBarStyle:   isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
  });

  // Persist window position/size
  function saveBounds() {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      config.windowBounds = mainWindow.getBounds();
      saveConfig(config);
    }
  }
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move',   saveBounds);

  // Load app — always bypass cache so the latest client is fetched
  mainWindow.loadURL(config.serverUrl, { extraHeaders: NO_CACHE_HEADERS });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (config.windowMaximized) mainWindow.maximize();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (config.zoomLevel != null) {
      mainWindow.webContents.setZoomLevel(config.zoomLevel);
    }
  });

  mainWindow.on('maximize',   () => { config.windowMaximized = true;  saveConfig(config); });
  mainWindow.on('unmaximize', () => { config.windowMaximized = false; saveConfig(config); });

  // Minimize to tray on close
  mainWindow.on('close', e => {
    if (!isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform !== 'darwin') {
        tray?.displayBalloon?.({
          iconType: 'info',
          title: '密信',
          content: '应用已最小化到系统托盘',
        });
      }
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Title bar double-click maximize (Windows)
  mainWindow.on('app-command', (_, cmd) => {
    if (cmd === 'browser-backward' && mainWindow.webContents.canGoBack()) {
      mainWindow.webContents.goBack();
    }
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  const accountItems = trayAccounts.map((acc, idx) => {
    const name    = acc.user?.display_name || `账号 ${idx + 1}`;
    const isActive = idx === trayActiveIdx;
    return {
      label: isActive ? `✓  ${name}` : `     ${name}`,
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
        // Tell the renderer to switch account
        mainWindow.webContents.send('tray:switch-account', idx);
      },
    };
  });

  const template = [
    {
      label: '打开密信',
      click: () => { mainWindow.show(); mainWindow.focus(); },
    },
  ];

  if (accountItems.length > 1) {
    template.push(
      { type: 'separator' },
      { label: '切换账号', enabled: false },
      ...accountItems,
    );
  }

  template.push(
    { type: 'separator' },
    { label: '服务器设置', click: showServerSettings },
    { type: 'separator' },
    { label: '退出', click: () => { isQuiting = true; app.quit(); } },
  );

  return Menu.buildFromTemplate(template);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('密信 v4.2.0 · 2026-05-17 16:33');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow.isVisible()) { mainWindow.focus(); }
    else { mainWindow.show(); }
  });
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ── Server settings dialog ────────────────────────────────────────────────────
async function showServerSettings() {
  const autoStart = app.getLoginItemSettings().openAtLogin;
  const win = new BrowserWindow({
    width:  480,
    height: 320,
    parent: mainWindow,
    modal:  true,
    resizable: false,
    title: '偏好设置',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      devTools:         false,
    },
    show: false,
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
       background:#fff;padding:24px;color:#333}
  h2{font-size:16px;margin-bottom:20px;color:#07c160}
  .field{margin-bottom:16px}
  label{font-size:13px;color:#666;display:block;margin-bottom:6px}
  input[type=url]{width:100%;padding:9px 12px;border:1px solid #d0d0d0;border-radius:6px;
        font-size:14px;outline:none}
  input[type=url]:focus{border-color:#07c160}
  .hint{font-size:11px;color:#999;margin-top:5px}
  .toggle-row{display:flex;align-items:center;justify-content:space-between;
    padding:10px 12px;background:#f8f8f8;border-radius:8px}
  .toggle-label{font-size:13px;color:#333}
  .toggle{position:relative;width:40px;height:22px;cursor:pointer}
  .toggle input{opacity:0;width:0;height:0}
  .slider{position:absolute;inset:0;background:#ccc;border-radius:22px;transition:.25s}
  .slider::before{content:'';position:absolute;height:16px;width:16px;left:3px;bottom:3px;
    background:#fff;border-radius:50%;transition:.25s}
  input:checked + .slider{background:#07c160}
  input:checked + .slider::before{transform:translateX(18px)}
  .btns{display:flex;gap:10px;margin-top:20px;justify-content:flex-end}
  button{padding:8px 20px;border-radius:6px;font-size:13px;cursor:pointer}
  .cancel{background:#f5f5f5;border:1px solid #ddd;color:#555}
  .save{background:#07c160;color:#fff;border:none}
  .save:hover{background:#059a4c}
</style>
</head>
<body>
<h2>偏好设置</h2>
<div class="field">
  <label>服务器地址</label>
  <input id="url" type="url" value="${config.serverUrl}" placeholder="http://192.168.1.100:3001">
  <div class="hint">例如：http://192.168.1.100:3001（局域网）或 https://wecom.yourcompany.com</div>
</div>
<div class="field">
  <div class="toggle-row">
    <span class="toggle-label">开机自动启动</span>
    <label class="toggle">
      <input type="checkbox" id="autoStart" ${autoStart ? 'checked' : ''}>
      <span class="slider"></span>
    </label>
  </div>
</div>
<div class="btns">
  <button class="cancel" onclick="window.electronAPI.closeSettings()">取消</button>
  <button class="save" onclick="window.electronAPI.saveSettings(document.getElementById('url').value, document.getElementById('autoStart').checked)">保存并重载</button>
</div>
</body>
</html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once('ready-to-show', () => win.show());
}

// ── Badge icon for Windows taskbar overlay ────────────────────────────────────
function makeBadgeIcon(count) {
  const size = 16;
  // BGRA raw buffer — red circle with white number
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const i = (y * size + x) * 4;
      if (dx * dx + dy * dy <= r * r) {
        buf[i] = 50; buf[i + 1] = 50; buf[i + 2] = 220; buf[i + 3] = 255; // red (BGRA)
      } else {
        buf[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Window controls (for frameless Windows/Linux)
ipcMain.handle('chrome:minimize',    () => mainWindow?.minimize());
ipcMain.handle('chrome:maximize',    () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('chrome:close',       () => mainWindow?.close());
ipcMain.handle('chrome:is-maximized',() => mainWindow?.isMaximized() ?? false);

ipcMain.handle('get-server-url', () => config.serverUrl);

ipcMain.handle('save-settings', (_, url, autoStart) => {
  if (autoStart != null) app.setLoginItemSettings({ openAtLogin: !!autoStart });
  const newUrl = url.trim().replace(/\/$/, '');
  const changed = newUrl !== config.serverUrl;
  config.serverUrl = newUrl;
  saveConfig(config);
  BrowserWindow.getAllWindows().forEach(w => { if (w !== mainWindow) w.close(); });
  if (changed) {
    // commandLine flags are set at startup, so a restart is needed for the new
    // URL to be treated as a secure origin (microphone will work after restart)
    mainWindow.loadURL(config.serverUrl, { extraHeaders: NO_CACHE_HEADERS });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '需要重启',
      message: '服务器地址已保存。\n\n要让麦克风在新地址上正常工作，请重启应用。',
      buttons: ['立即重启', '稍后重启'],
    }).then(({ response }) => {
      if (response === 0) { isQuiting = true; app.relaunch(); app.quit(); }
    });
  } else {
    mainWindow.loadURL(config.serverUrl, { extraHeaders: NO_CACHE_HEADERS });
  }
});

ipcMain.handle('close-settings', () => {
  BrowserWindow.getAllWindows().forEach(w => { if (w !== mainWindow) w.close(); });
});

ipcMain.handle('show-notification', (_, { title, body, convId, convType }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      if (convId != null) {
        mainWindow.webContents.send('navigate-to-conv', { convId, convType });
      }
    }
  });
  n.show();
});

// Badge: macOS dock + Windows taskbar overlay + tray tooltip
ipcMain.handle('set-badge', (_, count) => {
  const label = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(label);
  }
  if (process.platform === 'win32' && mainWindow) {
    mainWindow.setOverlayIcon(count > 0 ? makeBadgeIcon(count) : null, label);
  }
  tray?.setToolTip(count > 0 ? `密信 v4.2.0 · 2026-05-17 16:33 (${count}条未读)` : '密信 v4.2.0 · 2026-05-17 16:33');
});

ipcMain.handle('get-auto-start', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('set-auto-start', (_, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable });
  config.autoStart = enable;
  saveConfig(config);
});

ipcMain.handle('get-zoom', () => config.zoomLevel ?? 0);

ipcMain.handle('set-zoom', (_, level) => {
  config.zoomLevel = level;
  saveConfig(config);
  mainWindow?.webContents.setZoomLevel(level);
});

// Renderer sends current accounts so tray menu stays up-to-date
ipcMain.handle('tray:update-accounts', (_, accounts, activeIdx) => {
  trayAccounts  = Array.isArray(accounts) ? accounts : [];
  trayActiveIdx = typeof activeIdx === 'number' ? activeIdx : 0;
  if (tray) tray.setContextMenu(buildTrayMenu());
});

ipcMain.handle('clipboard:copy-image', (_, dataUrl) => {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── App menu (macOS) ──────────────────────────────────────────────────────────
function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '服务器设置', click: showServerSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        {
          label: '重置缩放',
          accelerator: 'CommandOrControl+0',
          click: () => { mainWindow?.webContents.setZoomLevel(0); config.zoomLevel = 0; saveConfig(config); },
        },
        {
          label: '放大',
          accelerator: 'CommandOrControl+Plus',
          click: () => {
            const lv = (mainWindow?.webContents.getZoomLevel() ?? 0) + 0.5;
            mainWindow?.webContents.setZoomLevel(lv); config.zoomLevel = lv; saveConfig(config);
          },
        },
        {
          label: '缩小',
          accelerator: 'CommandOrControl+-',
          click: () => {
            const lv = (mainWindow?.webContents.getZoomLevel() ?? 0) - 0.5;
            mainWindow?.webContents.setZoomLevel(lv); config.zoomLevel = lv; saveConfig(config);
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' },
        ] : [{ role: 'close', label: '关闭' }]),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '服务器设置',
          click: showServerSettings,
        },
      ],
    },
  ];
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux: no visible menu bar; keyboard shortcuts still work via globalShortcut
    Menu.setApplicationMenu(null);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Clear stale HTTP cache so the latest web client is always loaded
  await session.defaultSession.clearCache();

  // Auto-approve microphone, camera, and notification permissions
  const ALLOWED_PERMS = ['media', 'microphone', 'camera', 'audioCapture', 'videoCapture', 'notifications', 'mediaKeySystem', 'clipboard-read', 'clipboard-write', 'clipboardRead', 'clipboardWrite'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(ALLOWED_PERMS.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return ALLOWED_PERMS.includes(permission);
  });

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(createAppIcon());
  }

  buildAppMenu();
  createWindow();
  createTray();

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuiting = true;
  globalShortcut.unregisterAll();
});
