'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';

interface Props {
  onAdded?: () => void;
}

export function AddTokenForm({ onAdded }: Props) {
  const [mint, setMint] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!mint.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await apiPost('/api/tokens', { mint: mint.trim(), symbol: name.trim() || undefined });
      setMint('');
      setName('');
      onAdded?.();
    } catch (e: any) {
      setErr(e.message || '添加失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-6 pt-2 pb-3">
      <div className="flex gap-2">
        <input
          value={mint}
          onChange={e => setMint(e.target.value)}
          placeholder="输入代币合约地址"
          className="flex-1 bg-bg-card border border-bg-border rounded-md px-3.5 py-2.5 text-sm font-mono-tnum placeholder-text-muted focus:outline-none focus:border-accent-blue/50 focus:bg-bg-panel transition-colors"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="代币名称(可选)"
          className="w-40 bg-bg-card border border-bg-border rounded-md px-3.5 py-2.5 text-sm placeholder-text-muted focus:outline-none focus:border-accent-blue/50 focus:bg-bg-panel transition-colors"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <button
          onClick={submit}
          disabled={loading || !mint.trim()}
          className="px-5 py-2.5 rounded-md bg-accent-green/10 hover:bg-accent-green/20 disabled:opacity-40 disabled:cursor-not-allowed text-accent-green text-sm font-medium border border-accent-green/30 transition-all"
        >
          {loading ? '添加中...' : '+ 添加'}
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-accent-red">{err}</div>}
    </div>
  );
}
