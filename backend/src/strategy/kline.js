import { EventEmitter } from 'node:events';

/**
 * K线聚合器
 * - 接收实时 trades (price, ts, volume)
 * - 按 intervalSec 周期对齐时间戳生成K线
 * - 输出 OHLCV
 *
 * 时间对齐策略：以UTC对齐，例如5分钟K线 → 0,5,10,15...分对齐
 */
export class KlineAggregator extends EventEmitter {
  constructor({ mint, intervalSec = 300, maxBars = 500 }) {
    super();
    this.mint = mint;
    this.intervalMs = intervalSec * 1000;
    this.maxBars = maxBars;

    /** @type {Array<{open:number, high:number, low:number, close:number, volume:number, ts:number}>} */
    this.bars = [];

    this._current = null; // 正在形成的K线
  }

  /** 时间戳对齐到K线起始 */
  _bucketStart(ts) {
    return Math.floor(ts / this.intervalMs) * this.intervalMs;
  }

  /**
   * 接收一笔交易
   * @param {number} price - 价格 (USD)
   * @param {number} ts    - 毫秒时间戳
   * @param {number} volumeUsd
   */
  onTrade(price, ts, volumeUsd = 0) {
    if (!Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(ts)) ts = Date.now();

    const bucketTs = this._bucketStart(ts);

    if (!this._current) {
      this._current = this._newBar(price, bucketTs, volumeUsd);
      return;
    }

    if (bucketTs > this._current.ts) {
      // 跨桶 - 把上一根作为已收盘的推入历史
      this._closeCurrent();

      // 中间空缺的K线用上一根 close 价填充 (避免指标计算断档)
      const gap = (bucketTs - this._current?.ts - this.intervalMs) / this.intervalMs;
      const lastClose = this.bars[this.bars.length - 1]?.close ?? price;
      for (let i = 0; i < gap && i < 10; i++) {
        const fillTs = this.bars[this.bars.length - 1].ts + this.intervalMs;
        const filler = this._newBar(lastClose, fillTs, 0);
        this.bars.push(filler);
        this.emit('bar_close', filler);
      }

      this._current = this._newBar(price, bucketTs, volumeUsd);
      return;
    }

    // 同一桶内更新
    if (price > this._current.high) this._current.high = price;
    if (price < this._current.low) this._current.low = price;
    this._current.close = price;
    this._current.volume += volumeUsd;
    this.emit('bar_update', this._current);
  }

  /** 强制关闭当前K线（用于定时器驱动） */
  tick(now = Date.now()) {
    if (!this._current) return;
    const bucketTs = this._bucketStart(now);
    if (bucketTs > this._current.ts) {
      this._closeCurrent();
      // 用最后 close 填充空K线
      while (this.bars[this.bars.length - 1].ts + this.intervalMs < bucketTs) {
        const ts = this.bars[this.bars.length - 1].ts + this.intervalMs;
        const lastClose = this.bars[this.bars.length - 1].close;
        const filler = this._newBar(lastClose, ts, 0);
        this.bars.push(filler);
        this.emit('bar_close', filler);
      }
      // 开新桶（无 trade，先用上一 close 占位）
      const lastClose = this.bars[this.bars.length - 1].close;
      this._current = this._newBar(lastClose, bucketTs, 0);
    }
  }

  _closeCurrent() {
    if (!this._current) return;
    this.bars.push(this._current);
    if (this.bars.length > this.maxBars) {
      this.bars.splice(0, this.bars.length - this.maxBars);
    }
    this.emit('bar_close', this._current);
  }

  _newBar(price, ts, vol) {
    return {
      ts,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: vol,
    };
  }

  /** 用历史K线初始化（首次加载用） */
  bootstrap(historyBars) {
    this.bars = historyBars.slice(-this.maxBars);
  }

  getCloses() {
    return this.bars.map(b => b.close);
  }

  getLatest() {
    return this._current || this.bars[this.bars.length - 1] || null;
  }
}
