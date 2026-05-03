import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { bus } from '../core/bus.js';
import { Signals, Positions } from '../core/db.js';

const log = child('strategy');

/**
 * 策略引擎
 *
 * 输入: 每根K线收盘 + 实时价格 + 持仓状态
 * 输出: 买入信号 / 卖出信号
 *
 * 买入条件 (全部满足):
 *   1. RSI(7) 上穿 35  (prev <= 35 && cur > 35)
 *   2. EMA99 斜率 ≥ 0
 *   3. 不在卖出冷却期 (30分钟)
 *   4. 当前未持仓
 *
 * 卖出条件 (任一触发):
 *   A. RSI(7) > 80 → 立即卖出
 *   B. RSI(7) 下穿 70  (prev >= 70 && cur < 70)
 *   C. 止盈 +100%
 *   D. 止损 -50%
 *   E. 移动止损: 涨幅 >= 30% 激活，从峰值回撤 -20% 清仓
 */
export class StrategyEngine {
  /**
   * @param {string} mint
   * @param {object} symbol
   */
  constructor(mint, symbol) {
    this.mint = mint;
    this.symbol = symbol;
    this.lastSellTs = 0;
    this.buyCount = 0;
    this.sellCount = 0;
    this._lastClosedBarTs = 0;
  }

  /**
   * 一次K线收盘后的策略检查
   * @param {{rsi, prevRsi, ema, emaSlope}} indicators
   * @param {number} closePrice
   * @param {number} barTs
   */
  onBarClose(indicators, closePrice, barTs) {
    if (barTs <= this._lastClosedBarTs) return; // 防重
    this._lastClosedBarTs = barTs;

    const { rsi, prevRsi, ema, emaSlope } = indicators;

    if (rsi === null || prevRsi === null || ema === null || emaSlope === null) {
      return; // 指标尚未稳定
    }

    const position = Positions.get(this.mint);
    const holding = !!position && position.amount > 0;

    if (holding) {
      this._checkSellSignals(indicators, closePrice, position, barTs);
    } else {
      this._checkBuySignal(indicators, closePrice, barTs);
    }
  }

  /**
   * 实时价格更新（不依赖K线收盘）- 主要用于止盈止损/移动止损
   */
  onPriceTick(currentPrice) {
    const position = Positions.get(this.mint);
    if (!position || position.amount <= 0) return;

    const indicators = this._snapshot();
    this._checkPriceBasedExit(currentPrice, position, indicators);
  }

  _snapshot() {
    // 由 TokenContext 维护，这里通过事件读取
    // (实际上 TokenContext 会传入 indicators)
    return null;
  }

  /** 买入信号检查 */
  _checkBuySignal(ind, price, ts) {
    const { rsi, prevRsi, emaSlope } = ind;
    const cfg = config.strategy;

    // 1. 卖出冷却
    const sinceSell = (Date.now() - this.lastSellTs) / 1000;
    if (this.lastSellTs > 0 && sinceSell < cfg.sellCooldownSec) {
      return;
    }

    // 2. RSI 上穿 35
    const rsiCrossUp = prevRsi <= cfg.rsiBuyThreshold && rsi > cfg.rsiBuyThreshold;
    if (!rsiCrossUp) return;

    // 3. EMA99 斜率 ≥ 0
    if (emaSlope < 0) {
      log.debug(
        { mint: this.mint.slice(0, 6), emaSlope: emaSlope.toFixed(3) },
        '买入信号被EMA斜率过滤'
      );
      return;
    }

    // 触发买入
    this.buyCount += 1;
    const reason = `RSI_CROSS_UP_${cfg.rsiBuyThreshold}(${prevRsi.toFixed(1)}→${rsi.toFixed(
      1
    )})+EMA_SLOPE=${emaSlope.toFixed(3)}%(lb=${cfg.emaSlopeLookback})`;

    Signals.insert({
      mint: this.mint,
      symbol: this.symbol,
      type: 'BUY_SIGNAL',
      seq: this.buyCount,
      price,
      reason,
      rsi,
      prevRsi,
      emaSlope,
      ts,
    });

    log.info(
      { mint: this.mint.slice(0, 6), symbol: this.symbol, price, reason },
      '🟢 买入信号'
    );

    bus.emit('signal:buy', {
      mint: this.mint,
      symbol: this.symbol,
      price,
      reason,
      seq: this.buyCount,
    });
  }

