#!/bin/bash
# SOL Bot 一键安装脚本（腾讯云 Ubuntu 22.04 / 24.04）
# 用法: sudo bash install.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SOL RSI+量能 V4 一键安装"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查 root
if [ "$EUID" -ne 0 ]; then
  echo "❌ 请用 sudo 运行: sudo bash install.sh"
  exit 1
fi

INSTALL_DIR=${INSTALL_DIR:-/opt/sol-bot}

# 1. 系统更新 + 基础工具
echo "▶ 安装系统依赖..."
apt update
apt install -y curl git build-essential ufw sqlite3

# 2. Node.js 20+
if ! command -v node &> /dev/null || [ "$(node -v | cut -d. -f1 | sed 's/v//')" -lt 20 ]; then
  echo "▶ 安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
node -v

# 3. 创建专用用户
if ! id -u solbot &>/dev/null; then
  echo "▶ 创建 solbot 用户..."
  useradd -r -s /bin/bash -d "$INSTALL_DIR" solbot
fi

# 4. 复制代码
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "▶ 复制代码到 $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r "$PROJECT_ROOT"/{backend,frontend,deploy,docs,README.md} "$INSTALL_DIR/"
chown -R solbot:solbot "$INSTALL_DIR"

# 5. 后端依赖 + 数据/日志目录
echo "▶ 安装后端依赖..."
cd "$INSTALL_DIR/backend"
sudo -u solbot mkdir -p data logs data/backups
sudo -u solbot npm install --omit=dev

# 6. .env 检查
if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
  echo "▶ 创建 .env 模板..."
  sudo -u solbot cp .env.example .env
  echo "⚠️  请稍后编辑 $INSTALL_DIR/backend/.env 填入私钥和API key"
fi

# 7. 前端构建
echo "▶ 安装前端依赖..."
cd "$INSTALL_DIR/frontend"
sudo -u solbot npm install
echo "▶ 构建前端..."
sudo -u solbot npm run build

# 8. 安装 systemd
echo "▶ 安装 systemd service..."
cp "$INSTALL_DIR/deploy/sol-bot.service" /etc/systemd/system/
cp "$INSTALL_DIR/deploy/sol-bot-ui.service" /etc/systemd/system/
chmod +x "$INSTALL_DIR/deploy/backup-db.sh"

systemctl daemon-reload
systemctl enable sol-bot.service
systemctl enable sol-bot-ui.service

# 9. cron 备份
echo "▶ 设置数据库自动备份 (每天 3:00)..."
CRON_LINE="0 3 * * * $INSTALL_DIR/deploy/backup-db.sh >> $INSTALL_DIR/backend/logs/backup.log 2>&1"
( crontab -u solbot -l 2>/dev/null | grep -v 'backup-db.sh' ; echo "$CRON_LINE" ) | crontab -u solbot -

# 10. 防火墙
echo "▶ 配置防火墙..."
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 3001/tcp || true
ufw --force enable

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ 安装完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "下一步:"
echo "  1. 编辑配置: nano $INSTALL_DIR/backend/.env"
echo "     (填入 WALLET_PRIVATE_KEY / HELIUS_API_KEY / BIRDEYE_API_KEY)"
echo ""
echo "  2. 启动服务:"
echo "     sudo systemctl start sol-bot"
echo "     sudo systemctl start sol-bot-ui"
echo ""
echo "  3. 查看日志:"
echo "     sudo journalctl -u sol-bot -f"
echo "     sudo journalctl -u sol-bot-ui -f"
echo ""
echo "  4. 服务管理:"
echo "     sudo systemctl status sol-bot         # 状态"
echo "     sudo systemctl restart sol-bot        # 重启"
echo "     sudo systemctl stop sol-bot           # 停止"
echo ""
echo "  5. 访问 Dashboard: http://你的IP:3000"
echo "     Webhook 接口:    POST http://你的IP:3001/webhook/new-token"
echo ""
echo "  6. 别忘了在腾讯云控制台 → 安全组 放行 80/443/3001/3000 端口"
echo ""
