const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');

const SECRET=process.env.WEBHOOK_SECRET || '';
const PORT = (() => {
  const p = parseInt(process.env.WEBHOOK_PORT);
  if (isNaN(p) || p < 1 || p > 65535) return 9000;
  return p;
})();
const MAX_BODY = 10 * 1024 * 1024; // 10MB max
const DEPLOY_SCRIPT = path.join(__dirname, '..', 'deploy.sh');

let deploying = false;
let bodyLen = 0;

function verifyGithub(payload, sig) {
  if (!sig) return !SECRET;
  const hmac = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig)); } catch { return false; }
}

function verifyGitee(token) {
  if (!SECRET) return false;  // 无密钥时拒绝一切
  return token === SECRET;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  let body = '';
  bodyLen = 0;
  req.on('data', chunk => {
    bodyLen += chunk.length;
    if (bodyLen > MAX_BODY) {
      req.destroy();
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Payload Too Large');
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    const isGithub = !!req.headers['x-github-event'];
    const isGitee  = !!req.headers['x-gitee-event'];

    let valid = false;
    if (isGithub) {
      valid = verifyGithub(body, req.headers['x-hub-signature-256']);
    } else if (isGitee) {
      valid = verifyGitee(req.headers['x-gitee-token']);
    } else {
      // 无平台标识的请求，必须配置 SECRET 才允许
      valid = !!SECRET;
    }

    if (!valid) {
      console.log(`[${ts()}] ❌ 签名验证失败`);
      res.writeHead(401); res.end('Unauthorized');
      return;
    }

    res.writeHead(200); res.end('OK');

    if (deploying) {
      console.log(`[${ts()}] ⚠️  上次部署还在进行，跳过`);
      return;
    }

    deploying = true;
    console.log(`[${ts()}] 🚀 开始部署...`);

    execFile('bash', [DEPLOY_SCRIPT], { cwd: path.join(__dirname, '..') }, (err, stdout, stderr) => {
      deploying = false;
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (err) {
        console.error(`[${ts()}] ❌ 部署失败: ${err.message}`);
      } else {
        console.log(`[${ts()}] ✅ 部署成功`);
      }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${ts()}] Webhook 监听 http://0.0.0.0:${PORT}/deploy`);
});

function ts() { return new Date().toISOString().slice(11, 19); }
