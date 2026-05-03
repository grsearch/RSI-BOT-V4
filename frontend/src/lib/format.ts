export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  if (n === 0) return '0';
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);
  if (n >= 0.0001) return n.toFixed(7);
  return n.toFixed(8);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(digits)}%`;
}

export function fmtSol(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(digits)}`;
}

export function fmtAge(seconds: number | null | undefined): string {
  if (seconds == null) return '-';
  const days = seconds / 86400;
  if (days >= 1) return `${days.toFixed(1)}d`;
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const mins = seconds / 60;
  return `${mins.toFixed(0)}m`;
}

export function fmtMint(mint: string, head = 4, tail = 4): string {
  if (!mint) return '';
  if (mint.length <= head + tail + 3) return mint;
  return `${mint.slice(0, head)}...${mint.slice(-tail)}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d
    .getDate()
    .toString()
    .padStart(2, '0')} ${d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
}

export function rsiColor(rsi: number | null): string {
  if (rsi == null) return 'text-text-muted';
  if (rsi >= 80) return 'text-accent-red';
  if (rsi >= 70) return 'text-accent-amber';
  if (rsi <= 35) return 'text-accent-green';
  if (rsi <= 30) return 'text-accent-blue';
  return 'text-text-secondary';
}

export function pnlColor(n: number | null): string {
  if (n == null) return 'text-text-muted';
  if (n > 0) return 'text-accent-green';
  if (n < 0) return 'text-accent-red';
  return 'text-text-secondary';
}
