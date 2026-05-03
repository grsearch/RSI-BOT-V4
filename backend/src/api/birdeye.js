import axios from 'axios';
import WebSocket from 'ws';
import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { bus } from '../core/bus.js';

const log = child('birdeye');

const restClient = axios.create({
  baseURL: config.birdeye.restUrl,
  timeout: 15000,
  headers: {
    'x-api-key': config.birdeye.apiKey,
    'x-chain': 'solana',
    accept: 'application/json',
  },
});

/** 获取代币基本信息 */
export async function getTokenOverview(mint) {
  try {
    const { data } = await restClient.get('/defi/token_overview', {
      params: { address: mint },
    });
    if (!data?.success) return null;
    const d = data.data || {};
    return {
      mint,
      symbol: d.symbol,
      name: d.name,
      price: d.price,
      fdvUsd: d.fdv ?? d.mc,
      lpUsd: d.liquidity,
      volume24hUsd: d.v24hUSD ?? d.volume24h,
      ageSeconds: d.createdAt ? Math.floor((Date.now() - d.createdAt) / 1000) : null,
      decimals: d.decimals,
    };
  } catch (e) {
    log.warn({ mint, err: e.message }, '获取token overview失败');
    return null;
  }
}

/** 获取历史K线 - 用于初始化指标 */
export async function getHistoryOHLCV(mint, intervalSec = 300, limit = 200) {
  const typeMap = { 60: '1m', 300: '5m', 900: '15m', 1800: '30m', 3600: '1H' };
  const type = typeMap[intervalSec] || '5m';
  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - intervalSec * limit;
  try {
    const { data } = await restClient.get('/defi/ohlcv', {
      params: {
        address: mint,
        type,
        time_from: timeFrom,
        time_to: timeTo,
      },
    });
    if (!data?.success) return [];
    const items = data.data?.items || [];
    return items.map(b => ({
      ts: b.unixTime * 1000,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v ?? 0,
    }));
  } catch (e) {
    log.warn({ mint, err: e.message }, '获取历史OHLCV失败');
    return [];
  }
}

/**
 * Birdeye 实时价格 WSS
 * 文档: wss://public-api.birdeye.so/socket/solana?x-api-key=...
 * 协议: 发送 {type: 'SUBSCRIBE_PRICE', data: {chartType, address, currency}}
 *      接收 {type: 'PRICE_DATA', data: {o,h,l,c,v,unixTime,address,...}}
 */
export class BirdeyeWSS {
  constructor() {
    this.ws = null;
    this.subs = new Set(); // 已订阅的 mint
    this.pendingSubs = new Set();
    this.reconnectDelay = 1000;
    this.alive = false;
    this.heartbeatTimer = null;
  }

  connect() {
    const url = `${config.birdeye.wssUrl}?x-api-key=${config.birdeye.apiKey}`;
    log.info('连接 Birdeye WSS...');

    this.ws = new WebSocket(url, 'echo-protocol', {
      headers: {
        Origin: 'ws://public-api.birdeye.so',
        'Sec-WebSocket-Origin': 'ws://public-api.birdeye.so',
      },
    });

    this.ws.on('open', () => {
      log.info('✓ Birdeye WSS 已连接');
      this.alive = true;
      this.reconnectDelay = 1000;

      // 重新订阅
      const all = [...this.subs, ...this.pendingSubs];
      this.subs.clear();
      this.pendingSubs.clear();
      for (const mint of all) this.subscribePriceTrades(mint);

      // 心跳
      this._startHeartbeat();
    });

    this.ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        this._onMessage(msg);
      } catch (e) {
        log.warn({ err: e.message }, '解析消息失败');
      }
    });

    this.ws.on('close', () => {
      log.warn('Birdeye WSS 已断开');
      this.alive = false;
      this._stopHeartbeat();
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    });

    this.ws.on('error', err => {
      log.error({ err: err.message }, 'Birdeye WSS 错误');
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.ping(); } catch {}
      }
    }, 30000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  _onMessage(msg) {
    const type = msg.type;
    if (type === 'PRICE_DATA' || type === 'price_data') {
      const d = msg.data || {};
      const mint = d.address;
      if (!mint) return;
      bus.emit('trade:received', {
        mint,
        price: Number(d.c ?? d.price),
        ts: (d.unixTime || Math.floor(Date.now() / 1000)) * 1000,
        volumeUsd: Number(d.v ?? 0),
      });
    } else if (type === 'TXS_DATA' || type === 'txs_data') {
      const d = msg.data || {};
      const mint = d.address;
      if (!mint) return;
      const side = d.side === 'sell' ? 'sell' : 'buy';
      bus.emit('trade:received', {
        mint,
        price: Number(d.priceInUsd ?? d.price),
        ts: (d.blockUnixTime || Math.floor(Date.now() / 1000)) * 1000,
        volumeUsd: Number(d.volumeInUsd ?? 0),
        side,
      });
    }
  }

  /** 订阅价格 + trades */
  subscribePriceTrades(mint) {
    if (this.subs.has(mint)) return;

    if (!this.alive) {
      this.pendingSubs.add(mint);
      return;
    }

    // 订阅价格(用于K线)
    this._send({
      type: 'SUBSCRIBE_PRICE',
      data: {
        chartType: '5m',
        currency: 'usd',
        address: mint,
      },
    });

    // 订阅 txs (用于买卖压)
    this._send({
      type: 'SUBSCRIBE_TXS',
      data: { queryType: 'simple', address: mint },
    });

    this.subs.add(mint);
    log.debug({ mint }, '订阅成功');
  }

  unsubscribe(mint) {
    if (!this.subs.has(mint)) return;
    this._send({ type: 'UNSUBSCRIBE_PRICE', data: { address: mint } });
    this._send({ type: 'UNSUBSCRIBE_TXS', data: { address: mint } });
    this.subs.delete(mint);
    log.debug({ mint }, '取消订阅');
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

export const birdeyeWss = new BirdeyeWSS();
