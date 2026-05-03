# 腾讯云 2C4G 部署指南 (V4 + systemd)

## 服务器要求
- **配置**: 2核 4GB 内存 / Ubuntu 22.04 LTS / 50GB SSD
- **带宽**: 至少 5Mbps
- **地域**: 推荐**新加坡**或**硅谷**（距离Solana主网近，延迟低）

---

## 一. 一键安装（推荐）

```bash
# 1. SSH 登录服务器后，上传整个项目目录
scp -r sol-bot/ root@你的服务器IP:/tmp/

# 2. 登录服务器执行安装
ssh root@你的服务器IP
cd /tmp/sol-bot/deploy
sudo bash install.sh
```

安装脚本会自动完成：
- ✓ 系统更新 + Node.js 20+
- ✓ 创建 `solbot` 专用用户
- ✓ 代码复制到 `/opt/sol-bot/`
- ✓ 后端 + 前端依赖安装与构建
- ✓ systemd service 注册（开机自启）
- ✓ 防火墙配置（22/80/443/3001）
- ✓ 数据库自动备份 cron（每天 3:00）

---

## 二. 配置 .env

```bash
sudo nano /opt/sol-bot/backend/.env
```

最少需填：

```
WALLET_PRIVATE_KEY=你的钱包私钥(base58)
HELIUS_API_KEY=你的helius_key
BIRDEYE_API_KEY=你的birdeye_key
LIVE_TRADING=true   # 首次测试可以先设成 false
```

---

## 三. 启动 / 停止 / 状态

```bash
# 启动
sudo systemctl start sol-bot
sudo systemctl start sol-bot-ui

# 状态
sudo systemctl status sol-bot
sudo systemctl status sol-bot-ui

# 实时日志
sudo journalctl -u sol-bot -f
sudo journalctl -u sol-bot-ui -f

# 重启（修改 .env 后必须）
sudo systemctl restart sol-bot

# 停止
sudo systemctl stop sol-bot
```

---

## 四. 数据持久化保证

**所有数据存储在** `/opt/sol-bot/backend/data/bot.db`（SQLite 单文件 + WAL）

### 持久化的内容

| 表 | 内容 | 重启后 |
|---|---|---|
| `tokens` | 监控代币池（含 metadata） | ✓ 自动恢复 |
| `trades` | 所有成交记录（PnL/Tx签名） | ✓ 永久保存 |
| `signals` | 信号流历史 | ✓ 永久保存 |
| `bars` | 5min K线（用于回测+恢复指标） | ✓ 默认保留 7 天 |
| `positions` | 当前持仓（成本价/峰值/移动止损状态） | ✓ 自动恢复 |

### 重启后行为

1. **systemd 自动拉起进程**（`Restart=on-failure`，5 秒后重启）
2. **TokenManager 启动时**：
   - 读取 `tokens` 表所有币
   - 重新订阅 Birdeye WSS
   - **优先用本地 SQLite K线**重建指标（不消耗 Birdeye API 额度）
   - 如本地 K 线不足，才从 Birdeye 拉历史
3. **策略状态恢复**：
   - 从 `trades` 表读取上次成功卖出时间 → 恢复 30 分钟冷却期
   - 从 `trades` 表统计买/卖序号 → 恢复 #buy_count / #sell_count
4. **持仓状态恢复**：
   - 从 `positions` 表读取所有未平仓
   - 包括成本价、峰值、移动止损是否激活
   - 立即开始监控止盈/止损/移动止损

### 优雅退出

收到 `SIGTERM`（systemctl stop / 重启 / kill）时：
1. 停止接收新 HTTP 请求
2. 等待最多 10 秒让正在执行的交易完成
3. `wal_checkpoint(TRUNCATE)` — 把 WAL 中所有数据写入主库
4. 关闭 SQLite 连接

systemd 配置中 `TimeoutStopSec=15` 给 15 秒缓冲，比应用层 10 秒多 5 秒确保安全。

### 后台 WAL Checkpoint

每分钟自动执行 `wal_checkpoint(PASSIVE)`，防止 WAL 文件无限增长，且即使是非正常退出也能确保最近的数据已落盘。

---

## 五. 数据库自动备份

### 自动备份（已通过安装脚本配置）

```bash
# 查看 cron
sudo -u solbot crontab -l
# 应有: 0 3 * * * /opt/sol-bot/deploy/backup-db.sh ...

# 查看备份
ls -lh /opt/sol-bot/backend/data/backups/

# 手动备份
sudo -u solbot /opt/sol-bot/deploy/backup-db.sh
```

