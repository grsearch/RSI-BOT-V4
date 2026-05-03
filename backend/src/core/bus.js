import { EventEmitter } from 'node:events';

/**
 * 全局事件总线
 *
 * 事件类型:
 *   token:added       { mint, symbol }
 *   token:removed     { mint, reason }
 *   token:metrics     { mint, price, fdvUsd, lpUsd, volume24hUsd, ageSeconds }
 *   trade:received    { mint, price, ts, volumeUsd, side: 'buy'|'sell' }
 *   bar:close         { mint, bar }
 *   bar:update        { mint, bar }
 *   indicators:update { mint, rsi, prevRsi, ema99, emaSlope }
 *   signal:buy        { mint, price, reason }
 *   signal:sell       { mint, price, reason, exitReason }
 *   trade:executed    { mint, side, success, ... }
 *   stats:update      { ... }
 */
export const bus = new EventEmitter();
bus.setMaxListeners(200);
