'use client';

import { fmtPct, fmtSol, pnlColor } from '@/lib/format';

interface Stats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnlPct: number;
  avgWin: number;
  profitFactor: number;
}

interface Props {
  stats?: Stats;
}

export function StatsBar({ stats }: Props) {
  const s = stats || {
    total: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnl: 0,
    avgPnlPct: 0,
    avgWin: 0,
    profitFactor: 0,
  };

  const cards = [
    { label: '总交易', value: s.total, color: 'text-text-primary' },
    { label: '盈利', value: s.wins, color: 'text-accent-green' },
    { label: '亏损', value: s.losses, color: 'text-accent-red' },
    {
      label: '胜率',
      value: `${s.winRate.toFixed(1)}%`,
      color: s.winRate >= 50 ? 'text-accent-green' : 'text-accent-red',
    },
    {
      label: '总PnL (SOL)',
      value: fmtSol(s.totalPnl),
      color: pnlColor(s.totalPnl),
      mono: true,
    },
    {
      label: '平均PnL%',
      value: fmtPct(s.avgPnlPct),
      color: pnlColor(s.avgPnlPct),
      mono: true,
    },
    {
      label: '平均赢利%',
      value: fmtPct(s.avgWin),
      color: 'text-accent-green',
      mono: true,
    },
    {
      label: '盈亏比',
      value: s.profitFactor.toFixed(2),
      color: s.profitFactor >= 1 ? 'text-accent-green' : 'text-accent-red',
      mono: true,
    },
  ];

  return (
    <div className="px-6 py-4">
      <div className="text-xs text-text-secondary mb-2.5 tracking-wider uppercase">
        24小时统计
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {cards.map(c => (
          <div
            key={c.label}
            className="bg-bg-card border border-bg-border rounded-lg p-3.5 hover:border-bg-hover transition-colors"
          >
            <div className={`text-2xl font-semibold ${c.color} ${c.mono ? 'font-mono-tnum' : ''}`}>
              {c.value}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