备份保留 14 天，使用 SQLite `.backup` 命令做**热备份**（不阻塞数据库写入）。

### 恢复备份

```bash
# 1. 停服
sudo systemctl stop sol-bot

# 2. 恢复
gunzip -c /opt/sol-bot/backend/data/backups/bot.db.YYYYMMDD_HHMMSS.gz \
  > /opt/sol-bot/backend/data/bot.db
sudo chown solbot:solbot /opt/sol-bot/backend/data/bot.db

# 3. 启动
sudo systemctl start sol-bot
```

### 推荐：异地备份

将备份同步到腾讯云 COS：

```bash
# 安装 coscmd
pip3 install coscmd
coscmd config -a 你的SecretId -s 你的SecretKey -b 桶名-地域

# 添加到 crontab
sudo -u solbot crontab -e
# 0 4 * * * coscmd upload -rs /opt/sol-bot/backend/data/backups/ /sol-bot-backup/
```

---

## 六. Nginx 反代（可选，建议）

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/sol-bot
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://localhost:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location /webhook/ {
        proxy_pass http://localhost:3001/webhook/;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sol-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL（需要域名）
sudo certbot --nginx -d your-domain.com
```

---

## 七. Webhook 接入

```
POST http://你的IP:3001/webhook/new-token
Content-Type: application/json
Body: {"mint": "代币合约地址"}
```

测试：

```bash
curl -X POST http://你的IP:3001/webhook/new-token \
  -H "Content-Type: application/json" \
  -d '{"mint":"5QhQE7yRMgYHzs7Vq3y2Wnc2SAkMwLYrQc4RHNipump"}'
```

---

## 八. 日常运维

### 日志查看

```bash
# 实时
sudo journalctl -u sol-bot -f

# 最近 1 小时
sudo journalctl -u sol-bot --since "1 hour ago"

# 仅错误
sudo journalctl -u sol-bot -p err -n 100

# 最近 200 行
sudo journalctl -u sol-bot -n 200
```

### 限制系统日志大小

```bash
sudo journalctl --vacuum-size=500M
sudo journalctl --vacuum-time=30d
```

或永久配置：

```bash
sudo nano /etc/systemd/journald.conf
# SystemMaxUse=1G
# MaxRetentionSec=30d
sudo systemctl restart systemd-journald
```

### 资源监控

```bash
systemctl status sol-bot --no-pager
htop
df -h /opt/sol-bot/backend/data
```

### 数据库直接查询

```bash
sqlite3 /opt/sol-bot/backend/data/bot.db
sqlite> .tables
sqlite> SELECT count(*) FROM tokens;
sqlite> SELECT side, count(*), sum(pnl_sol) FROM trades WHERE success=1 GROUP BY side;
sqlite> .quit
```

---

## 九. 故障排查

### 服务启动失败

```bash
# 看完整错误
sudo journalctl -u sol-bot --since "5 min ago"

# 直接以 solbot 用户运行排查
sudo -u solbot bash
cd /opt/sol-bot/backend
node src/index.js
```

### 服务频繁重启

```bash
systemctl status sol-bot   # 看 "Restart Count"

# 5 分钟内重启 > 5 次会进入 failed 状态
# 重置：
sudo systemctl reset-failed sol-bot
sudo systemctl start sol-bot
```

### 数据库锁死（极少见）

```bash
ls -lh /opt/sol-bot/backend/data/
# 如 bot.db-wal > 100M，手动 checkpoint：
sudo systemctl stop sol-bot
sqlite3 /opt/sol-bot/backend/data/bot.db "PRAGMA wal_checkpoint(TRUNCATE);"
sudo systemctl start sol-bot
```

---

## 十. 安全建议

1. **关闭密码登录**，仅用 SSH key
2. **`.env` 权限收紧**：`sudo chmod 600 /opt/sol-bot/backend/.env`
3. **私钥钱包仅放交易资金**（< 50 SOL），主资金用冷钱包
4. **定期同步备份到对象存储**
5. **腾讯云控制台 → 安全组**只放行必要端口（22/80/443/3001）

---

## 十一. 卸载

```bash
sudo systemctl stop sol-bot sol-bot-ui
sudo systemctl disable sol-bot sol-bot-ui
sudo rm /etc/systemd/system/sol-bot*.service
sudo systemctl daemon-reload

# 备份后再删
cp -r /opt/sol-bot/backend/data ~/sol-bot-data-backup-$(date +%Y%m%d)
sudo rm -rf /opt/sol-bot
sudo userdel solbot
```
