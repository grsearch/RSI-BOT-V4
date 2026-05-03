'use client';

import { useState } from 'react';
import { apiDelete } from '@/lib/api';
import {
  fmtPrice, fmtUsd, fmtPct, fmtAge, fmtMint, rsiColor,
} from '@/lib/format';

interface Token {
  mint: string;
  symbol?: string;
  name?: string;
  price?: number;
  fdvUsd?: number;
  lpUsd?: number;
  volume24hUsd?: number;
  ageSeconds?: number;
  rsi?: number;
  prevRsi?: number;
  ema?: number;
  emaSlope?: number;
  buyVolume?: number;
  sellVolume?: number;
  barsCount?: number;
  status?: string;
  xMentions?: number;
  position?: any;
  last_signal?: string;
  last_reason?: string;
}

interface Props {
  tokens: Token[];
  total: number;
  onChange?: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  WATCHING: 'bg-bg-hover text-text-secondary',
  HOLDING: 'bg-accent-green/15 text-accent-green border border-accent-green/30',
  BUYING: 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30',
  SELLING: 'bg-accent-amber/15 text-accent-amber border border-accent-amber/30',
};

export function TokenTable({ tokens, total, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const filtered = tokens.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.mint.toLowerCase().includes(q) ||
      (t.symbol || '').toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const display = filtered.slice(start, start + pageSize);

  async function handleRemove(mint: string) {
    if (!confirm(`确定移除监控？如有持仓将先平仓。`)) return;
    try {
      await apiDelete(`/api/tokens/${mint}`);
      onChange?.();
    } catch (e: any) {
      alert(`移除失败: ${e.message}`);
    }
  }

  function copy(s: string) {
    navigator.clipboard?.writeText(s);
  }

  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-bg-border flex items-center gap-3">
        <div className="text-sm font-medium">实时行情</div>
        <div className="text-[11px] text-text-muted">
          监控中 {total} / 100
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索 mint / symbol..."
          className="w-56 bg-bg-card border border-bg-border rounded-md px-3 py-1.5 text-xs placeholder-text-muted focus:outline-none focus:border-accent-blue/40 transition-colors"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-card/50 border-b border-bg-border">
            <tr className="text-[10px] text-text-muted uppercase tracking-wider">
              <th className="px-4 py-2.5 text-left font-medium">代币</th>
              <th className="px-3 py-2.5 text-left font-medium">合约</th>
              <th className="px-3 py-2.5 text-right font-medium">价格</th>
              <th className="px-3 py-2.5 text-right font-medium">FDV</th>
              <th className="px-3 py-2.5 text-right font-medium">LP</th>
              <th className="px-3 py-2.5 text-right font-medium">24h Vol</th>
              <th className="px-3 py-2.5 text-right font-medium">Age</th>
              <th className="px-3 py-2.5 text-right font-medium">RSI</th>
              <th className="px-3 py-2.5 text-right font-medium">前RSI</th>
              <th className="px-3 py-2.5 text-right font-medium">EMA99</th>
              <th className="px-3 py-2.5 text-right font-medium">斜率</th>
              <th className="px-3 py-2.5 text-right font-medium">买压</th>
              <th className="px-3 py-2.5 text-right font-medium">卖压</th>
              <th className="px-3 py-2.5 text-right font-medium">K线</th>
              <th className="px-3 py-2.5 text-center font-medium">信号</th>
              <th className="px-3 py-2.5 text-center font-medium">状态</th>
              <th className="px-3 py-2.5 text-center font-medium w-12">操作</th>
            </tr>
          </thead>
          <tbody>
            {display.length === 0 && (
              <tr>
                <td colSpan={17} className="px-4 py-12 text-center text-text-muted text-xs">
                  暂无监控代币 - 输入合约地址开始监控
                </td>
              </tr>
            )}
            {display.map(t => {
              const status = t.status || 'WATCHING';
              const buyP = t.buyVolume || 0;
              const sellP = t.sellVolume || 0;
              const dom = buyP + sellP;
              const buyRatio = dom > 0 ? (buyP / dom) * 100 : 50;
              return (
                <tr key={t.mint} className="row-hover border-b border-bg-border/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[13px]">{t.symbol || '?'}</div>
                    {t.xMentions && t.xMentions > 0 && (
                      <div className="text-[10px] text-text-muted mt-0.5">𝕏 {t.xMentions}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => copy(t.mint)}
                      title={t.mint}
                      className="font-mono-tnum text-[11px] text-text-secondary hover:text-accent-blue transition-colors"
                    >
                      {fmtMint(t.mint, 4, 4)}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[12px]">{fmtPrice(t.price)}</td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[12px] text-text-secondary">{fmtUsd(t.fdvUsd)}</td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[12px] text-text-secondary">{fmtUsd(t.lpUsd)}</td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[12px] text-text-secondary">{fmtUsd(t.volume24hUsd)}</td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[11px] text-text-muted">{fmtAge(t.ageSeconds)}</td>
                  <td className={`px-3 py-3 text-right font-mono-tnum text-[12px] font-medium ${rsiColor(t.rsi ?? null)}`}>
                    {t.rsi != null ? t.rsi.toFixed(1) : '-'}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono-tnum text-[11px] ${rsiColor(t.prevRsi ?? null)} opacity-70`}>
                    {t.prevRsi != null ? t.prevRsi.toFixed(1) : '-'}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[11px] text-text-secondary">
                    {t.ema != null ? t.ema.toFixed(8) : '-'}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono-tnum text-[11px] ${
                    t.emaSlope == null ? 'text-text-muted' :
                    t.emaSlope >= 0 ? 'text-accent-green' : 'text-accent-red'
                  }`}>
                    {t.emaSlope != null ? `${t.emaSlope >= 0 ? '+' : ''}${t.emaSlope.toFixed(2)}%` : '-'}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[11px]">
                    <div className="text-accent-green">{fmtUsd(buyP)}</div>
                    <div className="w-full h-0.5 bg-bg-border rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full bg-accent-green"
                        style={{ width: `${buyRatio}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[11px]">
                    <div className="text-accent-red">{fmtUsd(sellP)}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tnum text-[11px] text-text-muted">{t.barsCount || 0}</td>
                  <td className="px-3 py-3 text-center">
                    {t.last_signal ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        t.last_signal === 'BUY' ? 'bg-accent-green/15 text-accent-green' :
                        'bg-accent-red/15 text-accent-red'
                      }`}>
                        {t.last_signal}
                      </span>
                    ) : <span className="text-text-muted text-[10px]">-</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_STYLE[status] || STATUS_STYLE.WATCHING}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => handleRemove(t.mint)}
                      className="text-text-muted hover:text-accent-red transition-colors text-base leading-none"
                      title="移除监控"
                    >
                      ×
                    </button>
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
            共 {filtered.length} 条，第 {page} / {totalPages} 页
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
