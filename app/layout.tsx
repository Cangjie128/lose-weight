import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "我的减肥计划 | 每日行动教练",
  description: "从今天吃什么、怎么动开始。可执行的每周饮食、运动与恢复计划，保留完整照片和备份。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
