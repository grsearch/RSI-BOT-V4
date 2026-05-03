/** @type {import('next').NextConfig} */

// Next.js server 端转发地址（默认 localhost:3001 因为前后端在同一台机器）
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // 浏览器请求 /api/* → Next.js server 转发到后端
      // 这样浏览器看到的是同源请求，不会有 CORS / 跨主机问题
      {
        source: '/api/:path*',
        destination: `${BACKEND}/api/:path*`,
      },
      {
        source: '/webhook/:path*',
        destination: `${BACKEND}/webhook/:path*`,
      },
      // WebSocket 转发
      {
        source: '/ws',
        destination: `${BACKEND}/ws`,
      },
    ];
  },
};

export default nextConfig;
