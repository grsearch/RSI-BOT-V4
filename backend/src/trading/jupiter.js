import axios from 'axios';
import {
  VersionedTransaction,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionMessage,
} from '@solana/web3.js';
import bs58 from 'bs58';
import pRetry from 'p-retry';
import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';
import { connection, getPriorityFee, confirmTransaction } from './helius.js';

const log = child('jupiter');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

const jupClient = axios.create({
  timeout: 15000,
  headers: config.jupiter.apiKey
    ? { 'x-api-key': config.jupiter.apiKey }
    : {},
});

const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pivKeVGUiyrfrPwa9MzJ',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

function randomTipAccount() {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

/**
 * 获取 quote
 * @param {string} inputMint
 * @param {string} outputMint
 * @param {bigint|string} amount  - lamports 或 token 最小单位
 * @param {number} slippageBps
 */
export async function getQuote(inputMint, outputMint, amount, slippageBps) {
  const params = {
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps,
    swapMode: 'ExactIn',
    onlyDirectRoutes: false,
    asLegacyTransaction: false,
    maxAccounts: 64,
  };
  const { data } = await jupClient.get(config.jupiter.quoteUrl, { params });
  return data;
}

/**
 * 构造 swap 交易
 * 关键参数:
 *  - prioritizationFeeLamports.jitoTipLamports: 启用 Jito bundle
 *  - dynamicComputeUnitLimit: 自动估算 CU
 *  - dynamicSlippage: 自动调整滑点（已通过 slippageBps 控制）
 */
export async function buildSwapTx(quoteResponse, userPubkey, jitoTipLamports) {
  const body = {
    quoteResponse,
    userPublicKey: userPubkey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      jitoTipLamports: jitoTipLamports.toString(),
    },
  };
  const { data } = await jupClient.post(config.jupiter.swapUrl, body);
  return data;
}

/**
 * 通过 Jito Block Engine 发送 bundle
 * Bundle: [swap_tx]   (Jito tip 已嵌入 swap_tx 中通过 prioritizationFeeLamports.jitoTipLamports)
 */
async function sendJitoBundle(serializedTxBase64) {
  const url = `${config.jito.blockEngineUrl}/api/v1/bundles`;
  try {
    const { data } = await axios.post(
      url,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[serializedTxBase64], { encoding: 'base64' }],
      },
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
    );
    if (data.error) {
      log.warn({ error: data.error }, 'Jito bundle 错误');
      return null;
    }
    return data.result; // bundle id
  } catch (e) {
    log.warn({ err: e.message }, 'Jito bundle 失败');
    return null;
  }
}

/**
 * 签名并发送
 * 策略: 同时发送 Jito bundle + 普通 RPC, 哪个先确认用哪个
 */
async function signAndSend(swapTx) {
  const wallet = config.wallet;

  const txBuf = Buffer.from(swapTx.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);

  const signature = bs58.encode(tx.signatures[0]);
  const serialized = Buffer.from(tx.serialize()).toString('base64');
  const serializedRaw = tx.serialize();

  // 并行: Jito bundle (主) + 普通 RPC (备)
  const tasks = [];

  // Jito
  tasks.push(sendJitoBundle(serialized));

  // 普通 RPC
  tasks.push(
    connection
      .sendRawTransaction(serializedRaw, {
        skipPreflight: true,
        maxRetries: 0,
        preflightCommitment: 'processed',
      })
      .catch(e => {
        log.debug({ err: e.message }, 'RPC sendRawTx 失败');
        return null;
      })
  );

  await Promise.allSettled(tasks);

  log.info({ signature }, '交易已提交，等待确认');
  const result = await confirmTransaction(signature);
  return { signature, ...result };
}

/**
 * 买入: SOL → token
 */
