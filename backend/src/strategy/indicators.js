/**
 * 指标计算 - GMGN/TradingView 标准
 *
 * RSI(N): Wilder's Smoothing (RMA)
 *   - 第一根: avg_gain/avg_loss = SMA(gains[1..N], losses[1..N])
 *   - 后续:   avg_gain = (prev_avg_gain * (N-1) + gain) / N
 *            avg_loss = (prev_avg_loss * (N-1) + loss) / N
 *   - RS = avg_gain / avg_loss
 *   - RSI = 100 - 100/(1+RS)   (avg_loss=0 时 RSI=100)
 *
 * EMA(N): 标准 EMA
 *   - 种子: 取前 N 根的 SMA 作为 seed
 *   - 后续: EMA = price * α + EMA_prev * (1 - α),  α = 2/(N+1)
 *
 * 这与 GMGN、TradingView、Binance 的算法完全一致。
 */

export class IndicatorCalculator {
  constructor({ rsiPeriod = 7, emaPeriod = 99, emaSlopeLookback = 5 } = {}) {
    this.rsiPeriod = rsiPeriod;
    this.emaPeriod = emaPeriod;
    this.emaSlopeLookback = emaSlopeLookback;

    // 闭收盘价序列 (按K线收盘时间顺序)
    this.closes = [];

    // RSI 状态 (Wilder)
    this.avgGain = null;
    this.avgLoss = null;
    this.rsiSeries = []; // 与 closes 对齐，None 表示尚未稳定

    // EMA 状态
    this.emaValue = null;
    this.emaSeries = []; // 与 closes 对齐
  }

  /**
   * 推入一根新K线收盘价
   * @returns {{rsi:number|null, prevRsi:number|null, ema:number|null, emaSlope:number|null}}
   */
  push(close) {
    const c = Number(close);
    if (!Number.isFinite(c) || c <= 0) {
      return this.snapshot();
    }

    this.closes.push(c);
    this._updateRsi();
    this._updateEma();
    return this.snapshot();
  }

  _updateRsi() {
    const n = this.closes.length;
    const period = this.rsiPeriod;

    if (n < 2) {
      this.rsiSeries.push(null);
      return;
    }

    const change = this.closes[n - 1] - this.closes[n - 2];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (n - 1 < period) {
      // 还在累积阶段，等够 period+1 根
      this.rsiSeries.push(null);
      return;
    }

    if (n - 1 === period) {
      // 第一个 RSI: 用 SMA 做种子
      let sumGain = 0;
      let sumLoss = 0;
      for (let i = 1; i <= period; i++) {
        const ch = this.closes[i] - this.closes[i - 1];
        if (ch > 0) sumGain += ch;
        else sumLoss += -ch;
      }
      this.avgGain = sumGain / period;
      this.avgLoss = sumLoss / period;
    } else {
      // Wilder's Smoothing
      this.avgGain = (this.avgGain * (period - 1) + gain) / period;
      this.avgLoss = (this.avgLoss * (period - 1) + loss) / period;
    }

    let rsi;
    if (this.avgLoss === 0) {
      rsi = 100;
    } else {
      const rs = this.avgGain / this.avgLoss;
      rsi = 100 - 100 / (1 + rs);
    }
    this.rsiSeries.push(rsi);
  }

  _updateEma() {
    const n = this.closes.length;
    const period = this.emaPeriod;

    if (n < period) {
      this.emaSeries.push(null);
      return;
    }

    if (n === period) {
      // 种子: SMA
      let sum = 0;
      for (let i = 0; i < period; i++) sum += this.closes[i];
      this.emaValue = sum / period;
    } else {
      const alpha = 2 / (period + 1);
      this.emaValue = this.closes[n - 1] * alpha + this.emaValue * (1 - alpha);
    }
    this.emaSeries.push(this.emaValue);
  }

  /** 获取当前指标快照 */
  snapshot() {
    const len = this.rsiSeries.length;
    const rsi = len > 0 ? this.rsiSeries[len - 1] : null;
    const prevRsi = len > 1 ? this.rsiSeries[len - 2] : null;
    const ema = this.emaSeries.length > 0 ? this.emaSeries[this.emaSeries.length - 1] : null;
    const emaSlope = this._calcSlope();
    return { rsi, prevRsi, ema, emaSlope };
  }

  /**
   * EMA 斜率 (百分比形式)
   * slope = (ema_now - ema_lookback_ago) / ema_lookback_ago * 100
   */
  _calcSlope() {
    const arr = this.emaSeries;
    const lb = this.emaSlopeLookback;
    if (arr.length <= lb) return null;

    const now = arr[arr.length - 1];
    const past = arr[arr.length - 1 - lb];
    if (now === null || past === null || past === 0) return null;

    return ((now - past) / past) * 100;
  }

  /**
   * 信号判断: RSI 上穿阈值
   * 条件: prevRsi <= threshold && rsi > threshold
   */
  isCrossUp(threshold) {
    const len = this.rsiSeries.length;
    if (len < 2) return false;
    const prev = this.rsiSeries[len - 2];
    const cur = this.rsiSeries[len - 1];
    if (prev === null || cur === null) return false;
    return prev <= threshold && cur > threshold;
  }

  /**
   * 信号判断: RSI 下穿阈值
   * 条件: prevRsi >= threshold && rsi < threshold
   */
  isCrossDown(threshold) {
    const len = this.rsiSeries.length;
    if (len < 2) return false;
    const prev = this.rsiSeries[len - 2];
    const cur = this.rsiSeries[len - 1];
    if (prev === null || cur === null) return false;
    return prev >= threshold && cur < threshold;
  }

  /** 当前是否过热 (RSI > 阈值) */
  isOverbought(threshold) {
    const cur = this.rsiSeries[this.rsiSeries.length - 1];
    return cur !== null && cur > threshold;
  }

  /** 内存控制：保留最近 N 根 */
  trim(maxBars = 500) {
    if (this.closes.length <= maxBars) return;
    const drop = this.closes.length - maxBars;
    this.closes.splice(0, drop);
    this.rsiSeries.splice(0, drop);
    this.emaSeries.splice(0, drop);
  }
}
