import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { Bars, Tokens } from '../core/db.js';
import { IndicatorCalculator } from './indicators.js';

const log = child('backtest');

/**
 * 回测引擎
 * 输入:
 *   {
 *     klineSec, rsiPeriod, rsiBuyThreshold, rsiSellHigh, rsiSellCrossDown,
 *     emaPeriod, emaSlopeLookback,
 *     takeProfitPct, stopLossPct, trailingActivatePct, trailingDropPct,
 *     sellCooldownSec, slippagePct
 *   }
 * 输出:
 *   {
 *     totalTrades, wins, losses, winRate, totalPnlPct, avgPnlPct,
 *     profitFactor, byToken: {...}, trades: [...]
 *   }
 */
export async function runBacktest(params = {}) {
  const p = {
    klineSec: params.klineSec ?? 300,
    rsiPeriod: params.rsiPeriod ?? config.strategy.rsiPeriod,
    rsiBuyThreshold: params.rsiBuyThreshold ?? config.strategy.rsiBuyThreshold,
    rsiSellHigh: params.rsiSellHigh ?? config.strategy.rsiSellHigh,
    rsiSellCrossDown: params.rsiSellCrossDown ?? config.strategy.rsiSellCrossDown,
    emaPeriod: params.emaPeriod ?? config.strategy.emaPeriod,
    emaSlopeLookback: params.emaSlopeLookback ?? config.strategy.emaSlopeLookback,
    takeProfitPct: params.takeProfitPct ?? config.strategy.takeProfitPct,
    stopLossPct: params.stopLossPct ?? config.strategy.stopLossPct,
    trailingActivatePct: params.trailingActivatePct ?? config.strategy.trailingActivatePct,
    trailingDropPct: params.trailingDropPct ?? config.strategy.trailingDropPct,
    sellCooldownSec: params.sellCooldownSec ?? config.strategy.sellCooldownSec,
    slippagePct: params.slippagePct ?? 1.5, // 每次买卖1.5%滑点
  };

  const tokens = Tokens.all();
  const allTrades = [];
  const byToken = {};

  for (const t of tokens) {
    const bars = Bars.recent(t.mint, 1000);
    if (bars.length < p.emaPeriod + 5) continue;

    const r = simulateOnBars(bars, p);
    byToken[t.mint] = { symbol: t.symbol, ...r.summary };
    for (const tr of r.trades) {
      allTrades.push({ ...tr, mint: t.mint, symbol: t.symbol });
    }
  }

  const wins = allTrades.filter(t => t.pnlPct > 0).length;
  const losses = allTrades.filter(t => t.pnlPct <= 0).length;
  const winRate = allTrades.length ? (wins / allTrades.length) * 100 : 0;
  const totalPnlPct = allTrades.reduce((s, t) => s + t.pnlPct, 0);
  const avgPnlPct = allTrades.length ? totalPnlPct / allTrades.length : 0;
  const sumWin = allTrades.filter(t => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0);
  const sumLoss = Math.abs(
    allTrades.filter(t => t.pnlPct <= 0).reduce((s, t) => s + t.pnlPct, 0)
  );
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? 999 : 0;

  log.info(
    {
      tokens: Object.keys(byToken).length,
      trades: allTrades.length,
      winRate: winRate.toFixed(1),
      totalPnl: totalPnlPct.toFixed(2),
    },
    '回测完成'
  );

  return {
    params: p,
    summary: {
      tokensAnalyzed: Object.keys(byToken).length,
      totalTrades: allTrades.length,
      wins,
      losses,
      winRate,
      totalPnlPct,
      avgPnlPct,
      profitFactor,
    },
    byToken,
    trades: allTrades.slice(0, 200),
  };
}

function simulateOnBars(bars, p) {
  const ind = new IndicatorCalculator({
    rsiPeriod: p.rsiPeriod,
    emaPeriod: p.emaPeriod,
    emaSlopeLookback: p.emaSlopeLookback,
  });

  let position = null; // {entry, peak, openTs}
  let lastSellTs = 0;
  const trades = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    ind.push(bar.close);
    const snap = ind.snapshot();

    if (snap.rsi === null || snap.prevRsi === null || snap.ema === null || snap.emaSlope === null) {
      continue;
    }

    if (position) {
      // 持仓中，先检查K线高低点的退出
      const entry = position.entry;
      const high = bar.high;
      const low = bar.low;
      const close = bar.close;
      const peak = Math.max(position.peak, high);
      const peakRise = ((peak - entry) / entry) * 100;
      let trailingActive = position.trailingActive || peakRise >= p.trailingActivatePct;

      let exitPrice = null;
      let exitReason = '';

      // 在K线内，先按时间顺序检查（保守: 先低后高）
      const stopLossPrice = entry * (1 + p.stopLossPct / 100);
      const takeProfitPrice = entry * (1 + p.takeProfitPct / 100);

      if (low <= stopLossPrice) {
        exitPrice = stopLossPrice;
        exitReason = 'STOP_LOSS';
      } else if (high >= takeProfitPrice) {
        exitPrice = takeProfitPrice;
        exitReason = 'TAKE_PROFIT';
      } else if (trailingActive) {
        const trailStopPrice = peak * (1 + p.trailingDropPct / 100);
        if (low <= trailStopPrice) {
          exitPrice = trailStopPrice;
          exitReason = 'TRAILING_STOP';
        }
      }

      // RSI 退出 (用收盘价)
      if (!exitPrice) {
        if (snap.rsi > p.rsiSellHigh) {
          exitPrice = close;
          exitReason = `RSI_PANIC(${snap.rsi.toFixed(1)})`;
        } else if (snap.prevRsi >= p.rsiSellCrossDown && snap.rsi < p.rsiSellCrossDown) {
          exitPrice = close;
          exitReason = `RSI_CROSS_DOWN(${snap.prevRsi.toFixed(1)}→${snap.rsi.toFixed(1)})`;
        }
      }

      if (exitPrice) {
        const pnlPct =
          ((exitPrice * (1 - p.slippagePct / 100) - entry * (1 + p.slippagePct / 100)) /
            (entry * (1 + p.slippagePct / 100))) *
          100;
        trades.push({
          entryTs: position.openTs,
          exitTs: bar.ts,
          entry,
          exit: exitPrice,
          pnlPct,
          exitReason,
          rsiAtEntry: position.rsiAtEntry,
          rsiAtExit: snap.rsi,
          peak,
        });
        lastSellTs = bar.ts;
        position = null;
      } else {
        position.peak = peak;
        position.trailingActive = trailingActive;
      }
    } else {
      // 等待买入信号
      const sinceSell = (bar.ts - lastSellTs) / 1000;
      if (lastSellTs > 0 && sinceSell < p.sellCooldownSec) continue;

      const crossUp = snap.prevRsi <= p.rsiBuyThreshold && snap.rsi > p.rsiBuyThreshold;
      if (crossUp && snap.emaSlope >= 0) {
        position = {
          entry: bar.close,
          peak: bar.close,
          openTs: bar.ts,
          rsiAtEntry: snap.rsi,
          trailingActive: false,
        };
      }
    }
  }

  return {
    summary: {
      trades: trades.length,
      wins: trades.filter(t => t.pnlPct > 0).length,
      losses: trades.filter(t => t.pnlPct <= 0).length,
      totalPnlPct: trades.reduce((s, t) => s + t.pnlPct, 0),
    },
    trades,
  };
}
