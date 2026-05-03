import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { KlineAggregator } from '../strategy/kline.js';
import { IndicatorCalculator } from '../strategy/indicators.js';
import { StrategyEngine } from '../strategy/engine.js';
import { Bars, Tokens, Trades } from './db.js';

const log = child('token-ctx');

/**
 * 单币上下文 - 把K线/指标/策略串起来
 */
export class TokenContext {
  constructor({ mint, symbol, name, decimals }) {
    this.mint = mint;
    this.symbol = symbol;
    this.name = name;
    this.decimals = decimals;
    this.metadata = {
      price: null,
      fdvUsd: null,
      lpUsd: null,
      volume24hUsd: null,
      ageSeconds: null,
    };

    this.kline = new KlineAggregator({
      mint,
      intervalSec: config.strategy.klineIntervalSec,
    });

    this.ind = new IndicatorCalculator({
      rsiPeriod: config.strategy.rsiPeriod,
      emaPeriod: config.strategy.emaPeriod,
      emaSlopeLookback: config.strategy.emaSlopeLookback,
    });

    this.strategy = new StrategyEngine(mint, symbol);

    this._lastIndicators = { rsi: null, prevRsi: null, ema: null, emaSlope: null };

    // 买卖压（用于UI显示）
    this.buyVolume = 0;
    this.sellVolume = 0;
    this._volumeWindow = []; // [{ts, side, vol}]

    // 实时价格 (用于止盈止损快速反应)
    this.currentPrice = null;

    // K线收盘事件
    this.kline.on('bar_close', bar => this._onBarClose(bar));
  }

  /** 用历史K线初始化（首次添加币） */
  bootstrap(historyBars) {
    if (!historyBars || !historyBars.length) {
      this._restoreStrategyState();
      return;
    }
    this.kline.bootstrap(historyBars);

    // 重新计算指标
    this.ind = new IndicatorCalculator({
      rsiPeriod: config.strategy.rsiPeriod,
      emaPeriod: config.strategy.emaPeriod,
      emaSlopeLookback: config.strategy.emaSlopeLookback,
    });
    for (const bar of historyBars) {
      this.ind.push(bar.close);
    }
    this._lastIndicators = this.ind.snapshot();

    // 持久化历史K线
    for (const bar of historyBars) {
      Bars.insert(this.mint, bar);
    }

    // 恢复策略状态（lastSellTs / buyCount / sellCount）
    this._restoreStrategyState();

    log.info(
      {
        mint: this.mint.slice(0, 6),
        bars: historyBars.length,
        rsi: this._lastIndicators.rsi?.toFixed(2),
        ema: this._lastIndicators.ema?.toFixed(8),
        lastSellTs: this.strategy.lastSellTs,
        buyCount: this.strategy.buyCount,
        sellCount: this.strategy.sellCount,
      },
      '✓ 初始化完成'
    );
  }

  /** 从 trades 表恢复策略运行时状态（卖出冷却 + 序号） */
  _restoreStrategyState() {
    try {
      const state = Trades.getStrategyState(this.mint);
      this.strategy.lastSellTs = state.lastSellTs;
      this.strategy.buyCount = state.buyCount;
      this.strategy.sellCount = state.sellCount;
    } catch (e) {
      log.warn({ mint: this.mint.slice(0, 6), err: e.message }, '恢复策略状态失败');
    }
  }

  /** 接收一笔实时交易 */
  onTrade({ price, ts, volumeUsd, side }) {
    if (price && Number.isFinite(price)) {
      this.currentPrice = price;
      this.metadata.price = price;
    }

    if (price && volumeUsd) {
      this._volumeWindow.push({ ts: ts || Date.now(), side, vol: volumeUsd });
      this._trimVolumeWindow();
    }

    this.kline.onTrade(price, ts, volumeUsd);

    // 实时价格驱动的退出 (止盈/止损/移动止损)
    this.strategy.onPriceTick(price);
  }

  _trimVolumeWindow() {
    const cutoff = Date.now() - config.strategy.klineIntervalSec * 1000;
    while (this._volumeWindow.length && this._volumeWindow[0].ts < cutoff) {
      this._volumeWindow.shift();
    }
    this.buyVolume = this._volumeWindow
      .filter(x => x.side === 'buy')
      .reduce((s, x) => s + x.vol, 0);
    this.sellVolume = this._volumeWindow
      .filter(x => x.side === 'sell')
      .reduce((s, x) => s + x.vol, 0);
  }

  /** K线收盘 - 触发指标更新和策略检查 */
  _onBarClose(bar) {
    // 持久化
    Bars.insert(this.mint, bar);

    // 推入指标
    this.ind.push(bar.close);
    const snap = this.ind.snapshot();
    this._lastIndicators = snap;
    this.ind.trim(500);

    // 更新DB metrics
    Tokens.updateMetrics(this.mint, {
      price: bar.close,
      rsi: snap.rsi,
      prevRsi: snap.prevRsi,
      ema99: snap.ema,
      emaSlope: snap.emaSlope,
      buyPressure: this.buyVolume,
      sellPressure: this.sellVolume,
      barsCount: this.kline.bars.length,
    });

    // 触发策略
    this.strategy.onBarClose(snap, bar.close, bar.ts);
  }

  /** 定时器驱动 - 强制关闭跨期K线 */
  tick() {
    this.kline.tick();
  }

  updateMetadata(meta) {
    Object.assign(this.metadata, meta);
    Tokens.upsert({
      mint: this.mint,
      symbol: this.symbol,
      name: this.name,
      ...meta,
    });
  }

  getSnapshot() {
    return {
      mint: this.mint,
      symbol: this.symbol,
      name: this.name,
      ...this.metadata,
      ...this._lastIndicators,
      buyVolume: this.buyVolume,
      sellVolume: this.sellVolume,
      barsCount: this.kline.bars.length,
    };
  }
}
