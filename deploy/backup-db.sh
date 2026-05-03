#!/bin/bash
# SQLite 数据库备份脚本
# 使用 .backup 命令做热备份（不需要停服）
# 推荐用 cron 每天凌晨执行: 0 3 * * * /opt/sol-bot/deploy/backup-db.sh

set -e

DB_PATH="/opt/sol-bot/backend/data/bot.db"
BACKUP_DIR="/opt/sol-bot/backend/data/backups"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/bot.db.$TS"

# 用 SQLite 自带的 .backup 命令（在线备份，不阻塞）
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# 压缩
gzip "$BACKUP_FILE"
echo "✓ 备份完成: $BACKUP_FILE.gz ($(du -h "$BACKUP_FILE.gz" | cut -f1))"

# 清理 N 天前的旧备份
find "$BACKUP_DIR" -name 'bot.db.*.gz' -mtime +$KEEP_DAYS -delete
echo "✓ 已清理 ${KEEP_DAYS} 天前的旧备份"

# 列出当前所有备份
echo "现有备份:"
ls -lh "$BACKUP_DIR" | tail -20
