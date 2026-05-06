"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, Heart, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface GalleryDrama {
  id: string;
  title: string;
  genre: string | null;
  style: string | null;
  episodeCount: number | null;
  coverUrl: string | null;
  shareCount: number | null;
  createdAt: string;
}

const genreLabels: Record<string, string> = {
  mystery: "悬疑",
  romance: "爱情",
  comedy: "喜剧",
  scifi: "科幻",
  horror: "恐怖",
  fantasy: "奇幻",
  thriller: "惊悚",
  drama: "剧情",
};

export default function GalleryPage() {
  const [dramas, setDramas] = useState<GalleryDrama[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const pageSize = 12;

  const fetchDramas = async (p: number, append = false) => {
    try {
      const res = await fetch(`/api/gallery?page=${p}&pageSize=${pageSize}`);
      if (res.ok) {
        const data = await res.json();
        setDramas((prev) => (append ? [...prev, ...data.dramas] : data.dramas));
        setTotal(data.total);
        setHasMore(data.dramas.length === pageSize && data.page * data.pageSize < data.total);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDramas(1);
  }, []);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchDramas(nextPage, true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-14 sm:h-16">
          <div className="flex items-center gap-3">
            <Link href="/">
              <span className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                Shortify AI
              </span>
            </Link>
            <span className="text-xs text-muted-foreground hidden sm:inline">·</span>
            <span className="text-sm text-muted-foreground hidden sm:inline">作品广场</span>
          </div>
          <Link href="/create">
            <Button className="bg-emerald-600 hover:bg-emerald-500 min-h-[40px] text-sm">
              ✨ 开始创作
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-10">
        {/* Page header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-2">🎬 作品广场</h1>
          <p className="text-sm text-muted-foreground">
            发现 AI 创作的精彩短剧，点击观看完整作品
            {total > 0 && (
              <span className="ml-2">· 共 {total} 部作品</span>
            )}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border border-border/50 rounded-xl overflow-hidden">
                <Skeleton className="aspect-video w-full" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : dramas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-5xl mb-4">🎬</span>
            <h3 className="text-lg font-semibold mb-2">还没有公开作品</h3>
            <p className="text-sm text-muted-foreground mb-6">
              成为第一个创作者，让更多人看到你的 AI 短剧
            </p>
            <Link href="/create">
              <Button className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">
                ✨ 立即创作
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {dramas.map((drama) => (
                <Link
                  key={drama.id}
                  href={`/view/${drama.id}`}
                  className="group border border-border/50 rounded-xl overflow-hidden bg-card/50 hover:border-emerald-500/50 hover:bg-card/80 transition-all duration-300"
                >
                  {/* Cover */}
                  <div className="relative aspect-video bg-muted overflow-hidden">
                    {drama.coverUrl ? (
                      <img
                        src={drama.coverUrl}
                        alt={drama.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                        <Film className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                    )}
                    {/* Genre badge */}
                    {drama.genre && (
                      <span className="absolute top-2 left-2 text-xs backdrop-blur-md bg-black/50 px-2 py-0.5 rounded text-white">
                        {genreLabels[drama.genre] || drama.genre}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 sm:p-4">
                    <h3 className="font-semibold text-sm truncate mb-1 group-hover:text-emerald-400 transition">
                      {drama.title}
                    </h3>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{drama.episodeCount || 0} 集</span>
                      <div className="flex items-center gap-2">
                        {(drama.shareCount ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Heart className="h-3 w-3" />
                            {drama.shareCount}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                      </div>
                    </div>
                    {drama.style && (
                      <Badge variant="outline" className="mt-2 text-[10px]">
                        {drama.style}
                      </Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center mt-8">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  className="min-h-[44px] px-8"
                >
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
