"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { VoiceoverPanel } from "@/components/drama/voiceover-panel";
import { VideoPreview } from "@/components/drama/video-preview";
import { ExportDialog } from "@/components/drama/export-dialog";
import { Loader2, ArrowLeft, Film } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜" },
  { number: 4, title: "预览" },
];

interface EpisodeData {
  id: string;
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  voiceoverUrl: string | null;
  videoUrl: string | null;
  duration: number | null;
}

export default function PreviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dramaId = searchParams.get("dramaId");

  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState("");
  const [error, setError] = useState("");

  const fetchEpisodes = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes);
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

  const handleGenerateAllVoiceovers = async () => {
    if (!dramaId) return;
    setLoadingAction("voiceover");

    try {
      const res = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });

      if (res.ok) {
        await fetchEpisodes();
      }
    } catch {
      setError("配音生成失败");
    } finally {
      setLoadingAction("");
    }
  };

  const handleGenerateSingleVoiceover = async (episodeNumber?: number) => {
    if (!dramaId) return;
    const ep = episodeNumber
      ? episodes.find((e) => e.episodeNumber === episodeNumber)
      : episodes.find((e) => !e.voiceoverUrl);

    if (!ep) return;

    setLoadingAction(`voiceover-${ep.episodeNumber}`);

    try {
      const res = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId, episodeId: ep.id }),
      });

      if (res.ok) {
        await fetchEpisodes();
      }
    } catch {
      // ignore
    } finally {
      setLoadingAction("");
    }
  };

  const handleComposeAll = async () => {
    if (!dramaId) return;
    setLoadingAction("compose");

    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mergedUrl) {
          setMergedVideoUrl(data.mergedUrl);
        }
        await fetchEpisodes();
      }
    } catch {
      setError("视频合成失败");
    } finally {
      setLoadingAction("");
    }
  };

  const handleExport = async (format: string, _resolution: string) => {
    if (!dramaId) return;

    try {
      const res = await fetch(`/api/dramas/${dramaId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });

      if (res.ok) {
        alert("导出成功！");
      }
    } catch {
      setError("导出失败");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  const voiceoverItems = episodes.map((ep) => ({
    episodeNumber: ep.episodeNumber,
    title: ep.title || `第${ep.episodeNumber}集`,
    voiceoverUrl: ep.voiceoverUrl,
    duration: ep.duration,
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-16">
          <StepIndicator currentStep={4} steps={steps} />
          <ExportDialog
            dramaId={dramaId!}
            episodeCount={episodes.length}
            onExport={handleExport}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">预览与导出 🎬</h1>
          <p className="text-muted-foreground">为你的短剧生成配音、合成视频</p>
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-400 bg-red-500/10 rounded p-3">{error}</div>
        )}

        {loadingAction && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
              <p className="text-sm text-emerald-400">
                {loadingAction === "voiceover"
                  ? "正在生成配音..."
                  : loadingAction === "compose"
                  ? "正在合成视频..."
                  : "处理中..."}
              </p>
            </div>
          </div>
        )}

        <Tabs defaultValue="preview" className="space-y-6">
          <TabsList className="bg-muted/30">
            <TabsTrigger value="preview">📹 视频预览</TabsTrigger>
            <TabsTrigger value="voiceover">🎙️ 配音管理</TabsTrigger>
            <TabsTrigger value="compose">🎬 合成视频</TabsTrigger>
          </TabsList>

          <TabsContent value="preview">
            <VideoPreview
              videoUrl={mergedVideoUrl}
              episodes={episodes.map((ep) => ({
                episodeNumber: ep.episodeNumber,
                title: ep.title || "",
                imageUrl: ep.imageUrl,
                voiceoverUrl: ep.voiceoverUrl,
              }))}
            />
          </TabsContent>

          <TabsContent value="voiceover">
            <VoiceoverPanel
              items={voiceoverItems}
              onGenerate={handleGenerateSingleVoiceover}
              onGenerateAll={handleGenerateAllVoiceovers}
              loading={loadingAction === "voiceover" || loadingAction.startsWith("voiceover-")}
            />
          </TabsContent>

          <TabsContent value="compose">
            <div className="space-y-4">
              <div className="border border-border/50 rounded-lg p-6 bg-card/50">
                <h3 className="font-semibold mb-2">视频合成</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  将分镜图片和配音合成为视频。确保所有集都有分镜图片和配音。
                </p>
                <div className="space-y-2 mb-6">
                  {episodes.map((ep) => (
                    <div key={ep.id} className="flex items-center gap-3 text-sm">
                      <span className="w-16 shrink-0">EP{ep.episodeNumber}</span>
                      <span className={`w-3 h-3 rounded-full ${ep.imageUrl ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="text-xs text-muted-foreground">分镜</span>
                      <span className={`w-3 h-3 rounded-full ${ep.voiceoverUrl ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="text-xs text-muted-foreground">配音</span>
                      <span className={`w-3 h-3 rounded-full ${ep.videoUrl ? "bg-emerald-500" : "bg-zinc-600"}`} />
                      <span className="text-xs text-muted-foreground">视频</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={handleComposeAll}
                  disabled={loadingAction === "compose"}
                  className="bg-emerald-600 hover:bg-emerald-500"
                >
                  {loadingAction === "compose" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      合成中...
                    </>
                  ) : (
                    <>
                      <Film className="h-4 w-4 mr-2" />
                      合成所有集
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between mt-8">
          <Link href={`/create/storyboard?dramaId=${dramaId}`}>
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              上一步
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline">
              返回我的短剧
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
