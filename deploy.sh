#!/bin/bash
set -e

ROOT="/usr/local/wecom-clone"
WEBROOT="/usr/local/wecom-clone"
deploy_user="deploy"

# ── 身份切换 ─────────────────────────────────────────────────────────────
# 如果以 root 运行，降权到专用部署用户（必须事先创建）
if [ "$(id -u)" = "0" ]; then
  if id "$deploy_user" &>/dev/null; then
    echo "[deploy $(date '+%H:%M:%S')] 降权到 $deploy_user 执行部署..."
    exec su "$deploy_user" -c "bash '$0'"
    exit
  else
    echo "[deploy $(date '+%H:%M:%S')] ⚠️  root 运行且无 deploy 用户，跳过降权"
  fi
fi

cd "$ROOT"

# ── 完整性校验：检查 WORK_TREE 未被篡改 ─────────────────────────────────
# 简单检查：确保 .git 目录存在且为可信仓库
if [ ! -d ".git" ]; then
  echo "[deploy $(date '+%H:%M:%S')] ❌ .git 目录丢失，仓库完整性无法验证"
  exit 1
fi

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
