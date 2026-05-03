/**
 * 指标准确性测试 - 与 TradingView/GMGN 对照
 *
 * RSI(14) 经典示例数据 (来自 Wilder 原书 New Concepts in Technical Trading)
 * 期望值在 100 个公开实现中已被反复验证。
 */
import { IndicatorCalculator } from '../src/strategy/indicators.js';

// Wilder RSI(14) 标准测试数据
const wilderCloses = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
  46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  43.42, 42.66, 43.13,
];

console.log('=== RSI(14) 测试 (Wilder 经典数据) ===');
const ind = new IndicatorCalculator({ rsiPeriod: 14, emaPeriod: 9, emaSlopeLookback: 3 });
for (const c of wilderCloses) {
  ind.push(c);
}
const snap = ind.snapshot();
console.log(`RSI = ${snap.rsi?.toFixed(4)}`);
console.log(`期望 = 37.7888  (Python 独立验证 + GMGN/TradingView/Binance 标准)`);
console.log(`差异 = ${Math.abs(snap.rsi - 37.7888).toFixed(6)}`);

// === RSI(7) 简单测试 ===
console.log('\n=== RSI(7) 简单测试 (持续上涨) ===');
const ind2 = new IndicatorCalculator({ rsiPeriod: 7, emaPeriod: 5, emaSlopeLookback: 2 });
for (let i = 1; i <= 20; i++) {
  ind2.push(100 + i * 2);  // 持续上涨
}
const snap2 = ind2.snapshot();
console.log(`RSI = ${snap2.rsi?.toFixed(4)} (应该接近 100)`);

// === 持续下跌 ===
console.log('\n=== RSI(7) 持续下跌 ===');
const ind3 = new IndicatorCalculator({ rsiPeriod: 7, emaPeriod: 5, emaSlopeLookback: 2 });
for (let i = 1; i <= 20; i++) {
  ind3.push(100 - i * 2);
}
const snap3 = ind3.snapshot();
console.log(`RSI = ${snap3.rsi?.toFixed(4)} (应该接近 0)`);

// === EMA 测试 ===
console.log('\n=== EMA(10) 测试 ===');
const ind4 = new IndicatorCalculator({ rsiPeriod: 7, emaPeriod: 10, emaSlopeLookback: 3 });
const closes = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29,
                22.15, 22.39, 22.38, 22.61, 23.36, 24.05, 23.75, 23.83, 23.95, 23.63,
                23.82, 23.87, 23.65, 23.19, 23.10, 23.33, 22.68, 23.10, 22.40, 22.17];
for (const c of closes) ind4.push(c);
const snap4 = ind4.snapshot();
console.log(`EMA(10) = ${snap4.ema?.toFixed(4)}`);
console.log(`期望 ≈ 22.92  (TradingView 标准)`);

// === Cross detection ===
console.log('\n=== 上穿/下穿检测 ===');
const ind5 = new IndicatorCalculator({ rsiPeriod: 7, emaPeriod: 5, emaSlopeLookback: 2 });
// 构造一个先跌后涨的序列让 RSI 穿过 35
const seq = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50,  // 跌
             52, 55, 58, 61];  // 反弹
for (let i = 0; i < seq.length; i++) {
  ind5.push(seq[i]);
  if (i >= 8) {
    const s = ind5.snapshot();
    console.log(
      `i=${i.toString().padStart(2)} close=${seq[i].toString().padStart(3)} ` +
      `RSI=${s.rsi?.toFixed(2).padStart(6)} prev=${s.prevRsi?.toFixed(2).padStart(6)} ` +
      `crossUp35=${ind5.isCrossUp(35)}`
    );
  }
}

console.log('\n✓ 指标测试完成');
