import { child } from '../utils/logger.js';
import { bus } from '../core/bus.js';

const log = child('ws');

const clients = new Set();

export function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const c of clients) {
    try {
      if (c.readyState === 1) c.send(msg);
    } catch {}
  }
}

export function registerWs(app) {
  app.get('/ws', { websocket: true }, conn => {
    const sock = conn.socket || conn;
    clients.add(sock);
    log.info(`WS 客户端连接，当前 ${clients.size}`);

    sock.on('close', () => {
      clients.delete(sock);
      log.info(`WS 客户端断开，剩余 ${clients.size}`);
    });

    sock.on('error', err => {
      log.warn({ err: err.message }, 'WS 错误');
    });

    // 心跳
    sock.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
  });

  // 转发关键事件到WS
  bus.on('signal:buy', d => broadcast('signal:buy', d));
  bus.on('signal:sell', d => broadcast('signal:sell', d));
  bus.on('trade:executed', d => broadcast('trade:executed', d));
  bus.on('token:added', d => broadcast('token:added', d));
  bus.on('token:removed', d => broadcast('token:removed', d));

  log.info('WebSocket 已注册');
}

// 定时推送整体状态
let pushTimer = null;
export function startStatePush() {
  pushTimer = setInterval(() => {
    broadcast('heartbeat', { ts: Date.now() });
  }, 5000);
}
