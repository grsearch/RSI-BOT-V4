import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';

const log = child('db');

mkdirSync(dirname(config.server.dbPath), { recursive: true });

export const db = new Database(config.server.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    symbol TEXT,
    name TEXT,
    price REAL,
    fdv_usd REAL,
    lp_usd REAL,
    volume_24h_usd REAL,
    age_seconds INTEGER,
    x_mentions INTEGER DEFAULT 0,
    rsi REAL,
    prev_rsi REAL,
    ema99 REAL,
    ema_slope REAL,
    buy_pressure REAL DEFAULT 0,
    sell_pressure REAL DEFAULT 0,
    last_signal TEXT,
    last_reason TEXT,
    bars_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'WATCHING',
    holding_amount REAL DEFAULT 0,
    avg_entry_price REAL,
    peak_price REAL,
    trailing_active INTEGER DEFAULT 0,
    last_sell_ts INTEGER DEFAULT 0,
    added_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_volume ON tokens(volume_24h_usd);
  CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    symbol TEXT,
    side TEXT NOT NULL,           -- BUY / SELL
    seq INTEGER DEFAULT 1,         -- 第几次买/卖
    price REAL,
    sol_amount REAL,                -- BUY: in / SELL: out
    token_amount REAL,
    pnl_sol REAL,
    pnl_pct REAL,
    reason TEXT,
    exit_reason TEXT,
    tx_signature TEXT,
    slippage_bps INTEGER,
    success INTEGER DEFAULT 1,
    error TEXT,
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(mint);
  CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);

  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    symbol TEXT,
    type TEXT NOT NULL,           -- BUY_SIGNAL / SELL_SIGNAL / SHUTDOWN / FORCE_EXIT
    seq INTEGER DEFAULT 1,
    price REAL,
    reason TEXT,
    rsi REAL,
    prev_rsi REAL,
    ema_slope REAL,
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts);

  CREATE TABLE IF NOT EXISTS bars (
    mint TEXT NOT NULL,
    ts INTEGER NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL,
    PRIMARY KEY (mint, ts)
  );

  CREATE INDEX IF NOT EXISTS idx_bars_mint_ts ON bars(mint, ts);

  CREATE TABLE IF NOT EXISTS positions (
    mint TEXT PRIMARY KEY,
    symbol TEXT,
    amount REAL NOT NULL,
    avg_price REAL NOT NULL,
    cost_sol REAL NOT NULL,
    peak_price REAL,
    trailing_active INTEGER DEFAULT 0,
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

log.info('SQLite 初始化完成: %s', config.server.dbPath);

/** 关闭数据库 - 确保 WAL 数据完全落盘 */
export function closeDb() {
  try {
    // checkpoint(TRUNCATE) 会把所有 WAL 内容写入主库并清空 WAL 文件
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    log.info('✓ 数据库已安全关闭，WAL 已落盘');
  } catch (e) {
    log.error({ err: e.message }, '关闭数据库失败');
  }
}

/** 定时 WAL checkpoint（防止 WAL 文件无限增长 + 增强崩溃容错） */
export function startWalCheckpoint() {
  setInterval(() => {
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch (e) {
      log.warn({ err: e.message }, 'WAL checkpoint 失败');
    }
  }, 60_000); // 每分钟一次
}

// ============ Token CRUD ============
export const Tokens = {
  upsert(t) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO tokens (mint, symbol, name, price, fdv_usd, lp_usd, volume_24h_usd, age_seconds, added_at, updated_at)
      VALUES (@mint, @symbol, @name, @price, @fdv_usd, @lp_usd, @volume_24h_usd, @age_seconds, @added_at, @updated_at)
      ON CONFLICT(mint) DO UPDATE SET
        symbol = COALESCE(excluded.symbol, tokens.symbol),
        name = COALESCE(excluded.name, tokens.name),
        price = COALESCE(excluded.price, tokens.price),
        fdv_usd = COALESCE(excluded.fdv_usd, tokens.fdv_usd),
        lp_usd = COALESCE(excluded.lp_usd, tokens.lp_usd),
        volume_24h_usd = COALESCE(excluded.volume_24h_usd, tokens.volume_24h_usd),
        age_seconds = COALESCE(excluded.age_seconds, tokens.age_seconds),
        updated_at = excluded.updated_at
    `);
    stmt.run({
      mint: t.mint,
      symbol: t.symbol || null,
      name: t.name || null,
      price: t.price ?? null,
      fdv_usd: t.fdvUsd ?? null,
      lp_usd: t.lpUsd ?? null,
      volume_24h_usd: t.volume24hUsd ?? null,
      age_seconds: t.ageSeconds ?? null,
      added_at: now,
      updated_at: now,
    });
  },

  updateMetrics(mint, m) {
    const stmt = db.prepare(`
      UPDATE tokens SET
        price = COALESCE(?, price),
        rsi = COALESCE(?, rsi),
        prev_rsi = COALESCE(?, prev_rsi),
        ema99 = COALESCE(?, ema99),
        ema_slope = COALESCE(?, ema_slope),
        buy_pressure = COALESCE(?, buy_pressure),
        sell_pressure = COALESCE(?, sell_pressure),
        bars_count = COALESCE(?, bars_count),
        last_signal = COALESCE(?, last_signal),
        last_reason = COALESCE(?, last_reason),
        status = COALESCE(?, status),
        updated_at = ?
      WHERE mint = ?
    `);
    stmt.run(
      m.price ?? null,
      m.rsi ?? null,
      m.prevRsi ?? null,
      m.ema99 ?? null,
      m.emaSlope ?? null,
      m.buyPressure ?? null,
      m.sellPressure ?? null,
      m.barsCount ?? null,
      m.lastSignal ?? null,
      m.lastReason ?? null,
      m.status ?? null,
      Date.now(),
      mint
    );
  },

  remove(mint) {
    db.prepare('DELETE FROM tokens WHERE mint = ?').run(mint);
  },

  get(mint) {
    return db.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint);
  },

  all() {
    return db.prepare('SELECT * FROM tokens ORDER BY x_mentions DESC, updated_at DESC').all();
  },

  count() {
    return db.prepare('SELECT COUNT(*) as c FROM tokens').get().c;
  },

  /** 找出24h volume最低的 N 个币 */
  lowestVolume(n) {
    return db
      .prepare(
        `SELECT mint, symbol, volume_24h_usd FROM tokens
         WHERE status != 'HOLDING'
         ORDER BY COALESCE(volume_24h_usd, 0) ASC LIMIT ?`
      )
      .all(n);
  },
};

// ============ Trades ============
export const Trades = {
  insert(t) {
    db.prepare(`
      INSERT INTO trades (mint, symbol, side, seq, price, sol_amount, token_amount,
                          pnl_sol, pnl_pct, reason, exit_reason, tx_signature, slippage_bps, success, error, ts)
      VALUES (@mint, @symbol, @side, @seq, @price, @solAmount, @tokenAmount,
              @pnlSol, @pnlPct, @reason, @exitReason, @txSignature, @slippageBps, @success, @error, @ts)
    `).run({
      mint: t.mint,
      symbol: t.symbol || null,
      side: t.side,
      seq: t.seq || 1,
      price: t.price ?? null,
      solAmount: t.solAmount ?? null,
      tokenAmount: t.tokenAmount ?? null,
      pnlSol: t.pnlSol ?? null,
      pnlPct: t.pnlPct ?? null,
      reason: t.reason || null,
      exitReason: t.exitReason || null,
      txSignature: t.txSignature || null,
      slippageBps: t.slippageBps ?? null,
      success: t.success === false ? 0 : 1,
      error: t.error || null,
      ts: t.ts || Date.now(),
    });
  },

  recent(limit = 200) {
    return db.prepare('SELECT * FROM trades ORDER BY ts DESC LIMIT ?').all(limit);
  },

  /** 用于策略状态恢复 - 获取某币的最后一次成功卖出时间和买/卖序号 */
  getStrategyState(mint) {
    const lastSell = db
      .prepare(
        `SELECT ts FROM trades WHERE mint = ? AND side = 'SELL' AND success = 1
         ORDER BY ts DESC LIMIT 1`
      )
      .get(mint);
    const buyCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM trades WHERE mint = ? AND side = 'BUY' AND success = 1`
      )
      .get(mint).c;
    const sellCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM trades WHERE mint = ? AND side = 'SELL' AND success = 1`
      )
      .get(mint).c;
    return {
      lastSellTs: lastSell?.ts || 0,
      buyCount,
      sellCount,
    };
  },

  /** 24h 统计 */
  stats24h() {
    const since = Date.now() - 86400_000;
    const rows = db
      .prepare(`SELECT side, pnl_sol, pnl_pct FROM trades WHERE ts > ? AND success = 1`)
      .all(since);

    const sells = rows.filter(r => r.side === 'SELL' && r.pnl_sol !== null);
    const total = sells.length;
    const wins = sells.filter(r => r.pnl_sol > 0).length;
    const losses = sells.filter(r => r.pnl_sol <= 0).length;
    const winRate = total ? (wins / total) * 100 : 0;
    const totalPnl = sells.reduce((s, r) => s + (r.pnl_sol || 0), 0);
    const avgPnlPct = total ? sells.reduce((s, r) => s + (r.pnl_pct || 0), 0) / total : 0;
    const winsArr = sells.filter(r => r.pnl_sol > 0);
    const lossesArr = sells.filter(r => r.pnl_sol <= 0);
    const avgWin = winsArr.length
      ? winsArr.reduce((s, r) => s + (r.pnl_pct || 0), 0) / winsArr.length
      : 0;
    const sumWin = winsArr.reduce((s, r) => s + (r.pnl_sol || 0), 0);
    const sumLoss = Math.abs(lossesArr.reduce((s, r) => s + (r.pnl_sol || 0), 0));
    const profitFactor = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? Infinity : 0);

    return {
      total,
      wins,
      losses,
      winRate,
      totalPnl,
      avgPnlPct,
      avgWin,
      profitFactor: profitFactor === Infinity ? 999 : profitFactor,
    };
  },
};

// ============ Signals ============
export const Signals = {
  insert(s) {
    db.prepare(`
      INSERT INTO signals (mint, symbol, type, seq, price, reason, rsi, prev_rsi, ema_slope, ts)
      VALUES (@mint, @symbol, @type, @seq, @price, @reason, @rsi, @prevRsi, @emaSlope, @ts)
    `).run({
      mint: s.mint,
      symbol: s.symbol || null,
      type: s.type,
      seq: s.seq || 1,
      price: s.price ?? null,
      reason: s.reason || null,
      rsi: s.rsi ?? null,
      prevRsi: s.prevRsi ?? null,
      emaSlope: s.emaSlope ?? null,
      ts: s.ts || Date.now(),
    });
  },

  recent(limit = 100) {
    return db.prepare('SELECT * FROM signals ORDER BY ts DESC LIMIT ?').all(limit);
  },

  count() {
    const since = Date.now() - 86400_000;
    return db.prepare('SELECT COUNT(*) as c FROM signals WHERE ts > ?').get(since).c;
  },
};

// ============ Positions ============
export const Positions = {
  upsert(p) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO positions (mint, symbol, amount, avg_price, cost_sol, peak_price, trailing_active, opened_at, updated_at)
      VALUES (@mint, @symbol, @amount, @avgPrice, @costSol, @peakPrice, @trailingActive, @openedAt, @updatedAt)
      ON CONFLICT(mint) DO UPDATE SET
        amount = excluded.amount,
        avg_price = excluded.avg_price,
        cost_sol = excluded.cost_sol,
        peak_price = excluded.peak_price,
        trailing_active = excluded.trailing_active,
        updated_at = excluded.updated_at
    `).run({
      mint: p.mint,
      symbol: p.symbol || null,
      amount: p.amount,
      avgPrice: p.avgPrice,
      costSol: p.costSol,
      peakPrice: p.peakPrice ?? p.avgPrice,
      trailingActive: p.trailingActive ? 1 : 0,
      openedAt: p.openedAt || now,
      updatedAt: now,
    });
  },

  get(mint) {
    return db.prepare('SELECT * FROM positions WHERE mint = ?').get(mint);
  },

  remove(mint) {
    db.prepare('DELETE FROM positions WHERE mint = ?').run(mint);
  },

  all() {
    return db.prepare('SELECT * FROM positions').all();
  },
};

// ============ Bars ============
export const Bars = {
  insert(mint, bar) {
    db.prepare(`
      INSERT OR REPLACE INTO bars (mint, ts, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mint, bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume);
  },

  recent(mint, limit = 200) {
    return db
      .prepare('SELECT * FROM bars WHERE mint = ? ORDER BY ts DESC LIMIT ?')
      .all(mint, limit)
      .reverse();
  },

  cleanup(daysToKeep = 7) {
    const cutoff = Date.now() - daysToKeep * 86400_000;
    db.prepare('DELETE FROM bars WHERE ts < ?').run(cutoff);
  },
};
