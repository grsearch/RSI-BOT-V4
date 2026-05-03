import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { Tokens, Trades, Signals, Positions } from '../core/db.js';
import { tokenManager } from '../core/tokenManager.js';
import { runBacktest } from '../strategy/backtest.js';

const log = child('api');

export async function registerRoutes(app) {
  // ============ 24h 统计 ============
  app.get('/api/stats', async () => {
    const stats = Trades.stats24h();
    const signalCount = Signals.count();
    return {
      ...stats,
      signalsToday: signalCount,
      tokensCount: tokenManager.size(),
      walletConnected: !!config.walletPubkey,
      walletAddress: config.walletPubkey,
      live: config.trade.live,
    };
  });

  // ============ Token 列表 (分页) ============
  app.get('/api/tokens', async req => {
    const { page = 1, pageSize = 20, search = '' } = req.query;
    let list = tokenManager.list();

    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(
        t =>
          t.mint.toLowerCase().includes(q) ||
          (t.symbol && t.symbol.toLowerCase().includes(q))
      );
    }

    // 与DB合并状态
    const enriched = list.map(t => {
      const dbRow = Tokens.get(t.mint);
      const pos = Positions.get(t.mint);
      return {
        ...t,
        status: pos ? 'HOLDING' : dbRow?.status || 'WATCHING',
        xMentions: dbRow?.x_mentions || 0,
        position: pos || null,
      };
    });

    const total = enriched.length;
    const start = (page - 1) * pageSize;
    return {
      items: enriched.slice(start, start + Number(pageSize)),
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(total / pageSize),
    };
  });

  // ============ 添加币 ============
  app.post('/api/tokens', async (req, reply) => {
    const { mint, symbol } = req.body || {};
    if (!mint) return reply.code(400).send({ error: 'mint required' });

    const r = await tokenManager.add(mint);
    if (!r.added) {
      return reply.code(400).send({ error: r.reason });
    }
    return { ok: true, mint };
  });

  // ============ Webhook 接收新币 ============
  app.post('/webhook/new-token', async (req, reply) => {
    const { mint } = req.body || {};
    if (!mint) return reply.code(400).send({ error: 'mint required' });
    log.info({ mint }, 'Webhook 接收新币');

    // 异步处理，立即返回
    tokenManager
      .add(mint)
      .then(r => {
        if (r.added) {
          log.info({ mint: mint.slice(0, 6) }, 'Webhook 添加成功');
        } else {
          log.warn({ mint: mint.slice(0, 6), reason: r.reason }, 'Webhook 拒绝');
        }
      })
      .catch(e => log.error({ mint, err: e.message }, 'Webhook 失败'));

    return { received: true };
  });

  // ============ 移除币 ============
  app.delete('/api/tokens/:mint', async (req, reply) => {
    const { mint } = req.params;
    const ok = await tokenManager.remove(mint, 'manual');
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  // ============ 成交记录 ============
  app.get('/api/trades', async req => {
    const { limit = 100, page = 1 } = req.query;
    const all = Trades.recent(1000);
    const start = (page - 1) * limit;
    return {
      items: all.slice(start, start + Number(limit)),
      total: all.length,
      page: Number(page),
      pageSize: Number(limit),
    };
  });

  // ============ 信号流 ============
  app.get('/api/signals', async req => {
    const { limit = 50 } = req.query;
    return { items: Signals.recent(Number(limit)) };
  });

  // ============ 持仓 ============
  app.get('/api/positions', async () => {
    return { items: Positions.all() };
  });

  // ============ 策略回测 ============
  app.post('/api/backtest', async req => {
    const params = req.body || {};
    log.info({ params }, '回测启动');
    const result = await runBacktest(params);
    return result;
  });

  // ============ 健康检查 ============
  app.get('/health', async () => ({
    ok: true,
    uptime: process.uptime(),
    tokens: tokenManager.size(),
  }));

  // ============ 当前配置 ============
  app.get('/api/config', async () => ({
    strategy: config.strategy,
    trade: { ...config.trade, live: config.trade.live },
    pool: config.pool,
    walletAddress: config.walletPubkey,
  }));

  log.info('API 路由已注册');
}
