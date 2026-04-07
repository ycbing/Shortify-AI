"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { VoiceoverPanel } from "@/components/drama/voiceover-panel";
import { VideoPreview } from "@/components/drama/video-preview";
import { ExportDialog } from "@/components/drama/export-dialog";
import { Loader2, ArrowLeft, Film, Check, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

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
  subtitleUrl: string | null;
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

export default function PreviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dramaId = searchParams.get("dramaId");

  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const [dramaTitle, setDramaTitle] = useState<string>("");
  const [dramaStatus, setDramaStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState("");
  const [actionProgress, setActionProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");

  const fetchEpisodes = useCallback(async (showLoading = true) => {
    if (!dramaId) return;
    if (showLoading) setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setDramaTitle(data.title || "");
        setDramaStatus(data.status || "");
        const processedEpisodes = (data.episodes || []).map((ep: EpisodeData) => ({
          ...ep,
          voiceoverUrl: toPublicUrl(ep.voiceoverUrl),
          imageUrl: toPublicUrl(ep.imageUrl),
          videoUrl: toPublicUrl(ep.videoUrl),
          subtitleUrl: toPublicUrl(ep.subtitleUrl),
        }));
        setEpisodes(processedEpisodes);
      } else {
        toast.error("加载短剧数据失败");
      }
    } catch {
      setError("加载失败");
      toast.error("网络错误，请刷新页面重试");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => {
    if (!dramaId) {
      router.push("/create");
      return;
    }
    fetchEpisodes();
  }, [dramaId]);

  // Auto-resume polling if drama is in generating state (e.g. page refresh)
  useEffect(() => {
    if (!dramaId || !episodes.length) return;
    // Only resume if drama status is actually "generating"
    const isGenerating = dramaStatus === "generating";
    if (isGenerating && loadingAction !== "video-gen") {
      setLoadingAction("video-gen");
      pollVideoProgress();
    }
  }, [dramaId, dramaStatus]);

  const handleGenerateAllVoiceovers = async () => {
    if (!dramaId) return;
    setLoadingAction("voiceover");
    const episodesToProcess = episodes.filter((ep) => !ep.voiceoverUrl);
    const total = episodesToProcess.length || episodes.length;

    for (let i = 0; i < episodes.length; i++) {
      if (episodesToProcess.length > 0 && episodes[i].voiceoverUrl) continue;
      setActionProgress({ current: i + 1, total });
      setLoadingAction(`voiceover-${i + 1}`);

      try {
        const res = await fetch("/api/generate/voiceover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dramaId, episodeId: episodes[i].id }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error || `第 ${episodes[i].episodeNumber} 集配音生成失败`;
          setError(errMsg);
          toast.error(errMsg);
          if (errData.code === "INSUFFICIENT_CREDITS") {
            toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
          }
          break;
        }
      } catch {
        const msg = `第 ${episodes[i].episodeNumber} 集配音生成失败`;
        setError(msg);
        toast.error(msg);
        break;
      }
    }

    await fetchEpisodes();
    setLoadingAction("");
    setActionProgress({ current: 0, total: 0 });

    if (!error) {
      toast.success("配音生成完成");
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
        toast.success(`第 ${ep.episodeNumber} 集配音生成完成`);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || "配音生成失败";
        toast.error(errMsg);
        if (errData.code === "INSUFFICIENT_CREDITS") {
          toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
        }
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoadingAction("");
    }
  };

  const handleComposeAll = async () => {
    if (!dramaId) return;
    setLoadingAction("compose");
    setActionProgress({ current: 0, total: episodes.length });
    setError("");

    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mergedUrl) {
          setMergedVideoUrl(toPublicUrl(data.mergedUrl));
        }
        await fetchEpisodes();
        toast.success(`视频合成完成，共 ${data.videoCount || episodes.length} 集`);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || "视频合成失败";
        setError(errMsg);
        toast.error(errMsg);
        if (errData.code === "INSUFFICIENT_CREDITS") {
          toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
        }
      }
    } catch {
      setError("视频合成失败");
      toast.error("网络错误，请重试");
    } finally {
      setLoadingAction("");
      setActionProgress({ current: 0, total: 0 });
    }
  };

  const handleGenerateVideos = async () => {
    if (!dramaId || loadingAction === "video-gen") return;
    setLoadingAction("video-gen");
    setError("");
    try {
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message || "AI 视频生成已启动");
        pollVideoProgress();
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || "视频生成启动失败";
        setError(errMsg);
        toast.error(errMsg);
        if (errData.code === "INSUFFICIENT_CREDITS") {
          toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
        }
      }
    } catch {
      setError("视频生成失败");
      toast.error("网络错误，请重试");
      setLoadingAction("");
    }
  };

  const pollVideoProgress = async () => {
    if (!dramaId) return;
    const maxAttempts = 60;
    let attempts = 0;

    const poll = async () => {
      attempts++;
      await fetchEpisodes(false);

      // Fetch fresh data to check completion
      try {
        const res = await fetch(`/api/dramas/${dramaId}`);
        if (res.ok) {
          const data = await res.json();
          const eps = data.episodes || [];
          // Count episodes that have videoUrl (AI-generated video)
          const episodesWithShots = eps.filter((ep: any) => {
            const shots = Array.isArray(ep.shotData) ? ep.shotData : [];
            return shots.length > 0;
          });
          const completed = episodesWithShots.filter((ep: any) => !!ep.videoUrl).length;
          setActionProgress({ current: completed, total: episodesWithShots.length });

          const allDone = episodesWithShots.every((ep: any) => !!ep.videoUrl);
          if (allDone || attempts >= maxAttempts) {
            setLoadingAction("");
            setActionProgress({ current: 0, total: 0 });
            if (allDone) {
              toast.success("AI 视频生成完成！");
              await fetchEpisodes(false);
            } else {
              toast.warning("AI 视频生成超时，部分集可能未完成");
            }
            return;
          }
        }
      } catch {
        // ignore poll errors
      }

      setTimeout(poll, 5000);
    };

    setTimeout(poll, 10000);
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

  const getActionLabel = () => {
    if (loadingAction.startsWith("voiceover")) {
      const isSingle = loadingAction.includes("-");
      return isSingle
        ? `正在生成第 ${actionProgress.current}/${actionProgress.total} 集配音...`
        : "正在生成配音...";
    }
    if (loadingAction === "compose") {
      return actionProgress.total > 0
        ? `正在合成第 ${actionProgress.current}/${actionProgress.total} 集...`
        : "正在合成视频...";
    }
    if (loadingAction === "video-gen") {
      return actionProgress.total > 0
        ? `AI 视频生成中... (${actionProgress.current}/${actionProgress.total} 集已完成)`
        : "AI 视频生成中...";
    }
    return "处理中...";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-14 sm:h-16 gap-2">
          <StepIndicator currentStep={4} steps={steps} />
          {dramaId && (
            <ExportDialog
              dramaId={dramaId}
              dramaTitle={dramaTitle}
              episodeCount={episodes.length}
            />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {/* Step hint */}
        <div className="mb-6 sm:mb-8 p-3 sm:p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-xs sm:text-sm text-emerald-400">
            🎬 生成配音、合成视频、导出你的作品
          </p>
        </div>

        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-1">预览与导出 🎬</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">为你的短剧生成配音、合成视频</p>
        </div>

        {error && (
          <div
            className="mb-6 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2 cursor-pointer"
            onClick={() => setError("")}
            role="alert"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <span className="text-xs text-red-400/60 shrink-0">点击关闭</span>
          </div>
        )}

        {/* Action progress indicator */}
        {loadingAction && (
          <div className="mb-6 p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
                <Film className="h-4 w-4 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-400">
                  {getActionLabel()}
                </p>
                <p className="text-xs text-muted-foreground">
                  请耐心等待，不要离开此页面
                </p>
              </div>
            </div>
            {actionProgress.total > 0 && (
              <div className="w-full bg-emerald-500/20 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${(actionProgress.current / actionProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        <Tabs defaultValue="preview" className="space-y-4 sm:space-y-6">
          {/* Tabs — horizontally scrollable on mobile */}
          <TabsList className="bg-muted/30 w-full overflow-x-auto flex h-auto p-1 gap-1">
            <TabsTrigger value="preview" className="inline-flex items-center gap-1.5 shrink-0 min-h-[40px] text-xs sm:text-sm px-3 sm:px-4">📹 视频预览</TabsTrigger>
            <TabsTrigger value="voiceover" className="inline-flex items-center gap-1.5 shrink-0 min-h-[40px] text-xs sm:text-sm px-3 sm:px-4">🎙️ 配音管理</TabsTrigger>
            <TabsTrigger value="compose" className="inline-flex items-center gap-1.5 shrink-0 min-h-[40px] text-xs sm:text-sm px-3 sm:px-4">🎬 合成视频</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="w-full">
            <VideoPreview
              videoUrl={mergedVideoUrl}
              episodes={episodes.map((ep) => ({
                episodeNumber: ep.episodeNumber,
                title: ep.title || "",
                imageUrl: ep.imageUrl,
                voiceoverUrl: ep.voiceoverUrl,
                videoUrl: ep.videoUrl,
                subtitleUrl: ep.subtitleUrl,
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
              {/* AI 视频生成 */}
              <div className="border border-border/50 rounded-lg p-4 sm:p-6 bg-card/50">
                <div className="flex items-center gap-2 mb-2">
                  <Film className="h-5 w-5 text-emerald-400" />
                  <h3 className="font-semibold text-sm sm:text-base">AI 视频生成</h3>
                  <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded hidden sm:inline">CogVideoX-3</span>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                  使用 CogVideoX-3 将每个分镜镜头生成 AI 动态视频，再自动拼接成完整剧集。每个镜头 20 积分。
                </p>
                <div className="space-y-2 mb-4 sm:mb-6">
                  {episodes.map((ep) => {
                    const epData = ep as any;
                    const shots = Array.isArray(epData.shotData) ? epData.shotData : [];
                    const hasVideo = ep.videoUrl;
                    const isGenerating = loadingAction === "video-gen" && shots.length > 0 && !hasVideo;
                    return (
                    <div key={ep.id} className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="w-12 sm:w-16 shrink-0 font-medium">EP{ep.episodeNumber}</span>
                      {hasVideo ? (
                        <span className="text-xs text-emerald-400 inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> 已完成</span>
                      ) : isGenerating ? (
                        <span className="text-xs text-amber-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> 生成中...</span>
                      ) : shots.length > 0 ? (
                        <span className="text-xs text-zinc-500">待生成</span>
                      ) : (
                        <span className="text-xs text-zinc-600">无分镜</span>
                      )}
                    </div>
                    );
                  })}
                </div>
                <Button
                  onClick={handleGenerateVideos}
                  disabled={loadingAction === "video-gen"}
                  className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px] w-full sm:w-auto"
                >
                  {loadingAction === "video-gen" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {actionProgress.total > 0
                        ? `AI 视频生成中 ${actionProgress.current}/${actionProgress.total} 集...`
                        : "AI 视频生成中..."}
                    </>
                  ) : (
                    <>
                      <Film className="h-4 w-4 mr-2" />
                      生成 AI 视频
                    </>
                  )}
                </Button>
              </div>

              {/* FFmpeg 幻灯片合成 */}
              <div className="border border-border/50 rounded-lg p-4 sm:p-6 bg-card/50">
                <h3 className="font-semibold text-sm sm:text-base mb-2">幻灯片合成（备选）</h3>
                <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                  将分镜图片和配音合成为幻灯片视频。如果 AI 视频生成失败，可以用这个。
                </p>
                <div className="space-y-2 mb-4 sm:mb-6">
                  {episodes.map((ep) => (
                    <div key={ep.id} className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="w-12 sm:w-16 shrink-0">EP{ep.episodeNumber}</span>
                      <span className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full shrink-0 ${ep.imageUrl ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="text-xs text-muted-foreground hidden sm:inline">分镜</span>
                      <span className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full shrink-0 ${ep.voiceoverUrl ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="text-xs text-muted-foreground hidden sm:inline">配音</span>
                      <span className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full shrink-0 ${ep.videoUrl ? "bg-emerald-500" : "bg-zinc-600"}`} />
                      <span className="text-xs text-muted-foreground hidden sm:inline">视频</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={handleComposeAll}
                  disabled={loadingAction === "compose"}
                  className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px] w-full sm:w-auto"
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

        <div className="flex flex-col sm:flex-row justify-between gap-3 mt-8">
          <Link href={`/create/storyboard?dramaId=${dramaId}`}>
            <Button variant="outline" className="w-full sm:w-auto min-h-[44px]">
              <ArrowLeft className="h-4 w-4 mr-2" />
              上一步
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" className="w-full sm:w-auto min-h-[44px]">
              返回我的短剧
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
