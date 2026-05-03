'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { fmtPct, fmtMint, fmtDate, pnlColor } from '@/lib/format';

interface Props {
  defaultParams: any;
}

const PARAM_FIELDS: Array<{
  key: string;
  label: string;
  step?: number;
  hint?: string;
}> = [
  { key: 'klineSec', label: 'K线秒数', step: 60 },
  { key: 'rsiPeriod', label: 'RSI周期', step: 1 },
  { key: 'rsiBuyThreshold', label: 'RSI买入', step: 1, hint: '上穿' },
  { key: 'rsiSellHigh', label: 'RSI恐慌', step: 1, hint: '过热即卖' },
  { key: 'rsiSellCrossDown', label: 'RSI下穿', step: 1 },
  { key: 'emaPeriod', label: 'EMA周期', step: 1 },
  { key: 'emaSlopeLookback', label: '斜率回看', step: 1 },
  { key: 'takeProfitPct', label: '止盈%', step: 5 },
  { key: 'stopLossPct', label: '止损%', step: 5 },
  { key: 'trailingActivatePct', label: '移动激活%', step: 5 },
  { key: 'trailingDropPct', label: '移动回撤%', step: 5 },
  { key: 'sellCooldownSec', label: '卖后冷却(s)', step: 60 },
  { key: 'slippagePct', label: '滑点%', step: 0.5 },
];

