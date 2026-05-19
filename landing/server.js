'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { existsSync } = require('fs');

const PORT      = 3010;
const PAGE      = path.join(__dirname, 'index.html');
const DOWNLOADS = path.join(__dirname, '..', 'server', 'downloads');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/download/windows') {
    const file = path.join(DOWNLOADS, '密信-Windows.tar.gz');
    if (!existsSync(file)) return res.writeHead(404).end(JSON.stringify({ error: '安装包不存在' }));
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': 'attachment; filename*=UTF-8\'\'%E5%AF%86%E4%BF%A1-Windows.tar.gz',
      'Content-Length':      stat.size,
    });
    return fs.createReadStream(file).pipe(res);
  }

  if (url === '/api/download/android') {
    const file = path.join(DOWNLOADS, '密信.apk');
    if (!existsSync(file)) return res.writeHead(404).end(JSON.stringify({ error: 'APK 不存在' }));
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type':        'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename*=UTF-8\'\'%E5%AF%86%E4%BF%A1.apk',
      'Content-Length':      stat.size,
    });
    return fs.createReadStream(file).pipe(res);
  }

  if (url === '/api/download/ios') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'iOS 版本即将推出，敬请期待' }));
  }

  // Serve index.html for all other paths
  const ext  = path.extname(url) || '.html';
  const mime = MIME[ext] || 'text/plain';
  const file = ext === '.html' ? PAGE : path.join(__dirname, url);

  if (!existsSync(file)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(PAGE).pipe(res);
  }

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(file).pipe(res);

}).listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 密信官网 running on http://0.0.0.0:${PORT}`);
});
