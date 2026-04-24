"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { ShotCard } from "@/components/drama/shot-card";
import { Loader2, ArrowRight, ArrowLeft, ImageIcon, ChevronDown, ChevronUp, Film, Square } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useTaskPolling } from "@/lib/hooks/use-task-polling";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜" },
  { number: 4, title: "预览" },
];

interface StoryboardItem {
  id: string;
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  narration: string;
  shotData?: Array<{
    shotNumber: number;
    visual: string;
    duration: number;
    type?: "dialogue" | "narration";
    character?: string;
    line?: string;
    subtitle?: string;
    aiVideoUrl?: string | null;
  }>;
}

interface DramaEpisodeResponse {
  id: string;
  episodeNumber: number;
  title?: string | null;
  imageUrl?: string | null;
  narrationText?: string | null;
  shotData?: StoryboardItem["shotData"];
}

export default function StoryboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dramaId = searchParams.get("dramaId");

  const [items, setItems] = useState<StoryboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState(-1);
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null);
  const [error, setError] = useState("");
  const progressRef = useRef<HTMLDivElement>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskProgressLabel, setTaskProgressLabel] = useState("");

  const fetchEpisodes = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setItems(
          data.episodes.map((ep: DramaEpisodeResponse) => ({
            id: ep.id,
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
            shotData: Array.isArray(ep.shotData) ? ep.shotData : undefined,
          }))
        );
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  const { task: activeTask, startPolling } = useTaskPolling(activeTaskId, {
    autoStart: false,
    onCompleted: async (task) => {
      setGenerating(false);
      setGeneratingIndex(-1);
      setActiveTaskId(null);
      setTaskProgressLabel(task.presentation?.summary || "");
      await fetchEpisodes();
      toast.success("分镜生成完成");
    },
    onFailed: async (task) => {
      setGenerating(false);
      setGeneratingIndex(-1);
      setActiveTaskId(null);
      setTaskProgressLabel(task.presentation?.summary || "");
      setError(task.presentation?.failureTitle || task.errorMessage || "分镜生成失败");
      toast.error(task.presentation?.failureTitle || task.errorMessage || "分镜生成失败");
    },
  });

  useEffect(() => {
    if (!dramaId) {
      router.push("/create");
      return;
    }
    queueMicrotask(() => {
      void fetchEpisodes();
    });
  }, [dramaId, fetchEpisodes, router]);

  useEffect(() => {
    if (!activeTaskId) return;
    void startPolling();
  }, [activeTaskId, startPolling]);

  const progressLabel = activeTask?.progress?.label || taskProgressLabel;

  useEffect(() => {
    if (!dramaId || items.length === 0 || activeTaskId || generating) return;

    const needsStoryboard = items.some((item) => !item.imageUrl);
    if (!needsStoryboard) return;

    let cancelled = false;
    const resumeTask = async () => {
      try {
        const res = await fetch(`/api/tasks?dramaId=${dramaId}&type=storyboard&status=processing&latest=1`);
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const latestTask = Array.isArray(data.tasks) ? data.tasks[0] : null;
        if (latestTask?.id) {
          setGenerating(true);
          setActiveTaskId(latestTask.id);
        }
      } catch {
        // ignore resume errors
      }
    };

    void resumeTask();
    return () => {
      cancelled = true;
    };
  }, [activeTaskId, dramaId, generating, items]);

  const handleGenerateAll = async () => {
    if (!dramaId) return;
    setGenerating(true);
    setGeneratingIndex(-1);
    setError("");

    try {
      const res = await fetch("/api/generate/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "分镜生成失败");
        toast.error(data.error || "分镜生成失败");
        setGenerating(false);
        return;
      }

      if (data.taskId) {
        setTaskProgressLabel("");
        setActiveTaskId(data.taskId);
        toast.success(data.message || "分镜生成任务已启动");
        return;
      }

      setError("分镜任务已启动，但未返回任务编号");
      setGenerating(false);
      toast.warning("分镜任务已启动，但未返回任务编号");
    } catch {
      setError("分镜生成失败");
      setGenerating(false);
      toast.error("分镜生成失败");
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
        body: JSON.stringify({ dramaId, episodeId: ep.id }),
      });

      if (res.ok) {
        toast.success(`第 ${episodeNumber} 集分镜已重新生成`);
        await fetchEpisodes();
      }
    } catch {
      toast.error("重新生成失败");
    }
  };

  const handleCancelTask = async () => {
    if (!activeTaskId) return;
    try {
      const res = await fetch(`/api/tasks/${activeTaskId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "取消任务失败");
        return;
      }
      setGenerating(false);
      setGeneratingIndex(-1);
      setActiveTaskId(null);
      setTaskProgressLabel("");
      toast.success("分镜任务已取消");
    } catch {
      setError("取消任务失败");
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
  const totalShots = items.reduce((sum, ep) => sum + (ep.shotData?.length || 0), 0);
  const shotsWithVideo = items.reduce(
    (sum, ep) => sum + (ep.shotData?.filter((s) => s.aiVideoUrl).length || 0),
    0
  );

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
            🎨 AI 为每个镜头生成 1080p 画面，点击展开查看镜头详情
            {totalShots > 0 && (
              <span className="ml-2 text-emerald-400/70">
                共 {items.length} 集 / {totalShots} 个镜头
                {shotsWithVideo > 0 && ` / ${shotsWithVideo} 个 AI 视频`}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-8 gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold mb-1">AI 分镜 🎨</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">每个镜头独立生成画面，支持 1080p 高清</p>
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
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-red-400 bg-red-500/10 rounded p-3">
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={handleGenerateAll}
              disabled={generating}
              className="min-h-[40px] border-red-500/30 text-red-300 hover:text-red-200"
            >
              重试生成
            </Button>
          </div>
        )}

        {/* Progress bar */}
        {generating && (
          <div className="mb-6 p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
                <ImageIcon className="h-4 w-4 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-400">
                  {progressLabel || `正在生成第 ${generatingIndex >= 0 ? generatingIndex + 1 : "?"} / ${totalCount} 集分镜`}
                </p>
                <p className="text-xs text-muted-foreground">每张图片需要 10-20 秒</p>
              </div>
              {activeTaskId && (
                <Button variant="outline" size="sm" onClick={handleCancelTask}>
                  <Square className="h-3.5 w-3.5 mr-1.5" />
                  取消
                </Button>
              )}
            </div>
            <div className="w-full bg-emerald-500/20 rounded-full h-1.5 overflow-hidden">
              <div
                ref={progressRef}
                className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${activeTask?.progress?.total
                    ? (activeTask.progress.completed / activeTask.progress.total) * 100
                    : generatingIndex >= 0
                      ? ((generatingIndex + 1) / totalCount) * 100
                      : 5}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Episode accordion with shot cards */}
        <div className="space-y-4">
          {items.map((item) => {
            const isExpanded = expandedEpisode === item.episodeNumber;
            const shots = item.shotData || [];
            const isThisGenerating = generating && generatingIndex >= 0 && (items[generatingIndex] as StoryboardItem | undefined)?.episodeNumber === item.episodeNumber;

            return (
              <div
                key={item.episodeNumber}
                className="border border-border/50 rounded-lg overflow-hidden bg-card/30"
              >
                {/* Episode header */}
                <div
                  className="flex items-center gap-3 p-3 sm:p-4 cursor-pointer hover:bg-card/50 transition"
                  onClick={() => setExpandedEpisode(isExpanded ? null : item.episodeNumber)}
                >
                  {/* Thumbnail */}
                  <div className="w-16 h-10 sm:w-20 sm:h-12 rounded overflow-hidden bg-muted shrink-0 relative">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                    ) : isThisGenerating ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-[10px] text-muted-foreground/50">EP{item.episodeNumber}</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm sm:text-base truncate">
                      第 {item.episodeNumber} 集 - {item.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {shots.length > 0
                        ? `${shots.length} 个镜头`
                        : item.narration
                          ? `${item.narration.slice(0, 50)}${item.narration.length > 50 ? "..." : ""}`
                          : "暂无内容"}
                    </p>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    {item.imageUrl && shots.length > 0 && (
                      <span className="text-[10px] text-emerald-400 hidden sm:inline">✓ 分镜完成</span>
                    )}
                    {shots.filter((s) => s.aiVideoUrl).length > 0 && (
                      <span className="text-[10px] text-emerald-400 hidden sm:inline flex items-center gap-0.5">
                        <Film className="h-3 w-3" />
                        {shots.filter((s) => s.aiVideoUrl).length} 视频
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded shot cards */}
                {isExpanded && shots.length > 0 && (
                  <div className="border-t border-border/50 p-3 sm:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {shots.map((shot) => (
                        <ShotCard
                          key={shot.shotNumber}
                          shotNumber={shot.shotNumber}
                          visual={shot.visual}
                          duration={shot.duration}
                          type={shot.type}
                          character={shot.character}
                          line={shot.line}
                          subtitle={shot.subtitle}
                          aiVideoUrl={shot.aiVideoUrl}
                          onRegenerateImage={() => handleRegenerate(item.episodeNumber)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Expanded simple view for non-shot episodes */}
                {isExpanded && shots.length === 0 && item.narration && (
                  <div className="border-t border-border/50 p-3 sm:p-4">
                    <p className="text-sm text-muted-foreground">{item.narration}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
