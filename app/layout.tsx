import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "温和减脂记录与指导",
  description: "中文每日减脂记录、趋势分析、餐食照片分析和 AI 教练建议工具。",
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
