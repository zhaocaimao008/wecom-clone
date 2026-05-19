#!/bin/bash
# 企业密信备份脚本
# 用法: ./backup.sh 或加入 crontab: 0 3 * * * /usr/local/wecom-clone/backup.sh

set -euo pipefail

# ── 配置 ──────────────────────────────────────────────────────
NAME="wecom-clone"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/wecom-clone"
KEEP_DAYS=30
DB_PATH="/usr/local/wecom-clone/server/wecom.db"
UPLOADS_DIR="/usr/local/wecom-clone/server/uploads"

# ── 初始化 ────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
cd "$(dirname "$0")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── 备份数据库 ────────────────────────────────────────────────
log "开始备份数据库..."
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/wecom_${DATE}.db'" || {
  log "❌ 数据库备份失败"
  exit 1
}
log "✅ 数据库已备份: wecom_${DATE}.db"

# ── 备份上传文件 ──────────────────────────────────────────────
if [ -d "$UPLOADS_DIR" ]; then
  log "开始备份上传文件..."
  # 使用rsync增量备份（如果可用），否则用tar
  if command -v rsync &>/dev/null; then
    rsync -a --delete "$UPLOADS_DIR/" "$BACKUP_DIR/uploads_${DATE}/"
  else
    tar -czf "$BACKUP_DIR/uploads_${DATE}.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" 2>/dev/null || true
  fi
  log "✅ 上传文件已备份"
fi

# ── 清理过期备份 ──────────────────────────────────────────────
log "清理超过 $KEEP_DAYS 天的备份..."
find "$BACKUP_DIR" -name "wecom_*.db"   -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -type d -name "uploads_*"   -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
log "✅ 过期备份已清理"

# ── 统计 ─────────────────────────────────────────────────────
DB_SIZE=$(du -sh "$BACKUP_DIR/wecom_${DATE}.db" 2>/dev/null | cut -f1)
log "备份完成！本次备份大小: $DB_SIZE"
log "备份目录: $BACKUP_DIR"
