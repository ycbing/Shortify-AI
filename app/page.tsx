"use client";

import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { Sparkles, PenTool, Image, Mic, Film, ArrowRight, Heart, Clock } from "lucide-react";
import { useState, useEffect, Suspense } from "react";

const features = [
  {
    icon: PenTool,
    title: "AI 智能编剧",
    desc: "输入创意主题，AI 自动生成完整剧本，每集都有悬念和反转",
  },
  {
    icon: Image,
    title: "AI 分镜生成",
    desc: "自动为每集生成高质量分镜图片，支持多种画风选择",
  },
  {
    icon: Mic,
    title: "AI 智能配音",
    desc: "自动为旁白生成自然流畅的中文语音，情感表达丰富",
  },
  {
    icon: Film,
    title: "一键视频合成",
    desc: "自动将图片、配音合成为视频，支持导出完整合集",
  },
];

const templates = [
  { title: "深夜加班", genre: "mystery", genreLabel: "悬疑", style: "cyberpunk", styleLabel: "赛博朋克", theme: "程序员发现公司AI有了自我意识", emoji: "🔍", desc: "程序员发现公司AI有了自我意识" },
  { title: "校园回忆", genre: "romance", genreLabel: "爱情", style: "anime", styleLabel: "动漫", theme: "十年后的同学会上意外重逢", emoji: "💕", desc: "十年后的同学会上意外重逢" },
  { title: "合租奇遇", genre: "comedy", genreLabel: "喜剧", style: "realistic", styleLabel: "写实", theme: "性格迥异的四个人的爆笑生活", emoji: "😂", desc: "性格迥异的四个人的爆笑生活" },
];

const genreLabels: Record<string, string> = {
  mystery: "悬疑", romance: "爱情", comedy: "喜剧", scifi: "科幻", horror: "恐怖", fantasy: "奇幻",
};

function HotWorks() {
  const [works, setWorks] = useState<Array<{
    id: string; title: string; genre: string | null; style: string | null;
    episodeCount: number | null; coverUrl: string | null; shareCount: number | null; createdAt: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/gallery?page=1&pageSize=3")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setWorks(data.dramas || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-border/50 rounded-xl overflow-hidden">
            <div className="aspect-video bg-muted animate-pulse" />
            <div className="p-3 space-y-2"><div className="h-4 bg-muted rounded animate-pulse w-3/4" /><div className="h-3 bg-muted rounded animate-pulse w-1/2" /></div>
          </div>
        ))}
      </div>
    );
  }

  if (works.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
      {works.map((w) => (
        <Link
          key={w.id}
          href={`/view/${w.id}`}
          className="border border-border/50 rounded-xl overflow-hidden bg-card/30 hover:border-emerald-500/30 hover:bg-card/50 transition-all group"
        >
          <div className="aspect-video bg-muted overflow-hidden">
            {w.coverUrl ? (
              <img src={w.coverUrl} alt={w.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                <Film className="h-8 w-8 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="p-3 sm:p-4">
            <h3 className="font-semibold text-sm truncate mb-1 group-hover:text-emerald-400 transition">{w.title}</h3>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{w.episodeCount || 0} 集</span>
              <div className="flex items-center gap-2">
                {(w.shareCount ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><Heart className="h-3 w-3" />{w.shareCount}</span>}
                <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{new Date(w.createdAt).toLocaleDateString("zh-CN")}</span>
              </div>
            </div>
            {w.genre && (
              <span className="mt-2 inline-block text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded">
                {genreLabels[w.genre] || w.genre}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <Header />

      {/* Hero — mobile-optimized text sizes */}
      <section className="relative pt-24 sm:pt-32 pb-16 sm:pb-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-dark" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-transparent to-transparent" />

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 sm:px-4 py-1.5 text-xs sm:text-sm text-emerald-400 mb-6 sm:mb-8">
            <Sparkles className="h-3.5 w-3.5" />
            AI 驱动的短剧创作平台
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold tracking-tight mb-4 sm:mb-6">
            用 AI 创作短剧
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent text-[1.75rem] sm:text-4xl lg:text-5xl xl:text-6xl">
              从创意到成片只需 5 分钟
            </span>
          </h1>

          <p className="text-sm sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            告别繁琐的拍摄流程。输入你的创意，AI 帮你写剧本、画分镜、配配音、合成视频。
            <br className="hidden sm:block" />
            每个人都可以成为导演。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link href="/create" className="w-full sm:w-auto">
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-500 text-base px-8 w-full sm:w-auto min-h-[44px]">
                <Sparkles className="h-4 w-4 mr-2" />
                开始创作
              </Button>
            </Link>
            <Link href="#features" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="text-base px-8 w-full sm:w-auto min-h-[44px]">
                了解更多
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features — 2-col on mobile, 4-col on desktop */}
      <section id="features" className="py-16 sm:py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-xl sm:text-3xl font-bold mb-3 sm:mb-4">四大核心功能</h2>
            <p className="text-sm sm:text-base text-muted-foreground">一站式 AI 短剧创作工作流</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="border border-border/50 rounded-xl p-4 sm:p-6 bg-card/30 hover:border-emerald-500/30 hover:bg-card/50 transition-all group"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-emerald-500/20 transition">
                  <feature.icon className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400" />
                </div>
                <h3 className="font-semibold text-sm sm:text-base mb-1 sm:mb-2">{feature.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Templates — 1-col on mobile, 3-col on sm+ */}
      <section className="py-16 sm:py-20 px-4 bg-muted/20">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-xl sm:text-3xl font-bold mb-3 sm:mb-4">试试这些模板</h2>
            <p className="text-sm sm:text-base text-muted-foreground">选一个灵感，开始你的创作</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {templates.map((t) => (
              <Link
                key={t.title}
                href={`/create?theme=${encodeURIComponent(t.theme)}&genre=${t.genre}&style=${t.style}`}
                className="border border-border/50 rounded-xl p-4 sm:p-5 bg-card/30 hover:border-emerald-500/30 hover:bg-card/50 transition-all group cursor-pointer"
              >
                <span className="text-2xl sm:text-3xl mb-2 sm:mb-3 block">{t.emoji}</span>
                <h3 className="font-semibold text-sm sm:text-base mb-1">{t.title}</h3>
                <p className="text-xs sm:text-sm text-emerald-400 mb-1 sm:mb-2">{t.genreLabel}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">{t.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Hot Works — loaded from API */}
      <section id="hot-works" className="py-16 sm:py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-xl sm:text-3xl font-bold mb-3 sm:mb-4">🔥 热门作品</h2>
            <p className="text-sm sm:text-base text-muted-foreground">来自创作者们的 AI 短剧</p>
          </div>
          <HotWorks />
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-20 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-xl sm:text-3xl font-bold mb-3 sm:mb-4">准备好开始了吗？</h2>
          <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8">
            注册即送 200 个积分，免费体验 AI 短剧创作
          </p>
          <Link href="/sign-up">
            <Button size="lg" className="bg-emerald-600 hover:bg-emerald-500 text-base px-8 min-h-[44px]">
              免费注册
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
