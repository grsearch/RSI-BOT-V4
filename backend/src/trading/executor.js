import PQueue from 'p-queue';
import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { bus } from '../core/bus.js';
import { Trades, Positions, Tokens } from '../core/db.js';
import { executeBuy, executeSell } from './jupiter.js';
import { getTokenBalance } from '../api/helius.js';

const log = child('executor');

/**
 * 交易执行器
 * - 串行执行交易（避免并发nonce冲突）
 * - 处理买入/卖出信号
 * - 更新持仓
 * - 写入trade记录
 */
class TradeExecutor {
  constructor() {
    // 全局串行队列（每次只执行一笔交易）
    this.queue = new PQueue({ concurrency: 1 });
  }

  start() {
    bus.on('signal:buy', payload => {
      this.queue.add(() => this._handleBuy(payload));
    });

    bus.on('signal:sell', payload => {
      this.queue.add(() => this._handleSell(payload));
    });

    log.info('交易执行器已启动');
  }

  async _handleBuy({ mint, symbol, price, reason, seq }) {
    // 二次检查 - 避免重复买入
    const pos = Positions.get(mint);
    if (pos && pos.amount > 0) {
      log.warn({ mint: mint.slice(0, 6) }, '已有持仓，跳过买入');
      return;
    }

    Tokens.updateMetrics(mint, { lastSignal: 'BUY', lastReason: reason, status: 'BUYING' });

    const result = await executeBuy({
      mint,
      solAmount: config.trade.amountSol,
      symbol,
    });

    if (!result.success) {
      log.error({ mint: mint.slice(0, 6), err: result.error }, '✗ 买入失败');
      Tokens.updateMetrics(mint, { status: 'WATCHING' });
      Trades.insert({
        mint,
        symbol,
        side: 'BUY',
        seq,
        price,
        solAmount: config.trade.amountSol,
        reason,
        success: false,
        error: result.error,
        ts: Date.now(),
      });
      bus.emit('trade:executed', { mint, side: 'BUY', success: false, error: result.error });
      return;
    }

    // 估算获得的token数量
    const tokenAmount = result.outputAmount; // 最小单位
    const ctx = await this._getCtx(mint);
    const decimals = ctx?.decimals ?? 6;
    const uiAmount = tokenAmount / Math.pow(10, decimals);
    const actualPrice = (config.trade.amountSol * 1) / uiAmount;

    // 写持仓
    Positions.upsert({
      mint,
      symbol,
      amount: uiAmount,
      avgPrice: actualPrice,
      costSol: config.trade.amountSol,
      peakPrice: actualPrice,
      trailingActive: false,
      openedAt: Date.now(),
    });

    Tokens.updateMetrics(mint, { status: 'HOLDING' });

    Trades.insert({
      mint,
      symbol,
      side: 'BUY',
      seq,
      price: actualPrice,
      solAmount: config.trade.amountSol,
      tokenAmount: uiAmount,
      reason,
      txSignature: result.signature,
      slippageBps: result.slippageBps,
      success: true,
      ts: Date.now(),
    });

    log.info(
      {
        mint: mint.slice(0, 6),
        symbol,
        sol: config.trade.amountSol,
        tokens: uiAmount,
        sig: result.signature.slice(0, 12),
      },
      '✓ BUY 成功'
    );

    bus.emit('trade:executed', { mint, side: 'BUY', success: true, ...result });
  }

  async _handleSell({ mint, symbol, price, reason, exitReason, position, seq }) {
    const pos = position || Positions.get(mint);
    if (!pos || pos.amount <= 0) {
      log.warn({ mint: mint.slice(0, 6) }, '无持仓，跳过卖出');
      return;
    }

    // 从链上读取真实余额（避免数据库与链上不一致）
    const onchain = await getTokenBalance(config.walletPubkey, mint);
    if (onchain.amount <= 0n) {
      log.warn({ mint: mint.slice(0, 6) }, '链上余额为0，清理持仓记录');
      Positions.remove(mint);
      Tokens.updateMetrics(mint, { status: 'WATCHING' });
      return;
    }

    Tokens.updateMetrics(mint, { lastSignal: 'SELL', lastReason: reason, status: 'SELLING' });

    const result = await executeSell({
      mint,
      tokenAmountRaw: onchain.amount,
      symbol,
    });

    if (!result.success) {
      log.error({ mint: mint.slice(0, 6), err: result.error }, '✗ 卖出失败');
      Tokens.updateMetrics(mint, { status: 'HOLDING' });
      Trades.insert({
        mint,
        symbol,
        side: 'SELL',
        seq,
        price,
        reason,
        exitReason,
        success: false,
        error: result.error,
        ts: Date.now(),
      });
      bus.emit('trade:executed', { mint, side: 'SELL', success: false, error: result.error });
      return;
    }

    const solOut = result.outputSol;
    const pnlSol = solOut - pos.cost_sol;
    const pnlPct = (pnlSol / pos.cost_sol) * 100;

    Positions.remove(mint);
    Tokens.updateMetrics(mint, { status: 'WATCHING' });

    // 通知策略冷却
    const ctx = await this._getCtx(mint);
    if (ctx) ctx.strategy.markSold();

    Trades.insert({
      mint,
      symbol,
      side: 'SELL',
      seq,
      price: solOut / pos.amount,
      solAmount: solOut,
      tokenAmount: pos.amount,
      pnlSol,
      pnlPct,
      reason,
      exitReason,
      txSignature: result.signature,
      slippageBps: result.slippageBps,
      success: true,
      ts: Date.now(),
    });

    log.info(
      {
        mint: mint.slice(0, 6),
        symbol,
        solOut,
        pnlSol: pnlSol.toFixed(4),
        pnlPct: pnlPct.toFixed(2),
        sig: result.signature.slice(0, 12),
      },
      pnlSol >= 0 ? '✓ SELL 成功 (盈利)' : '✓ SELL 成功 (亏损)'
    );

    bus.emit('trade:executed', { mint, side: 'SELL', success: true, pnlSol, pnlPct, ...result });
  }

  async _getCtx(mint) {
    // 延迟引入避免循环
    const { tokenManager } = await import('../core/tokenManager.js');
    return tokenManager.get(mint);
  }
}

export const executor = new TradeExecutor();
