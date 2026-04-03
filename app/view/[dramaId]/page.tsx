"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoPreview } from "@/components/drama/video-preview";
import { ExportDialog } from "@/components/drama/export-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  ArrowLeft,
  Edit3,
  Check,
  Share2,
  Copy,
  CheckCircle2,
  MessageCircle,
  ExternalLink,
  QrCode,
} from "lucide-react";
import Link from "next/link";

interface DramaData {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  style: string | null;
  status: string;
  totalDuration: number | null;
  coverUrl: string | null;
  bgmUrl: string | null;
  shareCount: number | null;
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

/** Convert a local upload path or COS URL to an accessible URL */
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

export default function ViewDramaPage() {
  const router = useRouter();
  const params = useParams();
  const dramaId = params.dramaId as string;

  const [drama, setDrama] = useState<DramaData | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEpisode, setSelectedEpisode] = useState(0);

  // Share state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInfo, setShareInfo] = useState<{
    shareUrl: string;
    title: string;
    coverUrl: string | null;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showWechatTip, setShowWechatTip] = useState(false);

  const fetchDrama = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setDrama(data.drama);
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

  const handleShare = async () => {
    if (!dramaId) return;
    try {
      const res = await fetch(`/api/dramas/${dramaId}/share`);
      if (res.ok) {
        const data = await res.json();
        setShareInfo({
          shareUrl: data.shareUrl,
          title: data.title,
          coverUrl: toPublicUrl(data.coverUrl),
        });
        setShareOpen(true);
        setLinkCopied(false);
        setShowWechatTip(false);
      }
    } catch {
      // ignore
    }
  };

  const copyLink = async () => {
    if (!shareInfo) return;
    try {
      await navigator.clipboard.writeText(shareInfo.shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = shareInfo.shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const getWeiboShareUrl = () => {
    if (!shareInfo) return "#";
    const text = `来看看我创作的AI短剧《${shareInfo.title}》`;
    return `https://service.weibo.com/share/share.php?title=${encodeURIComponent(text)}&url=${encodeURIComponent(shareInfo.shareUrl)}`;
  };

  const getQQShareUrl = () => {
    if (!shareInfo) return "#";
    const title = `AI短剧 - ${shareInfo.title}`;
    return `https://connect.qq.com/widget/shareqq/index.html?title=${encodeURIComponent(title)}&url=${encodeURIComponent(shareInfo.shareUrl)}`;
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
            >
              <Share2 className="h-3.5 w-3.5 mr-1.5" />
              分享
            </Button>
            <Link href={`/create/editor/${dramaId}`}>
              <Button variant="outline" size="sm">
                <Edit3 className="h-3.5 w-3.5 mr-1.5" />
                编辑
              </Button>
            </Link>
            <ExportDialog
              dramaId={dramaId}
              episodeCount={episodes.length}
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
            {drama.shareCount != null && drama.shareCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {drama.shareCount} 次分享
              </span>
            )}
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
                      {ep.videoUrl ? " · " : ""}{ep.videoUrl && <span className="inline-flex items-center gap-0.5"><Check className="h-3 w-3 text-emerald-400" /> 视频</span>}
                      {ep.voiceoverUrl ? " · " : ""}{ep.voiceoverUrl && <span className="inline-flex items-center gap-0.5"><Check className="h-3 w-3 text-emerald-400" /> 配音</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Share Dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="bg-card border-border/50 sm:max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>分享短剧</DialogTitle>
            <DialogDescription>
              复制链接或分享到社交媒体，让更多人看到你的作品
            </DialogDescription>
          </DialogHeader>

          {shareInfo && (
            <div className="space-y-4 py-2">
              {/* Cover preview */}
              {shareInfo.coverUrl && (
                <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                  <img
                    src={shareInfo.coverUrl}
                    alt={shareInfo.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Title */}
              <div className="text-center">
                <h3 className="font-semibold">{shareInfo.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  由 AI 创作
                </p>
              </div>

              {/* Copy link */}
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground truncate">
                  {shareInfo.shareUrl}
                </div>
                <Button
                  onClick={copyLink}
                  variant={linkCopied ? "default" : "outline"}
                  size="sm"
                  className={linkCopied ? "bg-emerald-600 hover:bg-emerald-500 min-h-[40px]" : "min-h-[40px]"}
                >
                  {linkCopied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      复制
                    </>
                  )}
                </Button>
              </div>

              {/* Social share buttons */}
              <div className="grid grid-cols-3 gap-2">
                {/* WeChat — show tip to copy link */}
                <button
                  onClick={() => setShowWechatTip(true)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 hover:bg-green-500/10 hover:border-green-500/50 transition-all"
                >
                  <MessageCircle className="h-5 w-5 text-green-500" />
                  <span className="text-xs text-muted-foreground">微信</span>
                </button>

                {/* Weibo */}
                <a
                  href={getWeiboShareUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 hover:bg-red-500/10 hover:border-red-500/50 transition-all"
                >
                  <ExternalLink className="h-5 w-5 text-red-500" />
                  <span className="text-xs text-muted-foreground">微博</span>
                </a>

                {/* QQ */}
                <a
                  href={getQQShareUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 hover:bg-blue-500/10 hover:border-blue-500/50 transition-all"
                >
                  <QrCode className="h-5 w-5 text-blue-500" />
                  <span className="text-xs text-muted-foreground">QQ</span>
                </a>
              </div>

              {/* WeChat tip */}
              {showWechatTip && (
                <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <p className="text-sm text-green-400">
                    💡 请点击上方「复制」按钮，然后在微信中粘贴链接发送给朋友
                  </p>
                </div>
              )}

              {/* Short video platform tip */}
              <p className="text-xs text-muted-foreground text-center">
                💡 复制链接发送给朋友，即可分享你的 AI 短剧作品
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
