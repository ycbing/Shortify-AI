"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { StoryboardPanel } from "@/components/drama/storyboard-panel";
import { Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import Link from "next/link";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜" },
  { number: 4, title: "预览" },
];

interface StoryboardItem {
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  narration: string;
}

export default function StoryboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dramaId = searchParams.get("dramaId");

  const [items, setItems] = useState<StoryboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const fetchEpisodes = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setItems(
          data.episodes.map((ep: { episodeNumber: number; title: string; imageUrl: string | null; narrationText: string }) => ({
            episodeNumber: ep.episodeNumber,
            title: ep.title || `第${ep.episodeNumber}集`,
            imageUrl: ep.imageUrl
              ? ep.imageUrl.includes(".cos.") && ep.imageUrl.startsWith("http")
                ? (() => { try { const u = new URL(ep.imageUrl); return `/api/uploads/cos/${encodeURIComponent(u.pathname.slice(1))}`; } catch { return ep.imageUrl; } })()
                : ep.imageUrl.startsWith("http")
                ? ep.imageUrl
                : `/api/uploads/${ep.imageUrl.replace(/^\.?\/?uploads\/?/, "")}`
              : null,
            narration: ep.narrationText || "",
          }))
        );
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => {
    if (!dramaId) {
      router.push("/create");
      return;
    }
    fetchEpisodes();
  }, [dramaId]);

  const handleGenerateAll = async () => {
    if (!dramaId) return;
    setGenerating(true);
    setError("");

    try {
      const res = await fetch("/api/generate/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "生成失败");
        return;
      }

      await fetchEpisodes();
    } catch {
      setError("分镜生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async (episodeNumber: number) => {
    if (!dramaId) return;
    const ep = items.find((i) => i.episodeNumber === episodeNumber);
    if (!ep) return;

    try {
      const res = await fetch("/api/generate/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId, episodeId: ep.episodeNumber }),
      });

      if (res.ok) {
        await fetchEpisodes();
      }
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-16">
          <StepIndicator currentStep={3} steps={steps} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-2">AI 分镜 🎨</h1>
            <p className="text-muted-foreground">AI 为每集生成的画面</p>
          </div>
          <Button
            onClick={handleGenerateAll}
            disabled={generating}
            className="bg-emerald-600 hover:bg-emerald-500"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : items.every((i) => i.imageUrl) ? (
              "重新生成全部"
            ) : (
              "生成全部分镜"
            )}
          </Button>
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-400 bg-red-500/10 rounded p-3">{error}</div>
        )}

        {generating && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-emerald-400">正在生成分镜...</p>
                <p className="text-xs text-muted-foreground">
                  每张图片需要 10-20 秒，请耐心等待
                </p>
              </div>
            </div>
          </div>
        )}

        <StoryboardPanel
          items={items}
          onRegenerate={handleRegenerate}
          loading={generating}
        />

        <div className="flex justify-between mt-8">
          <Link href={`/create/script?dramaId=${dramaId}`}>
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              上一步
            </Button>
          </Link>
          <Link href={`/create/preview?dramaId=${dramaId}`}>
            <Button className="bg-emerald-600 hover:bg-emerald-500">
              下一步：预览
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
