// BASE 默认空字符串 —— 浏览器会用同源协议+主机名+端口
// 配合 Next.js rewrites（next.config.mjs），/api/* 会被转发到后端 localhost:3001
// 这样浏览器从任何 IP/域名 访问都能正常工作（不再绑定 localhost）
const BASE = process.env.NEXT_PUBLIC_API_BASE || '';

export async function apiGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const fetcher = (path: string) => apiGet(path);

// WebSocket - 用浏览器当前同源地址（同样配合 Next rewrites）
export function connectWs(onMessage: (msg: any) => void): WebSocket {
  // 优先用 NEXT_PUBLIC_WS_BASE，否则同源
  const wsBase = process.env.NEXT_PUBLIC_WS_BASE
    || (typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
      : 'ws://localhost:3000');
  const ws = new WebSocket(`${wsBase}/ws`);
  ws.onmessage = e => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  return ws;
}
