'use client';

import { useState } from 'react';
import {
  fmtSol, fmtPct, fmtMint, fmtDate, pnlColor,
} from '@/lib/format';

interface Trade {
  id: number;
  mint: string;
  symbol?: string;
  side: 'BUY' | 'SELL';
  seq?: number;
  price?: number;
  sol_amount?: number;
  token_amount?: number;
  pnl_sol?: number;
  pnl_pct?: number;
  reason?: string;
  exit_reason?: string;
  tx_signature?: string;
  slippage_bps?: number;
  success: number;
  error?: string;
  ts: number;
}

interface Props {
  trades: Trade[];
}

export function TradesTable({ trades }: Props) {
  const [filter, setFilter] = useState<'all' | 'wins' | 'losses' | 'failed'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const filtered = trades.filter(t => {
    if (filter === 'wins') return t.success && t.pnl_sol != null && t.pnl_sol > 0;
    if (filter === 'losses') return t.success && t.pnl_sol != null && t.pnl_sol <= 0;
    if (filter === 'failed') return !t.success;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const display = filtered.slice(start, start + pageSize);

  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-bg-border flex items-center gap-3">
        <div className="text-sm font-medium">成交记录</div>
        <div className="text-[11px] text-text-muted">{filtered.length} 笔</div>
        <div className="flex-1" />
        <div className="flex gap-1">
          {([
            ['all', '全部'],
            ['wins', '盈利'],
            ['losses', '亏损'],
            ['failed', '失败'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setFilter(k); setPage(1); }}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                filter === k
                  ? 'bg-bg-hover text-text-primary border border-bg-border'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-card/50 border-b border-bg-border">
            <tr className="text-[10px] text-text-muted uppercase tracking-wider">
              <th className="px-4 py-2.5 text-left font-medium">代币</th>
              <th className="px-3 py-2.5 text-left font-medium">合约</th>
              <th className="px-3 py-2.5 text-center font-medium">方向</th>
              <th className="px-3 py-2.5 text-right font-medium">SOL</th>
              <th className="px-3 py-2.5 text-right font-medium">PnL</th>
              <th className="px-3 py-2.5 text-right font-medium">PnL%</th>
              <th className="px-3 py-2.5 text-left font-medium">原因</th>
              <th className="px-3 py-2.5 text-left font-medium">退出</th>
              <th className="px-3 py-2.5 text-right font-medium">滑点</th>
              <th className="px-3 py-2.5 text-left font-medium">Tx</th>
              <th className="px-3 py-2.5 text-right font-medium">时间</th>
            </tr>
          </thead>
          <tbody>
            {display.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-text-muted text-xs">
                  暂无交易记录
                </td>
              </tr>
            )}
            {display.map(t => {
              const failed = !t.success;
              return (
                <tr
                  key={t.id}
                  className={`row-hover border-b border-bg-border/40 ${
                    failed ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[13px]">{t.symbol || '?'}</div>
                    {t.seq && t.seq > 1 && (
                      <div className="text-[10px] text-text-muted">#{t.seq}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono-tnum text-[11px] text-text-secondary">
                      {fmtMint(t.mint, 4, 4)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                        t.side === 'BUY'
                          ? 'bg-accent-green/15 text-accent-green'
                          : 'bg-accent-red/15 text-accent-red'
                      }`}
                    >
                      {t.side}
                    </span>
                    {failed && (
                      <div className="text-[9px] text-accent-red mt-0.5">FAIL</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[12px]">
                    {t.sol_amount != null ? t.sol_amount.toFixed(4) : '-'}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono-tnum text-[12px] ${pnlColor(t.pnl_sol ?? null)}`}>
                    {t.pnl_sol != null ? fmtSol(t.pnl_sol) : '-'}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono-tnum text-[12px] font-medium ${pnlColor(t.pnl_pct ?? null)}`}>
                    {t.pnl_pct != null ? fmtPct(t.pnl_pct) : '-'}
                  </td>
                  <td className="px-3 py-3 max-w-[180px]">
                    <div className="text-[11px] text-text-secondary truncate font-mono-tnum" title={t.reason || ''}>
                      {t.reason || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-3 max-w-[120px]">
                    <div className="text-[11px] text-text-muted truncate" title={t.exit_reason || t.error || ''}>
                      {t.exit_reason || (failed ? t.error : '-')}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[11px] text-text-muted">
                    {t.slippage_bps ? `${(t.slippage_bps / 100).toFixed(1)}%` : '-'}
                  </td>
                  <td className="px-3 py-3">
                    {t.tx_signature ? (
                      <a
                        href={`https://solscan.io/tx/${t.tx_signature}`}
                        target="_blank"
                        rel="noopener"
                        className="font-mono-tnum text-[11px] text-accent-blue hover:text-accent-purple transition-colors"
                      >
                        {fmtMint(t.tx_signature, 4, 4)}
                      </a>
                    ) : (
                      <span className="text-text-muted text-[11px]">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-[10px] text-text-muted font-mono-tnum">
                    {fmtDate(t.ts)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-bg-border flex items-center justify-between text-xs">
          <div className="text-text-muted">
            第 {page} / {totalPages} 页
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded bg-bg-card border border-bg-border hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded bg-bg-card border border-bg-border hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
