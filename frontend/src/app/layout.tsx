import './globals.css';

export const metadata = {
  title: 'SOL RSI+量能 V4',
  description: 'SOL链自动交易机器人 Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
