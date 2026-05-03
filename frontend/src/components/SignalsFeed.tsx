'use client';

import { fmtPrice, fmtMint, fmtTime } from '@/lib/format';

interface Signal {
  id: number;
  mint: string;
  symbol?: string;
  type: string;
  seq?: number;
  price?: number;
  reason?: string;
  rsi?: number;
  prev_rsi?: number;
  ema_slope?: number;
  ts: number;
}

interface Props {
  signals: Signal[];
}

export function SignalsFeed({ signals }: Props) {
  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl overflow-hidden h-full flex flex-col">
      <div className="px-5 py-3.5 border-b border-bg-border flex items-center gap-2">
        <span className="live-dot" />
        <div className="text-sm font-medium ml-2">信号流</div>
        <div className="text-[11px] text-text-muted ml-1">
          ({signals.length})
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[600px]">
        {signals.length === 0 && (
          <div className="px-5 py-12 text-center text-text-muted text-xs">
            暂无信号
          </div>
        )}
        {signals.map(s => {
          const isBuy = s.type === 'BUY_SIGNAL';
          const isSell = s.type === 'SELL_SIGNAL';
          const isForce = s.type === 'FORCE_EXIT' || s.type === 'SHUTDOWN';
          const accent = isBuy
            ? 'text-accent-green'
            : isSell
            ? 'text-accent-red'
            : 'text-accent-amber';
          const bg = isBuy
            ? 'bg-accent-green/5'
            : isSell
            ? 'bg-accent-red/5'
            : 'bg-accent-amber/5';
          const tag = isBuy ? 'BUY' : isSell ? 'SELL' : '强制';

          return (
            <div
              key={s.id}
              className={`px-5 py-3 border-b border-bg-border/40 ${bg} hover:bg-bg-hover/30 transition-colors animate-slide-in`}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${accent} ${
                    isBuy
                      ? 'bg-accent-green/15'
                      : isSell
                      ? 'bg-accent-red/15'
                      : 'bg-accent-amber/15'
                  }`}
                >
                  {tag}
                </span>
                <span className="text-[13px] font-medium">{s.symbol || fmtMint(s.mint, 4, 4)}</span>
                {s.seq && s.seq > 1 && (
                  <span className="text-[10px] text-text-muted">#{s.seq}</span>
                )}
                <div className="flex-1" />
                <span className="text-[10px] text-text-muted font-mono-tnum">{fmtTime(s.ts)}</span>
              </div>

              <div className="flex items-baseline gap-3 mt-1.5 text-[11px]">
                <span className="font-mono-tnum text-text-secondary">
                  ${fmtPrice(s.price)}
                </span>
                {s.rsi != null && (
                  <span className={`font-mono-tnum ${accent}`}>
                    RSI {s.prev_rsi?.toFixed(1)}→{s.rsi.toFixed(1)}
                  </span>
                )}
                {s.ema_slope != null && (
                  <span className="font-mono-tnum text-text-muted">
                    斜率 {s.ema_slope >= 0 ? '+' : ''}{s.ema_slope.toFixed(2)}%
                  </span>
                )}
              </div>

              {s.reason && (
                <div className="text-[10px] text-text-muted mt-1 truncate font-mono-tnum">
                  {s.reason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
