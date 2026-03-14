
import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '宏量助手 - 智能饮食宏量记录',
  description: 'AI 驱动的蛋白质与碳水化合物摄入计算器，助您轻松管理健康饮食。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased selection:bg-accent/30">{children}</body>
    </html>
  );
}