  /** 卖出信号检查 (基于K线/RSI) */
  _checkSellSignals(ind, price, position, ts) {
    const { rsi, prevRsi } = ind;
    const cfg = config.strategy;

    let exitReason = null;
    let detail = null;

    // A. RSI > 80 (恐慌区, 立即出)
    if (rsi > cfg.rsiSellHigh) {
      exitReason = `RSI_PANIC(${rsi.toFixed(1)}>${cfg.rsiSellHigh})`;
      detail = `RSI过热`;
    }
    // B. RSI 下穿 70
    else if (prevRsi >= cfg.rsiSellCrossDown && rsi < cfg.rsiSellCrossDown) {
      exitReason = `RSI_CROSS_DOWN_${cfg.rsiSellCrossDown}(${prevRsi.toFixed(
        1
      )}→${rsi.toFixed(1)})`;
      detail = 'RSI下穿70';
    }

    if (exitReason) {
      this._triggerSell(position, price, exitReason, detail, ts);
    }
  }

  /** 价格驱动的退出 (止盈止损 / 移动止损) */
  _checkPriceBasedExit(price, position, ind) {
    if (!position || position.amount <= 0) return;
    const cfg = config.strategy;
    const entry = position.avg_price;
    const pnlPct = ((price - entry) / entry) * 100;

    // 止盈
    if (pnlPct >= cfg.takeProfitPct) {
      this._triggerSell(
        position,
        price,
        `TAKE_PROFIT(+${pnlPct.toFixed(1)}%)`,
        '止盈',
        Date.now()
      );
      return;
    }

    // 止损
    if (pnlPct <= cfg.stopLossPct) {
      this._triggerSell(
        position,
        price,
        `STOP_LOSS(${pnlPct.toFixed(1)}%)`,
        '止损',
        Date.now()
      );
      return;
    }

    // 移动止损
    let peak = position.peak_price || entry;
    let trailingActive = !!position.trailing_active;

    if (price > peak) {
      peak = price;
      Positions.upsert({
        ...this._positionToObj(position),
        peakPrice: peak,
        trailingActive,
      });
    }

    const peakRise = ((peak - entry) / entry) * 100;
    if (!trailingActive && peakRise >= cfg.trailingActivatePct) {
      trailingActive = true;
      Positions.upsert({
        ...this._positionToObj(position),
        peakPrice: peak,
        trailingActive: true,
      });
      log.info({ mint: this.mint.slice(0, 6), peakRise: peakRise.toFixed(1) }, '✓ 移动止损激活');
    }

    if (trailingActive) {
      const drop = ((price - peak) / peak) * 100;
      if (drop <= cfg.trailingDropPct) {
        this._triggerSell(
          position,
          price,
          `TRAILING_STOP(peak ${peakRise.toFixed(1)}%, drop ${drop.toFixed(1)}%)`,
          '移动止损',
          Date.now()
        );
      }
    }
  }

  _positionToObj(p) {
    return {
      mint: p.mint,
      symbol: p.symbol,
      amount: p.amount,
      avgPrice: p.avg_price,
      costSol: p.cost_sol,
      peakPrice: p.peak_price,
      trailingActive: p.trailing_active,
      openedAt: p.opened_at,
    };
  }

  _triggerSell(position, price, exitReason, detail, ts) {
    this.sellCount += 1;
    const reason = exitReason;

    Signals.insert({
      mint: this.mint,
      symbol: this.symbol,
      type: 'SELL_SIGNAL',
      seq: this.sellCount,
      price,
      reason,
      ts,
    });

    log.info(
      { mint: this.mint.slice(0, 6), symbol: this.symbol, price, reason },
      '🔴 卖出信号'
    );

    bus.emit('signal:sell', {
      mint: this.mint,
      symbol: this.symbol,
      price,
      reason,
      exitReason: detail,
      position,
      seq: this.sellCount,
    });
  }

  /** 标记一次卖出已完成 (用于冷却期) */
  markSold() {
    this.lastSellTs = Date.now();
  }
}
