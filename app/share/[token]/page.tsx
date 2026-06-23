"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Play, Clock, Eye, Film, Sparkles, ArrowLeft } from "lucide-react";

interface DramaData {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  style: string | null;
  aspectRatio: string | null;
  coverUrl: string | null;
  totalDuration: number | null;
  shareCount: number | null;
  createdAt: string;
}

interface EpisodeData {
  id: string;
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  videoUrl: string | null;
  voiceoverUrl: string | null;
  duration: number | null;
}

function toPublicUrl(localPath: string | null): string | null {
  if (!localPath) return null;
  if (localPath.includes(".cos.") && localPath.startsWith("http")) {
    try {
      const url = new URL(localPath);
      const cosKey = url.pathname.slice(1);
      return `/api/uploads/cos/${encodeURIComponent(cosKey)}`;
    } catch {
      return localPath;
    }
  }
  if (localPath.startsWith("http")) return localPath;
  return `/api/uploads/${localPath.replace(/^\.?\/?uploads\/?/, "")}`;
}

const GENRE_LABELS: Record<string, string> = {
  mystery: "悬疑", romance: "爱情", comedy: "喜剧", scifi: "科幻", horror: "恐怖",
};
const STYLE_LABELS: Record<string, string> = {
  realistic: "写实", anime: "动漫", ink: "水墨", cyberpunk: "赛博朋克",
};

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  const [drama, setDrama] = useState<DramaData | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEpisode, setSelectedEpisode] = useState(0);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  const fetchDrama = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/share/${token}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "短剧不存在");
        return;
      }

      const data = await res.json();
      setDrama(data.drama);
      setEpisodes(
        (data.episodes || []).map((ep: EpisodeData) => ({
          ...ep,
          imageUrl: toPublicUrl(ep.imageUrl),
          videoUrl: toPublicUrl(ep.videoUrl),
          voiceoverUrl: toPublicUrl(ep.voiceoverUrl),
        }))
      );
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      queueMicrotask(() => void fetchDrama());
    }
  }, [token, fetchDrama]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
          <Skeleton className="h-8 w-48 bg-zinc-800" />
          <Skeleton className="aspect-video w-full rounded-xl bg-zinc-800" />
          <Skeleton className="h-6 w-32 bg-zinc-800" />
          <Skeleton className="h-4 w-full bg-zinc-800" />
          <Skeleton className="h-4 w-3/4 bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error || !drama) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-zinc-400 text-lg">{error || "短剧不存在"}</p>
        <Link href="/sign-in">
          <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <ArrowLeft className="h-4 w-4 mr-2" />
            前往登录
          </Button>
        </Link>
      </div>
    );
  }

  const isVertical = drama.aspectRatio === "vertical";
  const currentEp = episodes[selectedEpisode];
  const videoUrl = currentEp?.videoUrl;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Cover / Video Player Area */}
      <div className={`mx-auto ${isVertical ? "max-w-md" : "max-w-4xl"} px-4 pt-6`}>
        {/* Video player */}
        <div className={`relative rounded-xl overflow-hidden bg-zinc-900 ${isVertical ? "aspect-[9/16]" : "aspect-video"}`}>
          {playingVideo ? (
            <video
              src={playingVideo}
              controls
              autoPlay
              className="w-full h-full object-contain"
              onEnded={() => setPlayingVideo(null)}
              onError={() => setPlayingVideo(null)}
            />
          ) : videoUrl ? (
            <button
              onClick={() => setPlayingVideo(videoUrl)}
              className="absolute inset-0 flex items-center justify-center group"
            >
              <img
                src={currentEp.imageUrl || ""}
                alt={currentEp.title || ""}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Play className="w-8 h-8 text-white ml-1" fill="white" />
                </div>
              </div>
            </button>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500">
              <Film className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">暂无视频</p>
            </div>
          )}
        </div>
      </div>

      {/* Drama Info */}
      <div className={`mx-auto ${isVertical ? "max-w-md" : "max-w-4xl"} px-4 mt-6`}>
        <h1 className="text-xl font-bold mb-2">{drama.title}</h1>
        {drama.description && (
          <p className="text-zinc-400 text-sm leading-relaxed mb-3">{drama.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {drama.genre && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {GENRE_LABELS[drama.genre] || drama.genre}
            </Badge>
          )}
          {drama.style && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {STYLE_LABELS[drama.style] || drama.style}
            </Badge>
          )}
          {drama.aspectRatio === "vertical" && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              竖屏
            </Badge>
          )}
          <span className="text-xs text-zinc-500 flex items-center gap-1">
            <Film className="w-3 h-3" /> {episodes.length} 集
          </span>
          {drama.totalDuration && (
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {drama.totalDuration}s
            </span>
          )}
          {drama.shareCount != null && drama.shareCount > 0 && (
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Eye className="w-3 h-3" /> {drama.shareCount} 次观看
            </span>
          )}
        </div>

        {/* Episode selector */}
        {episodes.length > 1 && (
          <div className="mb-4">
            <h2 className="text-sm font-medium text-zinc-400 mb-2">剧集列表</h2>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
              {episodes.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => {
                    setSelectedEpisode(ep.episodeNumber - 1);
                    setPlayingVideo(null);
                  }}
                  className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-sm ${
                    selectedEpisode === ep.episodeNumber - 1
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="font-medium">EP{ep.episodeNumber}</span>
                  {ep.videoUrl && <Play className="w-3 h-3" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AI Branding */}
        <div className="mt-6 pt-4 border-t border-zinc-800 text-center">
          <div className="flex items-center justify-center gap-2 text-zinc-500">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs">由 Shortify AI 智能生成</span>
          </div>
          <p className="text-xs text-zinc-600 mt-1">
            AI 驱动的短剧创作平台
          </p>
        </div>

        {/* CTA */}
        <div className="mt-6 mb-8 text-center">
          <Link href="/sign-in">
            <Button className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Sparkles className="w-4 h-4 mr-2" />
              免费创作你的短剧
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