export async function buy({ mint, solAmount, slippageBps, retryAttempt = 0 }) {
  const lamports = BigInt(Math.floor(solAmount * 1e9));
  const userPubkey = config.walletPubkey;

  log.info(
    { mint: mint.slice(0, 6), solAmount, slippageBps, retry: retryAttempt },
    '🟢 BUY 开始'
  );

  return pRetry(
    async attempt => {
      try {
        const quote = await getQuote(SOL_MINT, mint, lamports, slippageBps);
        if (!quote || !quote.outAmount) {
          throw new Error('quote 为空');
        }

        const expectedOut = Number(quote.outAmount);
        const priceImpact = parseFloat(quote.priceImpactPct || '0') * 100;
        log.debug({ outAmount: expectedOut, priceImpactPct: priceImpact }, 'quote OK');

        // 价格冲击保护 (防夹/防陷阱)
        if (priceImpact > 30) {
          throw new Error(`price impact 过高: ${priceImpact.toFixed(2)}%`);
        }

        const swapTx = await buildSwapTx(quote, userPubkey, config.jito.tipLamports);

        const result = await signAndSend(swapTx);

        if (!result.confirmed) {
          throw new Error(`未确认: ${result.error || 'unknown'}`);
        }

        return {
          success: true,
          signature: result.signature,
          inputAmount: solAmount,
          outputAmount: expectedOut,
          slippageBps,
          priceImpactPct: priceImpact,
        };
      } catch (e) {
        log.warn({ mint: mint.slice(0, 6), attempt, err: e.message }, 'BUY 尝试失败');
        throw e;
      }
    },
    { retries: 0, minTimeout: 1000 } // 我们自己控制重试
  ).catch(err => ({ success: false, error: err.message }));
}

/**
 * 卖出: token → SOL
 */
export async function sell({ mint, tokenAmountRaw, slippageBps, retryAttempt = 0 }) {
  const userPubkey = config.walletPubkey;

  log.info(
    {
      mint: mint.slice(0, 6),
      tokenAmount: tokenAmountRaw.toString(),
      slippageBps,
      retry: retryAttempt,
    },
    '🔴 SELL 开始'
  );

  return pRetry(
    async attempt => {
      try {
        const quote = await getQuote(mint, SOL_MINT, tokenAmountRaw, slippageBps);
        if (!quote || !quote.outAmount) {
          throw new Error('quote 为空');
        }

        const solOut = Number(quote.outAmount) / 1e9;
        const priceImpact = parseFloat(quote.priceImpactPct || '0') * 100;
        log.debug({ solOut, priceImpactPct: priceImpact }, 'sell quote OK');

        const swapTx = await buildSwapTx(quote, userPubkey, config.jito.tipLamports);
        const result = await signAndSend(swapTx);

        if (!result.confirmed) {
          throw new Error(`未确认: ${result.error || 'unknown'}`);
        }

        return {
          success: true,
          signature: result.signature,
          inputAmountRaw: tokenAmountRaw.toString(),
          outputSol: solOut,
          slippageBps,
          priceImpactPct: priceImpact,
        };
      } catch (e) {
        log.warn({ mint: mint.slice(0, 6), attempt, err: e.message }, 'SELL 尝试失败');
        throw e;
      }
    },
    { retries: 0, minTimeout: 1000 }
  ).catch(err => ({ success: false, error: err.message }));
}

/**
 * 完整买入流程 - 带重试和滑点递增
 */
export async function executeBuy({ mint, solAmount, symbol }) {
  if (!config.trade.live) {
    log.warn({ mint }, '实盘已关闭，跳过');
    return { success: false, error: 'LIVE_TRADING=false' };
  }

  const slippages = [
    config.trade.defaultSlippageBps,
    Math.floor((config.trade.defaultSlippageBps + config.trade.buyRetryMaxSlippageBps) / 2),
    config.trade.buyRetryMaxSlippageBps,
  ];

  for (let i = 0; i < Math.min(config.trade.maxRetry, slippages.length); i++) {
    const slip = slippages[i];
    const r = await buy({ mint, solAmount, slippageBps: slip, retryAttempt: i });
    if (r.success) return r;
    log.warn({ mint: mint.slice(0, 6), attempt: i + 1, slip, err: r.error }, '买入失败，重试');
    await new Promise(r => setTimeout(r, 1500));
  }

  return { success: false, error: '所有重试均失败' };
}

/**
 * 完整卖出流程
 */
export async function executeSell({ mint, tokenAmountRaw, symbol }) {
  if (!config.trade.live) {
    log.warn({ mint }, '实盘已关闭，跳过');
    return { success: false, error: 'LIVE_TRADING=false' };
  }

  const slippages = [
    config.trade.defaultSlippageBps,
    Math.floor((config.trade.defaultSlippageBps + config.trade.sellRetryMaxSlippageBps) / 2),
    config.trade.sellRetryMaxSlippageBps,
  ];

  for (let i = 0; i < Math.min(config.trade.maxRetry, slippages.length); i++) {
    const slip = slippages[i];
    const r = await sell({ mint, tokenAmountRaw, slippageBps: slip, retryAttempt: i });
    if (r.success) return r;
    log.warn({ mint: mint.slice(0, 6), attempt: i + 1, slip, err: r.error }, '卖出失败，重试');
    await new Promise(r => setTimeout(r, 1500));
  }

  return { success: false, error: '所有重试均失败' };
}
