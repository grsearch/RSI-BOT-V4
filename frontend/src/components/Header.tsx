'use client';

import { fmtMint } from '@/lib/format';

interface Props {
  walletAddress?: string;
  live: boolean;
  connected: boolean;
  tokenCount: number;
  tradeCount: number;
  signalCount: number;
}

export function Header({ walletAddress, live, connected, tokenCount, tradeCount, signalCount }: Props) {
  return (
    <header className="border-b border-bg-border bg-bg-panel/40 backdrop-blur sticky top-0 z-30">
      <div className="px-6 h-14 flex items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center text-sm font-bold">
            S
          </div>
          <div>
            <div className="text-[15px] font-semibold leading-tight">SOL RSI+量能</div>
            <div className="text-[10px] text-text-muted leading-tight">V4 实盘</div>
          </div>
        </div>

        {/* 状态徽章 */}
        <div className="flex items-center gap-2 ml-4">
          {live ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-red/10 text-accent-red text-[11px] font-medium border border-accent-red/20">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse-soft" />
              实盘模式
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-bg-hover text-text-muted text-[11px]">
              虚拟盘
            </span>
          )}

          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium ${
            connected
              ? 'bg-accent-green/10 text-accent-green border border-accent-green/20'
              : 'bg-bg-hover text-text-muted'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-accent-green' : 'bg-text-muted'}`} />
            {connected ? '已连接' : '未连接'}
          </span>

          <span className="px-2.5 py-1 rounded-md bg-bg-hover text-text-secondary text-[11px] font-mono-tnum">
            {tokenCount} 代币
          </span>

          <span className="px-2.5 py-1 rounded-md bg-bg-hover text-text-secondary text-[11px] font-mono-tnum">
            {tradeCount} 笔 · {signalCount} 信号
          </span>
        </div>

        <div className="flex-1" />

        {/* 钱包 */}
        {walletAddress && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-bg-hover border border-bg-border">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span className="text-xs font-mono-tnum text-text-secondary">
              {fmtMint(walletAddress, 6, 6)}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
