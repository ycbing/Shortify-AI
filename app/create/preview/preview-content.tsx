"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StepIndicator } from "@/components/create/step-indicator";
import { VoiceoverPanel } from "@/components/drama/voiceover-panel";
import { VideoPreview } from "@/components/drama/video-preview";
import { ExportDialog } from "@/components/drama/export-dialog";
import { Loader2, ArrowLeft, Film, Check, AlertCircle, RefreshCw, Clock3, Square, Sparkles, Music } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useTaskPolling } from "@/lib/hooks/use-task-polling";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜+视频" },
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
  shotData?: Array<{ aiVideoUrl?: string | null }>;
}

interface TaskSummary {
  id: string;
  type: string;
  status: string;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  presentation?: {
    typeLabel: string;
    statusLabel: string;
    statusTone: "neutral" | "warning" | "success" | "danger";
    stageLabel: string | null;
    summary: string;
    retryable: boolean;
    failureTitle: string | null;
    failureHint: string | null;
    durationMs: number | null;
    creditsUsed: number;
  };
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskProgressLabel, setTaskProgressLabel] = useState("");
  const [taskHistory, setTaskHistory] = useState<TaskSummary[]>([]);

  // Video composition options
  const [materialSource, setMaterialSource] = useState<"ai" | "pexels">("ai");
  const [transition, setTransition] = useState<string>("fade");
  const [transitionDuration, setTransitionDuration] = useState<number>(0.5);

  const fetchEpisodes = useCallback(async (showLoading = true) => {
    if (!dramaId) return;
    if (showLoading) setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setDramaTitle(data.drama?.title || "");
        setDramaStatus(data.drama?.status || "");
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

  const fetchTaskHistory = useCallback(async () => {
    if (!dramaId) return;
    try {
      const res = await fetch(`/api/tasks?dramaId=${dramaId}&limit=8`);
      const data = await res.json();
      if (!res.ok) return;
      setTaskHistory(Array.isArray(data.tasks) ? data.tasks : []);
    } catch {
      // ignore history fetch errors
    }
  }, [dramaId]);

  const { task: activeTask, pollError, startPolling, stopPolling } = useTaskPolling(activeTaskId, {
    autoStart: false,
    onCompleted: async (task) => {
      const isVoiceoverTask = task.type === "voiceover";
      const isComposeTask = task.type === "compose";
      const mergedUrl = typeof task.outputData?.mergedUrl === "string"
        ? task.outputData.mergedUrl
        : null;
      setLoadingAction("");
      setActionProgress({ current: 0, total: 0 });
      setActiveTaskId(null);
      setTaskProgressLabel(task.presentation?.summary || "");
      if (isComposeTask && mergedUrl) {
        setMergedVideoUrl(toPublicUrl(mergedUrl));
      }
      await fetchEpisodes(false);
      await fetchTaskHistory();
      toast.success(
        isVoiceoverTask
          ? "配音生成完成！"
          : isComposeTask
            ? "视频合成完成！"
            : "AI 视频生成完成！"
      );
    },
    onFailed: async (task) => {
      const errorMessage = task.errorMessage || task.presentation?.failureTitle || (
        task.type === "voiceover"
          ? "配音生成失败"
          : task.type === "compose"
            ? "视频合成失败"
            : "AI 视频生成失败"
      );
      setError(errorMessage);
      setLoadingAction("");
      setActionProgress({ current: 0, total: 0 });
      setActiveTaskId(null);
      setTaskProgressLabel(task.presentation?.summary || "");
      await fetchEpisodes(false);
      await fetchTaskHistory();
      toast.error(errorMessage);
    },
  });

  useEffect(() => {
    if (!dramaId) {
      router.push("/create");
      return;
    }
    queueMicrotask(() => {
      void fetchEpisodes();
      void fetchTaskHistory();
    });
  }, [dramaId, fetchEpisodes, fetchTaskHistory, router]);

  const startTaskPolling = useCallback((taskId: string, type: "video" | "voiceover" | "compose") => {
    setError("");
    setTaskProgressLabel("");
    setActionProgress({ current: 0, total: 0 });
    setLoadingAction(
      type === "voiceover"
        ? "voiceover"
        : type === "compose"
          ? "compose"
          : "video-gen"
    );
    setActiveTaskId(taskId);
  }, []);

  useEffect(() => {
    if (!activeTaskId) return;
    void startPolling();
  }, [activeTaskId, startPolling]);

  const activeProgress = activeTask?.progress;

  useEffect(() => {
    if (!pollError) return;
    queueMicrotask(() => {
      setError(pollError);
      setLoadingAction("");
      setActionProgress({ current: 0, total: 0 });
      setActiveTaskId(null);
      setTaskProgressLabel("");
      toast.error(pollError);
    });
  }, [pollError]);

  // Auto-resume polling if drama is in generating state
  useEffect(() => {
    if (!dramaId || dramaStatus !== "generating" || loadingAction === "video-gen" || activeTaskId) {
      return;
    }

    let cancelled = false;

    const resumeTaskPolling = async () => {
      try {
        const res = await fetch(`/api/tasks?dramaId=${dramaId}&type=video&status=processing&latest=1`);
        const data = await res.json();
        if (!res.ok || cancelled) return;

        const latestTask = Array.isArray(data.tasks) ? data.tasks[0] : null;
        if (latestTask?.id) {
          startTaskPolling(latestTask.id, "video");
        }
      } catch {
        // ignore resume errors
      }
    };

    void resumeTaskPolling();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [activeTaskId, dramaId, dramaStatus, loadingAction, startTaskPolling, stopPolling]);

  useEffect(() => {
    if (!dramaId || loadingAction === "voiceover" || activeTaskId) {
      return;
    }

    const needsVoiceover = episodes.some((episode) => !episode.voiceoverUrl);
    if (!needsVoiceover) return;

    let cancelled = false;

    const resumeTaskPolling = async () => {
      try {
        const res = await fetch(`/api/tasks?dramaId=${dramaId}&type=voiceover&status=processing&latest=1`);
        const data = await res.json();
        if (!res.ok || cancelled) return;

        const latestTask = Array.isArray(data.tasks) ? data.tasks[0] : null;
        if (latestTask?.id) {
          startTaskPolling(latestTask.id, "voiceover");
        }
      } catch {
        // ignore resume errors
      }
    };

    void resumeTaskPolling();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId, dramaId, episodes, loadingAction, startTaskPolling]);

  useEffect(() => {
    if (!dramaId || loadingAction === "compose" || activeTaskId) {
      return;
    }

    const needsCompose = episodes.some((episode) => !episode.videoUrl && episode.imageUrl && episode.voiceoverUrl);
    if (!needsCompose) return;

    let cancelled = false;

    const resumeTaskPolling = async () => {
      try {
        const res = await fetch(`/api/tasks?dramaId=${dramaId}&type=compose&status=processing&latest=1`);
        const data = await res.json();
        if (!res.ok || cancelled) return;

        const latestTask = Array.isArray(data.tasks) ? data.tasks[0] : null;
        if (latestTask?.id) {
          startTaskPolling(latestTask.id, "compose");
        }
      } catch {
        // ignore resume errors
      }
    };

    void resumeTaskPolling();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId, dramaId, episodes, loadingAction, startTaskPolling]);

  const handleGenerateAllVoiceovers = async () => {
    if (!dramaId) return;
    setLoadingAction("voiceover");
    setActionProgress({ current: 0, total: 0 });
    setError("");

    try {
      const res = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data.error || "配音生成失败";
        setError(errMsg);
        setLoadingAction("");
        toast.error(errMsg);
        if (data.code === "INSUFFICIENT_CREDITS") {
          toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
        }
        return;
      }

      if (data.taskId) {
        await fetchTaskHistory();
        startTaskPolling(data.taskId, "voiceover");
        toast.success(data.message || "配音生成任务已启动");
        return;
      }

      setLoadingAction("");
      toast.warning("配音任务已启动，但未返回任务编号");
    } catch {
      setError("配音生成失败");
      setLoadingAction("");
      toast.error("网络错误，请重试");
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
        await fetchTaskHistory();
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

  const handleGenerateBgm = async () => {
    if (!dramaId || loadingAction === "bgm") return;
    setLoadingAction("bgm");

    try {
      const res = await fetch("/api/generate/bgm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        toast.success(data.message || "AI 背景音乐已生成");
        // 刷新 drama 数据以获取 bgmUrl
        await fetchEpisodes(false);
      } else {
        toast.error(data.error || "AI 配乐失败");
        if (data.code === "INSUFFICIENT_CREDITS") {
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
      const res = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dramaId,
          autoCompose: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchTaskHistory();
        if (data.taskId) {
          startTaskPolling(data.taskId, "compose");
          toast.success(data.message || "视频合成任务已启动");
          return;
        }
        setLoadingAction("");
        toast.warning("合成任务已启动，但未返回任务编号");
      } else {
        const errMsg = data.error || "视频合成失败";
        setError(errMsg);
        toast.error(errMsg);
        if (data.code === "INSUFFICIENT_CREDITS") {
          toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
        }
        setLoadingAction("");
      }
    } catch {
      setError("视频合成失败");
      toast.error("网络错误，请重试");
      setLoadingAction("");
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
        await fetchTaskHistory();
        toast.success(data.message || "AI 视频生成已启动");
        if (data.taskId) {
          startTaskPolling(data.taskId, "video");
        } else {
          setLoadingAction("");
          setTaskProgressLabel("");
          toast.warning("任务已启动，但未返回任务编号");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || "视频生成启动失败";
        setError(errMsg);
        setLoadingAction("");
        setTaskProgressLabel("");
        toast.error(errMsg);
        if (errData.code === "INSUFFICIENT_CREDITS") {
          toast.error("积分不足，请前往设置页面充值", { duration: 5000 });
        }
      }
    } catch {
      setError("视频生成失败");
      toast.error("网络错误，请重试");
      setLoadingAction("");
      setTaskProgressLabel("");
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

  const getActionLabel = () => {
    const activeLabel = activeProgress?.label || activeTask?.presentation?.summary || taskProgressLabel;
    if (loadingAction.startsWith("voiceover")) {
      if (activeLabel) return activeLabel;
      const isSingle = loadingAction.includes("-");
      return isSingle
        ? `正在生成第 ${displayActionProgress.current}/${displayActionProgress.total} 集配音...`
        : displayActionProgress.total > 0
          ? `正在生成配音... (${displayActionProgress.current}/${displayActionProgress.total})`
          : "正在生成配音...";
    }
    if (loadingAction === "compose") {
      if (activeLabel) return activeLabel;
      return displayActionProgress.total > 0
        ? `正在合成第 ${displayActionProgress.current}/${displayActionProgress.total} 集...`
        : "正在合成视频...";
    }
    if (loadingAction === "video-gen") {
      if (activeLabel) return activeLabel;
      return displayActionProgress.total > 0
        ? `AI 视频生成中... (${displayActionProgress.current}/${displayActionProgress.total})`
        : "AI 视频生成中...";
    }
    return "处理中...";
  };

  const displayActionProgress = activeProgress
    ? {
        current: activeProgress.completed || 0,
        total: activeProgress.total || 0,
      }
    : actionProgress;

  const formatTaskType = (type: string) => {
    if (type === "voiceover") return "配音";
    if (type === "compose") return "合成";
    if (type === "video") return "AI 视频";
    if (type === "storyboard") return "分镜";
    if (type === "script") return "剧本";
    return type;
  };

  const getPresentationToneClasses = (tone?: "neutral" | "warning" | "success" | "danger") => {
    if (tone === "success") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    if (tone === "danger") return "bg-red-500/10 text-red-400 border-red-500/30";
    if (tone === "neutral") return "bg-zinc-500/10 text-zinc-300 border-zinc-500/30";
    return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  };

  const formatTaskStatus = (status: string) => {
    if (status === "processing") return "进行中";
    if (status === "completed") return "已完成";
    if (status === "failed") return "失败";
    if (status === "cancelled") return "已取消";
    return status;
  };

  const formatTaskTime = (value?: string | null) => {
    if (!value) return "刚刚";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleRetryTask = async (task: TaskSummary) => {
    if (task.type === "voiceover") {
      await handleGenerateAllVoiceovers();
      return;
    }
    if (task.type === "compose") {
      await handleComposeAll();
      return;
    }
    if (task.type === "video") {
      await handleGenerateVideos();
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
      setLoadingAction("");
      setActionProgress({ current: 0, total: 0 });
      setTaskProgressLabel("");
      setActiveTaskId(null);
      await fetchTaskHistory();
      toast.success("任务已取消");
    } catch {
      setError("取消任务失败");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-14 sm:h-16 gap-2">
          <div className="flex items-center gap-3 w-full min-w-0">
            <Link href="/dashboard" className="shrink-0 text-muted-foreground hover:text-foreground transition" title="返回">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            </Link>
            <StepIndicator currentStep={3} steps={steps} />
          </div>
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
            🎬 配音完成后会自动合成预览视频，也可在此手动操作
          </p>
        </div>

        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-1">预览与导出 🎬</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">生成配音，系统将自动合成预览视频</p>
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
              {activeTaskId && (
                <Button variant="outline" size="sm" onClick={handleCancelTask}>
                  <Square className="h-3.5 w-3.5 mr-1.5" />
                  取消
                </Button>
              )}
            </div>
            {displayActionProgress.total > 0 && (
              <div className="w-full bg-emerald-500/20 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${(displayActionProgress.current / displayActionProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div className="mb-6 sm:mb-8 border border-border/50 rounded-lg p-4 sm:p-5 bg-card/40">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-semibold">最近任务</h2>
              <p className="text-xs text-muted-foreground">查看失败原因，也可以直接从这里重试</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void fetchTaskHistory()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              刷新
            </Button>
          </div>
          <div className="space-y-3">
            {taskHistory.length === 0 ? (
              <div className="text-sm text-muted-foreground">还没有任务记录，开始生成后会显示在这里。</div>
            ) : (
              taskHistory.map((task) => (
                <div
                  key={task.id}
                  className="border border-border/50 rounded-lg p-3 sm:p-4 bg-background/40"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline">
                          {task.presentation?.typeLabel || formatTaskType(task.type)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={getPresentationToneClasses(task.presentation?.statusTone)}
                        >
                          {task.presentation?.statusLabel || formatTaskStatus(task.status)}
                        </Badge>
                      </div>
                      {task.presentation?.summary && (
                        <p className="text-xs sm:text-sm text-foreground/80">{task.presentation.summary}</p>
                      )}
                      {task.presentation?.stageLabel && task.status === "processing" && (
                        <p className="mt-1 text-xs text-amber-400">{task.presentation.stageLabel}</p>
                      )}
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>
                          {formatTaskTime(task.startedAt)}
                          {task.completedAt ? ` -> ${formatTaskTime(task.completedAt)}` : ""}
                        </span>
                        {typeof task.presentation?.durationMs === "number" && task.presentation.durationMs > 0 && (
                          <span>· {Math.max(1, Math.round(task.presentation.durationMs / 1000))} 秒</span>
                        )}
                        {task.presentation?.creditsUsed ? (
                          <span>· 已扣 {task.presentation.creditsUsed} 积分</span>
                        ) : null}
                      </div>
                      {task.errorMessage && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs sm:text-sm text-red-400">
                            {task.presentation?.failureTitle || task.errorMessage}
                          </p>
                          <p className="text-xs text-muted-foreground">{task.errorMessage}</p>
                          {task.presentation?.failureHint && (
                            <p className="text-xs text-muted-foreground">{task.presentation.failureHint}</p>
                          )}
                        </div>
                      )}
                    </div>
                    {(task.type === "voiceover" || task.type === "compose" || task.type === "video") && task.status !== "processing" && task.presentation?.retryable !== false && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRetryTask(task)}
                        disabled={Boolean(loadingAction)}
                        className="sm:self-start"
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        重试
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <Tabs defaultValue="preview" className="space-y-4 sm:space-y-6">
          {/* Tabs — horizontally scrollable on mobile */}
          <TabsList className="bg-muted/30 w-full overflow-x-auto flex h-auto p-1 gap-1">
            <TabsTrigger value="preview" className="inline-flex items-center gap-1.5 shrink-0 min-h-[40px] text-xs sm:text-sm px-3 sm:px-4">📹 视频预览</TabsTrigger>
            <TabsTrigger value="voiceover" className="inline-flex items-center gap-1.5 shrink-0 min-h-[40px] text-xs sm:text-sm px-3 sm:px-4">🎙️ 配音管理</TabsTrigger>
            <TabsTrigger value="compose" className="inline-flex items-center gap-1.5 shrink-0 min-h-[40px] text-xs sm:text-sm px-3 sm:px-4">⚙️ 高级选项</TabsTrigger>
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
                    const shots = Array.isArray(ep.shotData) ? ep.shotData : [];
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
                      {displayActionProgress.total > 0
                        ? `AI 视频生成中 ${displayActionProgress.current}/${displayActionProgress.total} 集...`
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

              {/* AI BGM 自动配乐 */}
              <div className="border border-emerald-500/30 rounded-lg p-4 sm:p-6 bg-emerald-500/5">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="h-5 w-5 text-emerald-400" />
                  <h3 className="font-semibold text-sm sm:text-base">AI 自动配乐</h3>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mb-2">
                  根据剧情情绪自动生成背景音乐，合成视频时将自动混入
                </p>
                <Button
                  onClick={handleGenerateBgm}
                  disabled={loadingAction === "bgm"}
                  variant="outline"
                  className="min-h-[40px] w-full sm:w-auto border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  {loadingAction === "bgm" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      AI 配乐中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      AI 自动配乐
                    </>
                  )}
                </Button>
              </div>

              {/* Video composition with options */}
              <div className="border border-border/50 rounded-lg p-4 sm:p-6 bg-card/50">
                <div className="flex items-center gap-2 mb-3">
                  <Film className="h-5 w-5 text-emerald-400" />
                  <h3 className="font-semibold text-sm sm:text-base">视频合成</h3>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                  将分镜画面和配音合成为完整剧集视频，支持转场效果和真实视频素材。
                </p>

                {/* Material source selector */}
                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">素材来源</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMaterialSource("ai")}
                      className={`flex-1 px-3 py-2.5 rounded-lg border text-xs sm:text-sm font-medium transition-all ${
                        materialSource === "ai"
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                          : "border-border/50 bg-card/30 text-muted-foreground hover:border-border"
                      }`}
                    >
                      🎨 AI 生图
                    </button>
                    <button
                      onClick={() => setMaterialSource("pexels")}
                      className={`flex-1 px-3 py-2.5 rounded-lg border text-xs sm:text-sm font-medium transition-all ${
                        materialSource === "pexels"
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                          : "border-border/50 bg-card/30 text-muted-foreground hover:border-border"
                      }`}
                    >
                      🎬 真实视频
                    </button>
                  </div>
                  {materialSource === "pexels" && (
                    <p className="text-xs text-amber-400 mt-2">⚡ 根据镜头描述自动搜索 Pexels 真实视频素材</p>
                  )}
                </div>

                {/* Transition selector */}
                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">镜头转场效果</label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {[
                      { value: "fade", label: "渐变" },
                      { value: "fadeblack", label: "黑场" },
                      { value: "fadewhite", label: "白场" },
                      { value: "slideleft", label: "左滑" },
                      { value: "slideright", label: "右滑" },
                      { value: "wipeleft", label: "左擦" },
                      { value: "wiperight", label: "右擦" },
                      { value: "dissolve", label: "溶解" },
                      { value: "circleopen", label: "圆开" },
                      { value: "none", label: "无" },
                    ].map((t) => (
                      <button
                        key={t.value}
                        onClick={() => setTransition(t.value)}
                        className={`px-2 py-2 rounded-md border text-xs font-medium transition-all ${
                          transition === t.value
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                            : "border-border/50 bg-card/30 text-muted-foreground hover:border-border"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Transition duration slider */}
                {transition !== "none" && (
                  <div className="mb-4">
                    <label className="text-xs font-medium text-muted-foreground mb-2 flex justify-between">
                      <span>转场时长</span>
                      <span className="text-emerald-400">{transitionDuration.toFixed(1)}s</span>
                    </label>
                    <input
                      type="range"
                      min="0.3"
                      max="2"
                      step="0.1"
                      value={transitionDuration}
                      onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>0.3s 快</span>
                      <span>2s 慢</span>
                    </div>
                  </div>
                )}

                {/* Episode status */}
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
                      {materialSource === "pexels" ? "合成（真实视频）" : "合成所有集"}
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
