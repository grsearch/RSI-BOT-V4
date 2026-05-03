import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { bus } from './bus.js';
import { Tokens, Positions, Bars } from './db.js';
import { TokenContext } from './tokenContext.js';
import { getTokenOverview, getHistoryOHLCV, birdeyeWss } from '../api/birdeye.js';

const log = child('token-mgr');

class TokenManager {
  constructor() {
    /** @type {Map<string, TokenContext>} */
    this.contexts = new Map();
    this._tickTimer = null;
  }

  start() {
    // 每30秒强制驱动K线收盘 + 元数据刷新
    this._tickTimer = setInterval(() => this._tick(), 30000);

    // 接收实时trade
    bus.on('trade:received', payload => {
      const ctx = this.contexts.get(payload.mint);
      if (ctx) ctx.onTrade(payload);
    });

    // 启动时恢复DB中的所有币
    this._restore();

    log.info('Token Manager 已启动');
  }

  async _restore() {
    const tokens = Tokens.all();
    log.info(`恢复 ${tokens.length} 个监控代币`);
    for (const t of tokens) {
      await this.add(t.mint, { skipChecks: true, restoredFromDb: true }).catch(e => {
        log.warn({ mint: t.mint, err: e.message }, '恢复失败');
      });
    }
  }

  /**
   * 添加新币到监控
   * @param {string} mint
   * @param {object} opts
   * @returns {Promise<{added:boolean, reason?:string}>}
   */
  async add(mint, opts = {}) {
    if (!mint || typeof mint !== 'string') {
      return { added: false, reason: 'invalid mint' };
    }

    if (this.contexts.has(mint)) {
      return { added: false, reason: 'already monitoring' };
    }

    // 检查容量
    if (this.contexts.size >= config.pool.maxTokens) {
      const evicted = await this._evictLowestVolume();
      if (!evicted) {
        return { added: false, reason: 'pool full and no evictable token' };
      }
    }

    // 拉取基本信息
    const overview = await getTokenOverview(mint);
    if (!overview) {
      return { added: false, reason: 'overview unavailable' };
    }

    // 健康度检查
    if (!opts.skipChecks) {
      if ((overview.fdvUsd || 0) < config.pool.minFdvUsd) {
        log.warn(
          { mint: mint.slice(0, 6), fdv: overview.fdvUsd },
          '拒绝: FDV过低'
        );
        return { added: false, reason: `FDV<${config.pool.minFdvUsd}` };
      }
      if ((overview.lpUsd || 0) < config.pool.minLpUsd) {
        log.warn({ mint: mint.slice(0, 6), lp: overview.lpUsd }, '拒绝: LP过低');
        return { added: false, reason: `LP<${config.pool.minLpUsd}` };
      }
    }

    // 创建上下文
    const ctx = new TokenContext({
      mint,
      symbol: overview.symbol,
      name: overview.name,
      decimals: overview.decimals,
    });
    ctx.updateMetadata({
      price: overview.price,
      fdvUsd: overview.fdvUsd,
      lpUsd: overview.lpUsd,
      volume24hUsd: overview.volume24hUsd,
      ageSeconds: overview.ageSeconds,
    });

    // K线初始化策略：
    //  - 重启场景: 优先用 SQLite 中的本地K线 (Bars.recent)，避免重复消耗API额度
    //  - 新增场景或数据不足: 从 Birdeye 拉历史
    let history = [];
    if (opts.restoredFromDb) {
      const local = Bars.recent(mint, 200);
      if (local.length >= config.strategy.emaPeriod + 5) {
        history = local;
        log.info(
          { mint: mint.slice(0, 6), bars: local.length },
          '✓ 用本地缓存K线恢复'
        );
      }
    }
    if (!history.length) {
      history = await getHistoryOHLCV(mint, config.strategy.klineIntervalSec, 150);
    }
    if (history.length) ctx.bootstrap(history);

    this.contexts.set(mint, ctx);

    // 订阅实时数据
    birdeyeWss.subscribePriceTrades(mint);

    log.info(
      {
        mint: mint.slice(0, 6),
        symbol: overview.symbol,
        fdv: overview.fdvUsd,
        lp: overview.lpUsd,
      },
      '✓ 添加监控'
    );

    bus.emit('token:added', { mint, symbol: overview.symbol });

    return { added: true, ctx };
  }

  /** 移除一个币 */
  async remove(mint, reason = 'manual') {
    const ctx = this.contexts.get(mint);
    if (!ctx) return false;

    // 检查持仓 - 必须先平仓
    const pos = Positions.get(mint);
    if (pos && pos.amount > 0) {
      log.warn({ mint: mint.slice(0, 6), reason }, '退出前有持仓，触发平仓');
      bus.emit('signal:sell', {
        mint,
        symbol: ctx.symbol,
        price: ctx.currentPrice,
        reason: 'FORCE_EXIT',
        exitReason: `强制退出: ${reason}`,
        position: pos,
        seq: ctx.strategy.sellCount + 1,
      });
      // 等候平仓，但不阻塞太久
      await new Promise(r => setTimeout(r, 5000));
    }

    birdeyeWss.unsubscribe(mint);
    this.contexts.delete(mint);
    Tokens.remove(mint);

    log.info({ mint: mint.slice(0, 6), reason }, '已移除监控');
    bus.emit('token:removed', { mint, reason });
    return true;
  }

  /** 淘汰24h volume最低的非持仓币 */
  async _evictLowestVolume() {
    const candidates = Tokens.lowestVolume(1);
    if (!candidates.length) return false;
    const target = candidates[0];
    log.info(
      { mint: target.mint.slice(0, 6), vol: target.volume_24h_usd },
      '淘汰最低volume代币以腾出位置'
    );
    return this.remove(target.mint, 'evicted-low-volume');
  }

  /** 定时刷新元数据 + 驱动K线 */
  async _tick() {
    for (const ctx of this.contexts.values()) {
      ctx.tick();
    }

    // 每5次tick(2.5min)刷新一次metadata
    if (!this._tickCount) this._tickCount = 0;
    this._tickCount++;
    if (this._tickCount % 5 !== 0) return;

    for (const ctx of this.contexts.values()) {
      try {
        const ov = await getTokenOverview(ctx.mint);
        if (!ov) continue;

        ctx.updateMetadata({
          price: ov.price,
          fdvUsd: ov.fdvUsd,
          lpUsd: ov.lpUsd,
          volume24hUsd: ov.volume24hUsd,
          ageSeconds: ov.ageSeconds,
        });

        // 健康度检查
        if (
          (ov.fdvUsd || 0) < config.pool.minFdvUsd ||
          (ov.lpUsd || 0) < config.pool.minLpUsd
        ) {
          log.warn(
            {
              mint: ctx.mint.slice(0, 6),
              fdv: ov.fdvUsd,
              lp: ov.lpUsd,
            },
            '健康度不达标，移除'
          );
          await this.remove(ctx.mint, 'unhealthy');
        }
      } catch (e) {
        log.warn({ mint: ctx.mint, err: e.message }, '刷新metadata失败');
      }
    }
  }

  list() {
    return [...this.contexts.values()].map(c => c.getSnapshot());
  }

  get(mint) {
    return this.contexts.get(mint);
  }

  size() {
    return this.contexts.size;
  }
}

export const tokenManager = new TokenManager();