export function BacktestPanel({ defaultParams }: Props) {
  const [params, setParams] = useState(() => ({
    klineSec: 300,
    rsiPeriod: 7,
    rsiBuyThreshold: 35,
    rsiSellHigh: 80,
    rsiSellCrossDown: 70,
    emaPeriod: 99,
    emaSlopeLookback: 5,
    takeProfitPct: 100,
    stopLossPct: -50,
    trailingActivatePct: 30,
    trailingDropPct: -20,
    sellCooldownSec: 1800,
    slippagePct: 1.5,
    ...(defaultParams || {}),
  }));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');

  function update(key: string, val: number) {
    setParams(p => ({ ...p, [key]: val }));
  }

  async function run() {
    setLoading(true);
    setErr('');
    setResult(null);
    try {
      const r = await apiPost('/api/backtest', params);
      setResult(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-bg-border flex items-center gap-2">
        <div className="text-sm font-medium">策略回测</div>
        <div className="text-[11px] text-text-muted">基于历史K线模拟</div>
        <div className="flex-1" />
        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-1.5 rounded-md bg-accent-blue/15 hover:bg-accent-blue/25 disabled:opacity-40 text-accent-blue text-xs font-medium border border-accent-blue/30 transition-all"
        >
          {loading ? '回测中...' : '运行回测'}
        </button>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {PARAM_FIELDS.map(f => (
            <div key={f.key}>
              <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wider">
                {f.label}
                {f.hint && <span className="ml-1 text-text-muted/60 normal-case">{f.hint}</span>}
              </label>
              <input
                type="number"
                step={f.step ?? 1}
                value={(params as any)[f.key] ?? ''}
                onChange={e => update(f.key, parseFloat(e.target.value) || 0)}
                className="w-full bg-bg-card border border-bg-border rounded-md px-2.5 py-1.5 text-xs font-mono-tnum focus:outline-none focus:border-accent-blue/40 transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      {err && (
        <div className="mx-5 mb-5 px-4 py-3 rounded-md bg-accent-red/10 border border-accent-red/20 text-accent-red text-xs">
          回测失败: {err}
        </div>
      )}

      {result && (
        <div className="border-t border-bg-border">
          {/* 总览 */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 p-5 bg-bg-card/30">
            <SumCell label="代币数" value={result.summary.tokensAnalyzed} />
            <SumCell label="交易笔数" value={result.summary.totalTrades} />
            <SumCell
              label="盈利/亏损"
              value={`${result.summary.wins}/${result.summary.losses}`}
            />
            <SumCell
              label="胜率"
              value={`${result.summary.winRate.toFixed(1)}%`}
              color={result.summary.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'}
            />
            <SumCell
              label="总PnL%"
              value={fmtPct(result.summary.totalPnlPct)}
              color={pnlColor(result.summary.totalPnlPct)}
            />
            <SumCell
              label="平均PnL%"
              value={fmtPct(result.summary.avgPnlPct)}
              color={pnlColor(result.summary.avgPnlPct)}
            />
            <SumCell
              label="盈亏比"
              value={result.summary.profitFactor.toFixed(2)}
              color={result.summary.profitFactor >= 1 ? 'text-accent-green' : 'text-accent-red'}
            />
          </div>

          {/* 按代币明细 */}
          {Object.keys(result.byToken).length > 0 && (
            <div className="border-t border-bg-border">
              <div className="px-5 py-2.5 text-[10px] text-text-muted uppercase tracking-wider">
                按代币分析
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-card/50 border-y border-bg-border">
                    <tr className="text-[10px] text-text-muted uppercase tracking-wider">
                      <th className="px-4 py-2 text-left font-medium">代币</th>
                      <th className="px-3 py-2 text-right font-medium">交易笔数</th>
                      <th className="px-3 py-2 text-right font-medium">盈利</th>
                      <th className="px-3 py-2 text-right font-medium">亏损</th>
                      <th className="px-3 py-2 text-right font-medium">总PnL%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.byToken).map(([mint, v]: any) => (
                      <tr key={mint} className="row-hover border-b border-bg-border/40">
                        <td className="px-4 py-2">
                          <div className="font-medium text-[12px]">{v.symbol || '?'}</div>
                          <div className="text-[10px] text-text-muted font-mono-tnum">
                            {fmtMint(mint, 4, 4)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tnum text-[12px]">{v.trades}</td>
                        <td className="px-3 py-2 text-right font-mono-tnum text-[12px] text-accent-green">{v.wins}</td>
                        <td className="px-3 py-2 text-right font-mono-tnum text-[12px] text-accent-red">{v.losses}</td>
                        <td className={`px-3 py-2 text-right font-mono-tnum text-[12px] font-medium ${pnlColor(v.totalPnlPct)}`}>
                          {fmtPct(v.totalPnlPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 部分交易明细 */}
          {result.trades && result.trades.length > 0 && (
            <div className="border-t border-bg-border">
              <div className="px-5 py-2.5 text-[10px] text-text-muted uppercase tracking-wider">
                交易明细 (前 {Math.min(20, result.trades.length)} 笔)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-card/50 border-y border-bg-border">
                    <tr className="text-[10px] text-text-muted uppercase tracking-wider">
                      <th className="px-4 py-2 text-left">代币</th>
                      <th className="px-3 py-2 text-right">买入价</th>
                      <th className="px-3 py-2 text-right">卖出价</th>
                      <th className="px-3 py-2 text-right">PnL%</th>
                      <th className="px-3 py-2 text-left">退出原因</th>
                      <th className="px-3 py-2 text-right">入场</th>
                      <th className="px-3 py-2 text-right">出场</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(0, 20).map((t: any, i: number) => (
                      <tr key={i} className="row-hover border-b border-bg-border/40">
                        <td className="px-4 py-2 text-[12px]">{t.symbol || fmtMint(t.mint, 4, 4)}</td>
                        <td className="px-3 py-2 text-right font-mono-tnum text-[11px]">
                          {t.entry?.toFixed(8)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tnum text-[11px]">
                          {t.exit?.toFixed(8)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono-tnum text-[12px] font-medium ${pnlColor(t.pnlPct)}`}>
                          {fmtPct(t.pnlPct)}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-text-muted font-mono-tnum">
                          {t.exitReason}
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] text-text-muted font-mono-tnum">
                          {fmtDate(t.entryTs)}
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] text-text-muted font-mono-tnum">
                          {fmtDate(t.exitTs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SumCell({
  label,
  value,
  color,
}: {
  label: string;
  value: any;
  color?: string;
}) {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-3">
      <div className={`text-lg font-semibold font-mono-tnum ${color || 'text-text-primary'}`}>
        {value}
      </div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
    </div>
  );
}
