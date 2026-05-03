import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config, checkConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { tokenManager } from './core/tokenManager.js';
import { executor } from './trading/executor.js';
import { birdeyeWss } from './api/birdeye.js';
import { registerRoutes } from './routes/api.js';
import { registerWs, startStatePush } from './routes/ws.js';
import { closeDb, startWalCheckpoint } from './core/db.js';

const log = logger.child({ module: 'main' });

async function main() {
  log.info('━'.repeat(60));
  log.info('  SOL RSI+量能 自动交易机器人 V4');
  log.info('━'.repeat(60));

  if (!checkConfig()) {
    log.error('配置不完整，启动失败。请编辑 .env 文件');
    process.exit(1);
  }

  log.info({ wallet: config.walletPubkey, live: config.trade.live }, '配置已加载');
  if (!config.trade.live) {
    log.warn('⚠️  实盘交易已关闭 (LIVE_TRADING=false)');
  }

  // ============ Fastify ============
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024 * 4,
  });

  await app.register(cors, { origin: '*' });
  await app.register(websocket);

  await registerRoutes(app);
  registerWs(app);

  // ============ 启动核心服务 ============
  birdeyeWss.connect();
  tokenManager.start();
  executor.start();
  startStatePush();
  startWalCheckpoint();

  // ============ 启动 HTTP ============
  await app.listen({ host: '0.0.0.0', port: config.server.port });
  log.info(`✓ HTTP 服务已启动: http://0.0.0.0:${config.server.port}`);
  log.info(`✓ Webhook: POST http://你的IP:${config.server.port}/webhook/new-token`);
  log.info('━'.repeat(60));

  // ============ 优雅退出 ============
  let shuttingDown = false;
  async function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`收到 ${sig}，开始优雅退出...`);

    // 1. 关闭 HTTP server (停止接收新请求)
    try {
      await app.close();
      log.info('✓ HTTP 已关闭');
    } catch (e) {
      log.warn({ err: e.message }, 'HTTP 关闭异常');
    }

    // 2. 等待执行队列清空 (最多10秒)
    const maxWait = 10_000;
    const start = Date.now();
    while (executor.queue.size + executor.queue.pending > 0 && Date.now() - start < maxWait) {
      log.info(`等待 ${executor.queue.size + executor.queue.pending} 笔交易完成...`);
      await new Promise(r => setTimeout(r, 1000));
    }

    // 3. 关闭 WSS 连接
    try {
      birdeyeWss.ws?.close();
    } catch {}

    // 4. 数据库安全关闭 (WAL checkpoint + close)
    closeDb();

    log.info('✓ 已退出');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 未捕获异常 - 不退出，记录后继续
  process.on('uncaughtException', err => {
    log.error({ err: err.message, stack: err.stack }, '未捕获异常');
  });
  process.on('unhandledRejection', err => {
    log.error({ err: err?.message || err }, '未处理 promise');
  });
}

main().catch(err => {
  log.error({ err: err.message, stack: err.stack }, '启动失败');
  process.exit(1);
});
