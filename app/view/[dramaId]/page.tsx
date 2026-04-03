"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoPreview } from "@/components/drama/video-preview";
import { ExportDialog } from "@/components/drama/export-dialog";
import { Loader2, ArrowLeft, Edit3 } from "lucide-react";
import Link from "next/link";

interface DramaData {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  style: string | null;
  status: string;
  totalDuration: number | null;
  createdAt: string;
}

interface EpisodeData {
  id: string;
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  voiceoverUrl: string | null;
  videoUrl: string | null;
  subtitleUrl: string | null;
  narrationText: string | null;
  duration: number | null;
}

/** Convert a local upload path to a public /api/uploads/ URL */
/** Convert a local upload path or COS URL to an accessible URL */
function toPublicUrl(localPath: string | null): string | null {
  if (!localPath) return null;
  // COS URL -> proxy through /api/uploads/cos/ for signed access
  if (localPath.includes(".cos.") && localPath.startsWith("http")) {
    try {
      const url = new URL(localPath);
      const cosKey = url.pathname.slice(1); // remove leading /
      return `/api/uploads/cos/${encodeURIComponent(cosKey)}`;
    } catch {
      return localPath;
    }
  }
  if (localPath.startsWith("http")) return localPath;
  return `/api/uploads/${localPath.replace(/^\.?\/?uploads\/?/, "")}`;
}

export default function ViewDramaPage() {
  const router = useRouter();
  const params = useParams();
  const dramaId = params.dramaId as string;

  const [drama, setDrama] = useState<DramaData | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEpisode, setSelectedEpisode] = useState(0);

  const fetchDrama = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setDrama(data.drama);
        // 将本地路径转为可访问的 URL
        const processedEpisodes = (data.episodes || []).map((ep: EpisodeData) => ({
          ...ep,
          voiceoverUrl: toPublicUrl(ep.voiceoverUrl),
          imageUrl: toPublicUrl(ep.imageUrl),
          videoUrl: toPublicUrl(ep.videoUrl),
          subtitleUrl: toPublicUrl(ep.subtitleUrl),
        }));
        setEpisodes(processedEpisodes);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => {
    if (!dramaId) {
      router.push("/dashboard");
      return;
    }
    fetchDrama();
  }, [dramaId]);

  const handleExport = async (format: string, _resolution: string) => {
    try {
      const res = await fetch(`/api/dramas/${dramaId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (res.ok) alert("导出成功！");
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

  if (!drama) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">短剧不存在</p>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    draft: "草稿",
    generating: "生成中",
    script_ready: "剧本就绪",
    storyboard_ready: "分镜就绪",
    voiceover_ready: "配音就绪",
    completed: "已完成",
    error: "生成失败",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 h-16">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <Link href={`/create/editor/${dramaId}`}>
              <Button variant="outline" size="sm">
                <Edit3 className="h-3.5 w-3.5 mr-1.5" />
                编辑
              </Button>
            </Link>
            <ExportDialog
              dramaId={dramaId}
              episodeCount={episodes.length}
              onExport={handleExport}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Drama info */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold">{drama.title}</h1>
            <Badge variant="outline">{statusLabels[drama.status] || drama.status}</Badge>
          </div>
          {drama.description && (
            <p className="text-muted-foreground">{drama.description}</p>
          )}
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            {drama.genre && <span>题材: {drama.genre}</span>}
            {drama.style && <span>画风: {drama.style}</span>}
            {drama.totalDuration && <span>时长: {drama.totalDuration}s</span>}
            <span>创建于 {new Date(drama.createdAt).toLocaleDateString("zh-CN")}</span>
          </div>
        </div>

        {/* Video preview */}
        <VideoPreview
          videoUrl={episodes.find((e) => e.videoUrl)?.videoUrl || null}
          episodes={episodes.map((ep) => ({
            episodeNumber: ep.episodeNumber,
            title: ep.title || "",
            imageUrl: ep.imageUrl,
            voiceoverUrl: ep.voiceoverUrl,
            videoUrl: ep.videoUrl,
            subtitleUrl: ep.subtitleUrl,
          }))}
        />

        {/* Episode list */}
        {episodes.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-4">剧集列表</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {episodes.map((ep) => (
                <div
                  key={ep.id}
                  onClick={() => setSelectedEpisode(ep.episodeNumber - 1)}
                  className={`border rounded-lg overflow-hidden cursor-pointer transition-all ${
                    selectedEpisode === ep.episodeNumber - 1
                      ? "border-emerald-500 ring-1 ring-emerald-500/50"
                      : "border-border/50 hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="aspect-video bg-muted">
                    {ep.imageUrl ? (
                      <img
                        src={ep.imageUrl}
                        alt={ep.title || ""}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                        暂无图片
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium">EP{ep.episodeNumber} - {ep.title || "未命名"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {ep.duration ? `${ep.duration}s` : ""}
                      {ep.videoUrl ? " · ✓ 视频" : ""}
                      {ep.voiceoverUrl ? " · ✓ 配音" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
