import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shortify AI - AI短剧创作平台 | 从创意到成片只需5分钟",
  description: "Shortify AI 是一站式 AI 短剧创作平台。输入创意，AI 自动生成剧本、分镜、配音和视频。支持悬疑、爱情、喜剧等多种类型，零门槛成为导演。",
  openGraph: {
    title: "Shortify AI - AI短剧创作平台",
    description: "输入创意，AI 自动生成剧本、分镜、配音和视频。零门槛成为导演。",
    type: "website",
    locale: "zh_CN",
  },
  keywords: ["AI短剧", "短剧创作", "AI编剧", "AI分镜", "AI配音", "视频创作"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark scroll-smooth">
      <body className="min-h-screen bg-background antialiased">
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
