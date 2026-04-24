const fs = require('fs');

// 从 .env 文件读取环境变量（不依赖 dotenv 包）
const env = {};
try {
  fs.readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch (_) {}

module.exports = {
  apps: [
    {
      name: 'wecom-server',
      script: './server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        JWT_SECRET: env.JWT_SECRET || process.env.JWT_SECRET,
      },
      watch: false,
      restart_delay: 1000,
    },
    {
      name: 'wecom-webhook',
      script: './webhook/index.js',
      cwd: __dirname,
      env: {
        WEBHOOK_SECRET: env.WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '',
        WEBHOOK_PORT: env.WEBHOOK_PORT || 9000,
      },
      watch: false,
    },
  ],
};
