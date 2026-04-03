"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { StoryboardPanel } from "@/components/drama/storyboard-panel";
import { Loader2, ArrowRight, ArrowLeft, Image } from "lucide-react";
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
  const [generatingIndex, setGeneratingIndex] = useState(-1);
  const [error, setError] = useState("");
  const progressRef = useRef<HTMLDivElement>(null);

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

    // Generate episode by episode to show progress
    const episodesToGenerate = items.filter((i) => !i.imageUrl);
    const allEpisodes = items.length > 0 ? items : await (async () => {
      // If items is empty, fetch them first
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        return data.episodes.map((ep: { episodeNumber: number; title: string; imageUrl: string | null; narrationText: string }) => ({
          episodeNumber: ep.episodeNumber,
          title: ep.title || `第${ep.episodeNumber}集`,
          imageUrl: ep.imageUrl,
          narration: ep.narrationText || "",
        }));
      }
      return [];
    })();

    if (episodesToGenerate.length === 0 && allEpisodes.length > 0) {
      // Regenerate all
      try {
        const res = await fetch("/api/generate/storyboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dramaId }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "生成失败");
          setGenerating(false);
          return;
        }
        await fetchEpisodes();
      } catch {
        setError("分镜生成失败");
      } finally {
        setGenerating(false);
        setGeneratingIndex(-1);
      }
      return;
    }

    // Generate one by one for progress tracking
    for (let i = 0; i < allEpisodes.length; i++) {
      if (episodesToGenerate.length > 0 && allEpisodes[i].imageUrl) continue;

      setGeneratingIndex(i);
      try {
        const res = await fetch("/api/generate/storyboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dramaId, episodeId: allEpisodes[i].episodeNumber }),
        });
        if (!res.ok) {
          setError(`第 ${allEpisodes[i].episodeNumber} 集分镜生成失败`);
          break;
        }
      } catch {
        setError(`第 ${allEpisodes[i].episodeNumber} 集分镜生成失败`);
        break;
      }
    }

    await fetchEpisodes();
    setGenerating(false);
    setGeneratingIndex(-1);
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

  const totalCount = items.length || 3;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-14 sm:h-16">
          <StepIndicator currentStep={3} steps={steps} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {/* Step hint */}
        <div className="mb-6 sm:mb-8 p-3 sm:p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-xs sm:text-sm text-emerald-400">
            🎨 点击生成分镜图片，为每个镜头创建画面
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-8 gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold mb-1">AI 分镜 🎨</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">AI 为每集生成的画面</p>
          </div>
          <Button
            onClick={handleGenerateAll}
            disabled={generating}
            className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px] w-full sm:w-auto"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中 {generatingIndex >= 0 ? `(${generatingIndex + 1}/${totalCount})` : ""}...
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

        {/* Progress bar during generation */}
        {generating && (
          <div className="mb-6 p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
                <Image className="h-4 w-4 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-400">
                  正在生成第 {generatingIndex >= 0 ? generatingIndex + 1 : "?"} / {totalCount} 集分镜
                </p>
                <p className="text-xs text-muted-foreground">
                  每张图片需要 10-20 秒
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-emerald-500/20 rounded-full h-1.5 overflow-hidden">
              <div
                ref={progressRef}
                className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${generatingIndex >= 0 ? ((generatingIndex + 1) / totalCount) * 100 : 5}%`,
                }}
              />
            </div>
          </div>
        )}

        <StoryboardPanel
          items={items}
          onRegenerate={handleRegenerate}
          loading={generating}
        />

        <div className="flex flex-col sm:flex-row justify-between gap-3 mt-8">
          <Link href={`/create/script?dramaId=${dramaId}`}>
            <Button variant="outline" className="w-full sm:w-auto min-h-[44px]">
              <ArrowLeft className="h-4 w-4 mr-2" />
              上一步
            </Button>
          </Link>
          <Link href={`/create/preview?dramaId=${dramaId}`}>
            <Button className="bg-emerald-600 hover:bg-emerald-500 w-full sm:w-auto min-h-[44px]">
              下一步：预览
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
