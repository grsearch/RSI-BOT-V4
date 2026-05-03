import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../utils/config.js';
import { child } from '../utils/logger.js';

const log = child('helius');

export const connection = new Connection(config.helius.rpcUrl, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

const heliusRpc = axios.create({
  baseURL: config.helius.rpcUrl,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

let rpcId = 1;

async function rpcCall(method, params) {
  try {
    const { data } = await heliusRpc.post('', {
      jsonrpc: '2.0',
      id: rpcId++,
      method,
      params,
    });
    if (data.error) {
      log.warn({ method, error: data.error }, 'RPC 错误');
      return null;
    }
    return data.result;
  } catch (e) {
    log.warn({ method, err: e.message }, 'RPC 失败');
    return null;
  }
}

/**
 * 获取动态优先费 (Helius getPriorityFeeEstimate)
 * 防夹关键: 用 high 级别的优先费保证抢到块
 */
export async function getPriorityFee(accountKeys = [], priorityLevel = 'High') {
  const result = await rpcCall('getPriorityFeeEstimate', [
    {
      accountKeys,
      options: { priorityLevel, includeAllPriorityFeeLevels: false },
    },
  ]);
  // 返回 microlamports/CU
  return Math.max(Math.ceil(result?.priorityFeeEstimate || 50000), 50000);
}

/** 获取代币账户余额 */
export async function getTokenBalance(walletPubkey, mint) {
  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(walletPubkey),
      { mint: new PublicKey(mint) }
    );
    if (!accounts.value.length) return { amount: 0, decimals: 0, uiAmount: 0 };
    const info = accounts.value[0].account.data.parsed.info.tokenAmount;
    return {
      amount: BigInt(info.amount),
      decimals: info.decimals,
      uiAmount: info.uiAmount || 0,
    };
  } catch (e) {
    log.warn({ mint, err: e.message }, '获取代币余额失败');
    return { amount: 0n, decimals: 0, uiAmount: 0 };
  }
}

/** 获取SOL余额 */
export async function getSolBalance(pubkey) {
  try {
    const lamports = await connection.getBalance(new PublicKey(pubkey));
    return lamports / 1e9;
  } catch (e) {
    log.warn({ err: e.message }, '获取SOL余额失败');
    return 0;
  }
}

/** 等待交易确认 */
export async function confirmTransaction(signature, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: false,
      });
      const conf = status.value?.confirmationStatus;
      const err = status.value?.err;
      if (err) return { confirmed: false, error: JSON.stringify(err) };
      if (conf === 'confirmed' || conf === 'finalized') return { confirmed: true };
    } catch (e) {
      log.debug({ err: e.message }, '查询状态失败，重试');
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { confirmed: false, error: 'timeout' };
}
