# SOL RSI+量能 自动交易机器人 V4

基于 Solana 链的实盘自动交易机器人，使用 RSI(7) + EMA99 量能策略。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js + React)  ← Port 3000                    │
│  - 实时监控面板  - 策略回测  - 成交记录  - 信号流           │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP + WebSocket
┌────────────────────▼────────────────────────────────────────┐
│  Backend (Node.js + Fastify)  ← Port 3001                   │
│  ┌──────────┬───────────┬──────────┬────────────────────┐   │
│  │ Token    │ Kline     │ Strategy │ Trade Executor     │   │
│  │ Manager  │ Aggregator│ Engine   │ (Jupiter + Jito)   │   │
│  └──────────┴───────────┴──────────┴────────────────────┘   │
│        │           │            │              │            │
└────────┼───────────┼────────────┼──────────────┼────────────┘
         │           │            │              │
   ┌─────▼────┐ ┌────▼─────┐ ┌────▼──────┐ ┌─────▼──────┐
   │ Birdeye  │ │ Helius   │ │  Jupiter  │ │  Jito      │
   │ WSS      │ │ WSS+RPC  │ │  v6 API   │ │  Bundle    │
   └──────────┘ └──────────┘ └───────────┘ └────────────┘
```

## 核心策略

**5分钟K线 / RSI周期=7 / EMA99 (GMGN标准)**

### 买入条件（全部满足）
- RSI(7) 上穿 35 (上一根 ≤ 35，当前根 > 35)
- EMA99 斜率 ≥ 0 (回看5根)
- 不在卖出冷却期(30分钟)
- 价格 < EMA99 (可选过滤器)

### 卖出条件（任一触发）
- RSI(7) > 80 → 立即卖出
- RSI(7) 下穿 70 → 卖出
- 止盈 +100%
- 止损 -50%
- 移动止损：涨幅达+30%激活，从峰值回撤-20%清仓

### 交易参数
- 每笔 2 SOL
- 滑点 3%（买入失败重试最高5%，卖出失败重试最高10%）
- 失败重试 3 次
- Jito bundle 防夹

## 监控池规则
- 最大 100 个币
- FDV < $30,000 或 LP < $10,000 自动剔除（先平仓后剔除）
- 满 100 时按 24h volume 最低淘汰

## 快速启动

```bash
# 1. 后端
cd backend
cp .env.example .env  # 填入私钥和API key
npm install
npm run dev

# 2. 前端
cd frontend
npm install
npm run dev

# 访问 http://localhost:3000
```

## API Endpoints

### Webhook 接收新币
```bash
curl -X POST http://你的IP:3001/webhook/new-token \
  -H "Content-Type: application/json" \
  -d '{"mint": "5QhQE7yRMgYHzs7Vq3y2Wnc2SAkMwLYrQc4RHNipump"}'
```

### Dashboard API
- `GET  /api/stats` - 24h统计
- `GET  /api/tokens` - 监控列表
- `POST /api/tokens` - 添加币
- `DELETE /api/tokens/:mint` - 移除币
- `GET  /api/trades` - 成交记录
- `GET  /api/signals` - 信号流
- `POST /api/backtest` - 策略回测
- `WS   /ws` - 实时推送

## 部署到腾讯云 2C4G

参考 `docs/deploy.md`
