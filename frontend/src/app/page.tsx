'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetcher, connectWs } from '@/lib/api';
import { Header } from '@/components/Header';
import { StatsBar } from '@/components/StatsBar';
import { AddTokenForm } from '@/components/AddTokenForm';
import { TokenTable } from '@/components/TokenTable';
import { SignalsFeed } from '@/components/SignalsFeed';
import { TradesTable } from '@/components/TradesTable';
import { BacktestPanel } from '@/components/BacktestPanel';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'monitor' | 'trades' | 'backtest'>('monitor');
  const [wsConnected, setWsConnected] = useState(false);

  const { data: stats, mutate: refetchStats } = useSWR('/api/stats', fetcher, {
    refreshInterval: 5000,
  });
  const { data: tokensData, mutate: refetchTokens } = useSWR(
    '/api/tokens?pageSize=100',
    fetcher,
    { refreshInterval: 3000 }
  );
  const { data: signalsData, mutate: refetchSignals } = useSWR(
    '/api/signals?limit=100',
    fetcher,
    { refreshInterval: 4000 }
  );
  const { data: tradesData, mutate: refetchTrades } = useSWR(
    '/api/trades?limit=500',
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: configData } = useSWR('/api/config', fetcher);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    function connect() {
      try {
        ws = connectWs(msg => {
          if (
            msg.type === 'signal:buy' ||
            msg.type === 'signal:sell' ||
            msg.type === 'trade:executed' ||
            msg.type === 'token:added' ||
            msg.type === 'token:removed'
          ) {
            refetchTokens();
            refetchSignals();
            refetchTrades();
            refetchStats();
          }
        });
        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connect, 3000);
        };
      } catch {}
    }
    connect();
    return () => {
      ws?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const tokens = tokensData?.items || [];
  const signals = signalsData?.items || [];
  const trades = tradesData?.items || [];

  return (
    <div className="min-h-screen bg-bg-base">
      <Header
        walletAddress={stats?.walletAddress}
        live={!!stats?.live}
        connected={wsConnected}
        tokenCount={stats?.tokensCount || 0}
        tradeCount={stats?.total || 0}
        signalCount={stats?.signalsToday || 0}
      />

      <StatsBar stats={stats} />

      <AddTokenForm onAdded={() => { refetchTokens(); refetchStats(); }} />

      {/* Tabs */}
      <div className="px-6 mt-1 mb-4 flex gap-1 border-b border-bg-border">
        {([
          ['monitor', '实时监控'],
          ['trades', '成交记录'],
          ['backtest', '策略回测'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setActiveTab(k)}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              activeTab === k
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-6 pb-8">
        {activeTab === 'monitor' && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
            <TokenTable
              tokens={tokens}
              total={stats?.tokensCount || 0}
              onChange={() => { refetchTokens(); refetchStats(); }}
            />
            <SignalsFeed signals={signals} />
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="space-y-4">
            <TradesTable trades={trades} />
          </div>
        )}

        {activeTab === 'backtest' && (
          <BacktestPanel defaultParams={configData?.strategy} />
        )}
      </div>

      <footer className="px-6 py-4 border-t border-bg-border text-[10px] text-text-muted flex items-center gap-4">
        <span>SOL RSI+量能 V4 · GMGN 标准</span>
        <span className="text-text-muted/60">·</span>
        <span>{configData?.strategy ? `${configData.strategy.klineIntervalSec / 60}min` : '-'} K线</span>
        <span className="text-text-muted/60">·</span>
        <span>RSI({configData?.strategy?.rsiPeriod ?? '-'}) + EMA{configData?.strategy?.emaPeriod ?? '-'}</span>
        <span className="text-text-muted/60">·</span>
        <span>每笔 {configData?.trade?.amountSol ?? '-'} SOL</span>
        <div className="flex-1" />
        <span>{new Date().toLocaleString('zh-CN')}</span>
      </footer>
    </div>
  );
}
