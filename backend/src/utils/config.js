import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function num(name, defaultVal) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultVal;
  return Number(v);
}

function bool(name, defaultVal = false) {
  const v = process.env[name];
  if (v === undefined) return defaultVal;
  return v.toLowerCase() === 'true';
}

// 解析 ${VAR} 引用
function resolve(str) {
  return str.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || '');
}

let wallet = null;
if (process.env.WALLET_PRIVATE_KEY) {
  try {
    const secret = bs58.decode(process.env.WALLET_PRIVATE_KEY);
    wallet = Keypair.fromSecretKey(secret);
  } catch (e) {
    console.error('[config] Invalid WALLET_PRIVATE_KEY:', e.message);
  }
}

export const config = {
  wallet,
  walletPubkey: wallet?.publicKey?.toBase58() || null,

  helius: {
    apiKey: process.env.HELIUS_API_KEY || '',
    rpcUrl: resolve(process.env.HELIUS_RPC_URL || ''),
    wssUrl: resolve(process.env.HELIUS_WSS_URL || ''),
    laserstreamUrl: process.env.HELIUS_LASERSTREAM_URL || '',
  },

  birdeye: {
    apiKey: process.env.BIRDEYE_API_KEY || '',
    wssUrl: process.env.BIRDEYE_WSS_URL || 'wss://public-api.birdeye.so/socket/solana',
    restUrl: 'https://public-api.birdeye.so',
  },

  jupiter: {
    apiKey: process.env.JUPITER_API_KEY || '',
    quoteUrl: process.env.JUPITER_QUOTE_URL || 'https://api.jup.ag/swap/v1/quote',
    swapUrl: process.env.JUPITER_SWAP_URL || 'https://api.jup.ag/swap/v1/swap',
  },

  jito: {
    blockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf',
    tipLamports: num('JITO_TIP_LAMPORTS', 100000),
  },

  trade: {
    amountSol: num('TRADE_AMOUNT_SOL', 2),
    defaultSlippageBps: num('DEFAULT_SLIPPAGE_BPS', 300),
    buyRetryMaxSlippageBps: num('BUY_RETRY_MAX_SLIPPAGE_BPS', 500),
    sellRetryMaxSlippageBps: num('SELL_RETRY_MAX_SLIPPAGE_BPS', 1000),
    maxRetry: num('MAX_RETRY', 3),
    live: bool('LIVE_TRADING', true),
  },

  strategy: {
    klineIntervalSec: num('KLINE_INTERVAL_SEC', 300),
    rsiPeriod: num('RSI_PERIOD', 7),
    rsiBuyThreshold: num('RSI_BUY_THRESHOLD', 35),
    rsiSellHigh: num('RSI_SELL_HIGH', 80),
    rsiSellCrossDown: num('RSI_SELL_CROSS_DOWN', 70),
    emaPeriod: num('EMA_PERIOD', 99),
    emaSlopeLookback: num('EMA_SLOPE_LOOKBACK', 5),
    takeProfitPct: num('TAKE_PROFIT_PCT', 100),
    stopLossPct: num('STOP_LOSS_PCT', -50),
    trailingActivatePct: num('TRAILING_ACTIVATE_PCT', 30),
    trailingDropPct: num('TRAILING_DROP_PCT', -20),
    sellCooldownSec: num('SELL_COOLDOWN_SEC', 1800),
  },

  pool: {
    maxTokens: num('MAX_TOKENS', 100),
    minFdvUsd: num('MIN_FDV_USD', 30000),
    minLpUsd: num('MIN_LP_USD', 10000),
  },

  server: {
    port: num('PORT', 3001),
    logLevel: process.env.LOG_LEVEL || 'info',
    dbPath: process.env.DB_PATH || './data/bot.db',
  },
};

export function checkConfig() {
  const missing = [];
  if (!config.wallet) missing.push('WALLET_PRIVATE_KEY');
  if (!config.helius.apiKey) missing.push('HELIUS_API_KEY');
  if (!config.birdeye.apiKey) missing.push('BIRDEYE_API_KEY');
  if (missing.length) {
    console.error('[config] ⚠️  Missing required env:', missing.join(', '));
    console.error('[config] 请编辑 .env 文件后重启');
    return false;
  }
  return true;
}
