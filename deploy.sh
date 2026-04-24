#!/bin/bash
set -e

ROOT="/usr/local/wecom-clone"
cd "$ROOT"

echo "[deploy $(date '+%H:%M:%S')] git pull..."
git pull

echo "[deploy] 安装后端依赖..."
cd server && npm install --production && cd ..

echo "[deploy] 构建前端..."
cd client && npm install && npm run build && cd ..

echo "[deploy] 重启服务..."
if pm2 describe wecom-server > /dev/null 2>&1; then
  pm2 restart wecom-server
else
  pm2 start ecosystem.config.js --only wecom-server
fi

echo "[deploy $(date '+%H:%M:%S')] ✅ 完成"
