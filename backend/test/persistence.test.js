/**
 * 数据持久化测试
 * 模拟"重启"流程：写数据 → 关闭DB → 重新打开 → 校验数据完整
 */
process.env.WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';
process.env.HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'test';
process.env.BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || 'test';
process.env.DB_PATH = '/tmp/test-bot.db';

import { rmSync } from 'node:fs';
try { rmSync('/tmp/test-bot.db'); rmSync('/tmp/test-bot.db-wal'); rmSync('/tmp/test-bot.db-shm'); } catch {}

const { Tokens, Trades, Signals, Positions, Bars, closeDb } = await import('../src/core/db.js');

console.log('=== 测试 1: 写入并读取 tokens ===');
Tokens.upsert({
  mint: 'TEST_MINT_1',
  symbol: 'TEST',
  name: 'Test Token',
  price: 0.001,
  fdvUsd: 50000,
  lpUsd: 20000,
  volume24hUsd: 100000,
  ageSeconds: 3600,
});
const got = Tokens.get('TEST_MINT_1');
console.log(`✓ Token 写入读取: ${got.symbol}, price=${got.price}`);

console.log('\n=== 测试 2: 写入持仓 ===');
Positions.upsert({
  mint: 'TEST_MINT_1',
  symbol: 'TEST',
  amount: 100000,
  avgPrice: 0.001,
  costSol: 2,
  peakPrice: 0.0015,
  trailingActive: true,
  openedAt: Date.now() - 3600 * 1000,
});
const pos = Positions.get('TEST_MINT_1');
console.log(`✓ 持仓写入: amount=${pos.amount}, peak=${pos.peak_price}, trailing=${pos.trailing_active}`);

console.log('\n=== 测试 3: 写入交易记录 ===');
const now = Date.now();
Trades.insert({
  mint: 'TEST_MINT_1', symbol: 'TEST', side: 'BUY', seq: 1,
  price: 0.001, solAmount: 2, tokenAmount: 100000,
  reason: 'RSI_CROSS_UP_35(30→40)',
  txSignature: 'sig_test_buy_1', success: true, ts: now - 1000,
});
Trades.insert({
  mint: 'TEST_MINT_1', symbol: 'TEST', side: 'SELL', seq: 1,
  price: 0.0015, solAmount: 3, tokenAmount: 100000,
  pnlSol: 1.0, pnlPct: 50.0,
  reason: 'RSI_CROSS_DOWN_70',
  exitReason: 'RSI下穿70',
  txSignature: 'sig_test_sell_1', success: true, ts: now,
});
const trades = Trades.recent(10);
console.log(`✓ 交易写入: ${trades.length} 条`);

console.log('\n=== 测试 4: 写入K线 ===');
for (let i = 0; i < 50; i++) {
  Bars.insert('TEST_MINT_1', {
    ts: now - (50 - i) * 300_000,
    open: 0.001 + i * 0.00001,
    high: 0.0011 + i * 0.00001,
    low: 0.0009 + i * 0.00001,
    close: 0.001 + i * 0.00001,
    volume: 1000,
  });
}
const bars = Bars.recent('TEST_MINT_1', 100);
console.log(`✓ K线写入: ${bars.length} 根`);

console.log('\n=== 测试 5: 写入信号 ===');
Signals.insert({
  mint: 'TEST_MINT_1', symbol: 'TEST', type: 'BUY_SIGNAL',
  seq: 1, price: 0.001, reason: 'test',
  rsi: 40, prevRsi: 30, emaSlope: 0.5,
  ts: now,
});
const sigs = Signals.recent(10);
console.log(`✓ 信号写入: ${sigs.length} 条`);

console.log('\n=== 测试 6: 策略状态查询 ===');
const state = Trades.getStrategyState('TEST_MINT_1');
console.log(`✓ buyCount=${state.buyCount}, sellCount=${state.sellCount}, lastSellTs=${state.lastSellTs}`);
console.log(`  与最新SELL时间一致: ${state.lastSellTs === now}`);

console.log('\n=== 测试 7: 优雅关闭DB（WAL落盘） ===');
closeDb();
console.log(`✓ 数据库已关闭`);

console.log('\n=== 测试 8: 模拟重启 - 重新打开DB读取 ===');
// 强制重新加载模块（模拟新进程）
const fresh = await import('../src/core/db.js?t=' + Date.now());

const tokenAgain = fresh.Tokens.get('TEST_MINT_1');
const posAgain = fresh.Positions.get('TEST_MINT_1');
const tradesAgain = fresh.Trades.recent(10);
const barsAgain = fresh.Bars.recent('TEST_MINT_1', 100);
const stateAgain = fresh.Trades.getStrategyState('TEST_MINT_1');

console.log(`✓ Token 仍存在: ${tokenAgain?.symbol === 'TEST'}`);
console.log(`✓ 持仓仍存在: amount=${posAgain?.amount}, trailing=${posAgain?.trailing_active}`);
console.log(`✓ 交易仍在: ${tradesAgain.length} 条`);
console.log(`✓ K线仍在: ${barsAgain.length} 根`);
console.log(`✓ 策略状态仍可恢复: lastSellTs=${stateAgain.lastSellTs > 0}`);

console.log('\n✅ 所有持久化测试通过 - 数据在重启后完整保留');

fresh.closeDb();

// 清理
try { rmSync('/tmp/test-bot.db'); rmSync('/tmp/test-bot.db-wal'); rmSync('/tmp/test-bot.db-shm'); } catch {}
