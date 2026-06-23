"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AspectRatioSelector } from "@/components/create/aspect-ratio-selector";
import { toast } from "sonner";
import {
  Sparkles,
  Play,
  Download,
  Share2,
  RotateCcw,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Zap,
  Film,
  FileText,
  Image,
  Mic,
  Video,
  ArrowLeft,
  Copy,
} from "lucide-react";
import type { DramaGenreType, DramaStyleType } from "@/types/drama";

/* ─── Types ─── */

interface Template {
  id: string;
  name: string;
  description: string;
  emoji: string;
  tags: string[];
  theme: string;
  genre: string;
  style: string;
  episodeCount: number;
}

type Step = 1 | 2 | 3 | 4;

interface GenProgress {
  phase: "script" | "storyboard" | "voiceover" | "subtitle" | "done" | "idle";
  currentEpisode: number;
  totalEpisodes: number;
  currentShot: number;
  totalShots: number;
  message: string;
  error: string | null;
}

/* ─── Constants ─── */

const GENRE_OPTIONS: { value: DramaGenreType; label: string; emoji: string }[] = [
  { value: "romance", label: "爱情", emoji: "💕" },
  { value: "mystery", label: "悬疑", emoji: "🔍" },
  { value: "comedy", label: "喜剧", emoji: "😂" },
  { value: "scifi", label: "科幻", emoji: "🚀" },
  { value: "horror", label: "恐怖", emoji: "👻" },
];

const STYLE_OPTIONS: { value: DramaStyleType; label: string; emoji: string }[] = [
  { value: "realistic", label: "写实", emoji: "📷" },
  { value: "anime", label: "动漫", emoji: "🎌" },
  { value: "ink", label: "水墨", emoji: "🖌️" },
  { value: "cyberpunk", label: "赛博朋克", emoji: "🌃" },
];

const PHASE_META: Record<
  string,
  { icon: typeof Sparkles; label: string }
> = {
  script: { icon: FileText, label: "剧本" },
  storyboard: { icon: Image, label: "分镜" },
  voiceover: { icon: Mic, label: "配音" },
  subtitle: { icon: Film, label: "字幕" },
  done: { icon: CheckCircle2, label: "完成" },
};

/* ─── Component ─── */

export default function QuickCreatePage() {
  /* Step state */
  const [step, setStep] = useState<Step>(1);

  /* Step 1: Input */
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState<DramaGenreType | "">("");
  const [style, setStyle] = useState<DramaStyleType | "">("");
  const [aspectRatio, setAspectRatio] = useState<"landscape" | "vertical">("vertical");
  const [episodeCount, setEpisodeCount] = useState(3);

  /* Templates */
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  /* Step 3: Generation */
  const [dramaId, setDramaId] = useState("");
  const [progress, setProgress] = useState<GenProgress>({
    phase: "idle",
    currentEpisode: 0,
    totalEpisodes: 0,
    currentShot: 0,
    totalShots: 0,
    message: "",
    error: null,
  });
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef(false);

  /* Step 4: Result */
  const [videoUrl, setVideoUrl] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  /* Fetch templates on mount */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/templates");
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates || []);
        }
      } catch {
        // non-critical
      } finally {
        setTemplatesLoaded(true);
      }
    })();
  }, []);

  /* Can advance from step 1 */
  const canAdvanceStep1 = theme.trim().length > 0 && genre !== "" && style !== "";

  /* Can start generation from step 2 */
  const canGenerate = canAdvanceStep1 && episodeCount >= 1 && episodeCount <= 5;

  /* ── Select template ── */
  const selectTemplate = (t: Template) => {
    setTheme(t.theme);
    setGenre(t.genre as DramaGenreType);
    setStyle(t.style as DramaStyleType);
    setEpisodeCount(Math.min(t.episodeCount, 5));
  };

  /* ── Poll drama status during generation ── */
  const pollDramaStatus = useCallback(async (id: string): Promise<void> => {
    if (abortRef.current) return;

    try {
      const res = await fetch(`/api/dramas/${id}`);
      if (!res.ok) {
        if (res.status === 401) {
          setProgress((p) => ({ ...p, error: "登录已过期，请重新登录" }));
          return;
        }
        return; // retry on next poll
      }
      const data = await res.json();
      const drama = data.drama;

      const status = drama.status;
      const episodes = drama.episodes || [];
      const totalEp = episodeCount;

      if (status === "error" || status === "生成失败") {
        setProgress((p) => ({
          ...p,
          error: drama.errorMessage || "生成过程中出现错误",
        }));
        return;
      }

      // Determine current phase
      if (status === "script_ready") {
        setProgress({
          phase: "storyboard",
          currentEpisode: 0,
          totalEpisodes: totalEp,
          currentShot: 0,
          totalShots: 0,
          message: "正在生成分镜图片…",
          error: null,
        });
      } else if (status === "storyboard_ready") {
        setProgress({
          phase: "voiceover",
          currentEpisode: 0,
          totalEpisodes: totalEp,
          currentShot: 0,
          totalShots: 0,
          message: "正在生成配音…",
          error: null,
        });
      } else if (status === "voiceover_ready") {
        setProgress({
          phase: "subtitle",
          currentEpisode: 0,
          totalEpisodes: totalEp,
          currentShot: 0,
          totalShots: 0,
          message: "正在生成字幕…",
          error: null,
        });
      } else if (status === "completed") {
        // Find first episode with video
        const epWithVideo = episodes.find((ep: { videoUrl: string | null }) => ep.videoUrl);
        if (epWithVideo?.videoUrl) {
          setVideoUrl(epWithVideo.videoUrl);
        }
        setProgress({
          phase: "done",
          currentEpisode: totalEp,
          totalEpisodes: totalEp,
          currentShot: 0,
          totalShots: 0,
          message: "全部完成！",
          error: null,
        });
        setGenerating(false);
        setStep(4);
        toast.success("🎉 短剧生成完成！");
        return;
      }
    } catch {
      // network error — will retry
    }

    if (!abortRef.current) {
      setTimeout(() => pollDramaStatus(id), 3000);
    }
  }, [episodeCount]);

  /* ── Start full generation pipeline ── */
  const startGeneration = async () => {
    setGenerating(true);
    setProgress({
      phase: "script",
      currentEpisode: 1,
      totalEpisodes: episodeCount,
      currentShot: 0,
      totalShots: 0,
      message: "正在创建短剧项目…",
      error: null,
    });
    setStep(3);
    abortRef.current = false;

    try {
      // 1. Create drama
      const dramaRes = await fetch("/api/dramas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: theme.slice(0, 20) + (theme.length > 20 ? "…" : ""),
          description: theme,
          theme,
          genre,
          style,
          episodeCount,
          aspectRatio,
        }),
      });

      if (!dramaRes.ok) {
        const errData = await dramaRes.json();
        if (dramaRes.status === 401) {
          setProgress((p) => ({ ...p, error: "未登录，请先登录" }));
          setGenerating(false);
          return;
        }
        throw new Error(errData.error || "创建短剧失败");
      }

      const dramaData = await dramaRes.json();
      const id = dramaData.drama.id;
      setDramaId(id);

      setProgress((p) => ({
        ...p,
        message: "正在生成剧本…",
      }));

      // 2. Generate script
      const scriptRes = await fetch("/api/generate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId: id }),
      });

      if (!scriptRes.ok) {
        const errData = await scriptRes.json();
        throw new Error(errData.error || "剧本生成失败");
      }

      setProgress((p) => ({
        ...p,
        phase: "storyboard",
        message: "正在生成分镜图片…",
        currentEpisode: 1,
      }));

      // 3. Generate storyboard
      const sbRes = await fetch("/api/generate/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId: id }),
      });

      if (!sbRes.ok) {
        const errData = await sbRes.json();
        throw new Error(errData.error || "分镜生成失败");
      }

      setProgress((p) => ({
        ...p,
        phase: "voiceover",
        message: "正在生成配音…",
      }));

      // 4. Generate voiceover
      const voRes = await fetch("/api/generate/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId: id }),
      });

      if (!voRes.ok) {
        const errData = await voRes.json();
        throw new Error(errData.error || "配音生成失败");
      }

      setProgress((p) => ({
        ...p,
        phase: "subtitle",
        message: "正在生成字幕…",
      }));

      // 5. Generate subtitle
      const subRes = await fetch("/api/generate/subtitle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId: id }),
      });

      if (!subRes.ok) {
        const errData = await subRes.json();
        // Subtitle failure is non-critical
        setProgress((p) => ({
          ...p,
          message: "字幕生成跳过，正在完成…",
        }));
      } else {
        setProgress((p) => ({
          ...p,
          message: "全部完成！",
        }));
      }

      // 6. Mark as completed and transition to Step 4
      setProgress({
        phase: "done",
        currentEpisode: episodeCount,
        totalEpisodes: episodeCount,
        currentShot: 0,
        totalShots: 0,
        message: "全部完成！",
        error: null,
      });
      setGenerating(false);
      setStep(4);
      toast.success("🎉 短剧生成完成！");

      // Fetch the drama to get video URL
      try {
        const fetchRes = await fetch(`/api/dramas/${id}`);
        if (fetchRes.ok) {
          const fetchData = await fetchRes.json();
          const episodes = fetchData.drama?.episodes || [];
          const epWithVideo = episodes.find(
            (ep: { videoUrl: string | null }) => ep.videoUrl
          );
          if (epWithVideo?.videoUrl) {
            setVideoUrl(epWithVideo.videoUrl);
          }
        }
      } catch {
        // non-critical
      }
    } catch (err) {
      setProgress((p) => ({
        ...p,
        error: err instanceof Error ? err.message : "生成过程中出现错误",
      }));
      setGenerating(false);
      toast.error("生成失败");
    }
  };

  /* ── Retry current step ── */
  const retryGeneration = () => {
    setProgress((p) => ({ ...p, error: null }));
    startGeneration();
  };

  /* ── Share ── */
  const handleShare = async () => {
    if (!dramaId) return;
    try {
      const res = await fetch(`/api/dramas/${dramaId}/share`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setShareUrl(data.shareUrl);
        await navigator.clipboard.writeText(data.shareUrl);
        toast.success("分享链接已复制！");
      }
    } catch {
      toast.error("生成分享链接失败");
    }
  };

  /* ── Download ── */
  const handleDownload = () => {
    if (videoUrl) {
      window.open(videoUrl, "_blank");
    }
  };

  /* ── Reset ── */
  const handleReset = () => {
    setStep(1);
    setTheme("");
    setGenre("");
    setStyle("");
    setAspectRatio("vertical");
    setEpisodeCount(3);
    setDramaId("");
    setVideoUrl("");
    setShareUrl("");
    setProgress({
      phase: "idle",
      currentEpisode: 0,
      totalEpisodes: 0,
      currentShot: 0,
      totalShots: 0,
      message: "",
      error: null,
    });
    setGenerating(false);
    abortRef.current = false;
  };

  /* ── Progress percentage ── */
  const getProgressPercent = () => {
    const phases = ["script", "storyboard", "voiceover", "subtitle"];
    const idx = phases.indexOf(progress.phase);
    if (idx === -1) return progress.phase === "done" ? 100 : 0;
    return Math.round(((idx + 1) / phases.length) * 100);
  };

  /* ── Step indicator component ── */
  const StepDots = () => (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            step >= s
              ? "bg-emerald-500 w-6"
              : "bg-zinc-700 w-1.5"
          }`}
        />
      ))}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════ */
  /*  STEP 1: Select template / input idea                            */
  /* ══════════════════════════════════════════════════════════════ */
  if (step === 1) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
            <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-100 transition">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium">一键创作</span>
            </div>
            <StepDots />
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
          {/* Title */}
          <div>
            <h1 className="text-xl font-bold mb-1">选择模板或输入创意 ✨</h1>
            <p className="text-sm text-zinc-400">
              选择一个热门模板快速开始，或描述你自己的故事
            </p>
          </div>

          {/* Template cards - horizontal scroll */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              热门模板
            </p>
            {!templatesLoaded ? (
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="shrink-0 w-40 h-28 rounded-xl bg-zinc-800/50 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory scrollbar-none">
                {templates.map((t) => {
                  const isSelected =
                    theme === t.theme && genre === t.genre && style === t.style;
                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTemplate(t)}
                      className={`shrink-0 snap-start w-40 p-3 rounded-xl border transition-all text-left group ${
                        isSelected
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-zinc-800 bg-zinc-900/50 hover:border-emerald-500/40 hover:bg-emerald-500/5"
                      }`}
                    >
                      <span className="text-2xl block mb-2">{t.emoji}</span>
                      <p className="text-sm font-medium text-emerald-400 mb-0.5">
                        {t.name}
                      </p>
                      <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                        {t.description}
                      </p>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {t.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-xs text-zinc-500">或自定义</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          {/* Manual input */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">创意描述</label>
              <textarea
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="描述你想要的短剧内容，越详细越好…"
                rows={3}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 resize-none transition"
              />
            </div>

            {/* Genre */}
            <div className="space-y-2">
              <label className="text-sm font-medium">类型</label>
              <div className="flex flex-wrap gap-2">
                {GENRE_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setGenre(genre === g.value ? "" : g.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                      genre === g.value
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                        : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {g.emoji} {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect ratio */}
            <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
          </div>

          {/* Next button */}
          <Button
            onClick={() => setStep(2)}
            disabled={!canAdvanceStep1}
            className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-500 text-base font-medium rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一步：风格与集数
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </main>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════ */
  /*  STEP 2: Style + episode count + generate                      */
  /* ══════════════════════════════════════════════════════════════ */
  if (step === 2) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
            <button
              onClick={() => setStep(1)}
              className="text-zinc-400 hover:text-zinc-100 transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium">一键创作</span>
            </div>
            <StepDots />
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
          {/* Summary */}
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-3">
            <p className="text-sm font-medium text-emerald-400">📋 创作概要</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <span className="text-zinc-500">创意</span>
              <span className="text-zinc-200 line-clamp-2">{theme}</span>
              <span className="text-zinc-500">类型</span>
              <span className="text-zinc-200">
                {GENRE_OPTIONS.find((g) => g.value === genre)?.emoji}{" "}
                {GENRE_OPTIONS.find((g) => g.value === genre)?.label}
              </span>
              <span className="text-zinc-500">比例</span>
              <span className="text-zinc-200">
                {aspectRatio === "landscape" ? "横屏 16:9" : "竖屏 9:16"}
              </span>
            </div>
          </div>

          {/* Style */}
          <div className="space-y-3">
            <label className="text-sm font-medium">🎨 画面风格</label>
            <div className="grid grid-cols-2 gap-3">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStyle(s.value)}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                    style === s.value
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-emerald-500/30"
                  }`}
                >
                  <span className="text-2xl">{s.emoji}</span>
                  <span className="text-sm font-medium">{s.label}</span>
                  {style === s.value && (
                    <CheckCircle2 className="w-4 h-4 ml-auto" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Episode count */}
          <div className="space-y-3">
            <label className="text-sm font-medium">🎬 集数</label>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setEpisodeCount(n)}
                  className={`flex-1 h-12 rounded-xl border-2 text-sm font-medium transition-all ${
                    episodeCount === n
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {n} 集
                </button>
              ))}
            </div>
          </div>

          {/* Start button */}
          <Button
            onClick={startGeneration}
            disabled={!canGenerate}
            className="w-full min-h-[56px] bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-base font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            开始生成
          </Button>

          <p className="text-center text-xs text-zinc-500">
            将自动完成剧本 → 分镜 → 配音 → 字幕全流程
          </p>
        </main>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════ */
  /*  STEP 3: Auto-generation progress                               */
  /* ══════════════════════════════════════════════════════════════ */
  if (step === 3) {
    const pct = getProgressPercent();
    const phases = ["script", "storyboard", "voiceover", "subtitle"];
    const currentPhaseIdx = phases.indexOf(progress.phase);

    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
            <div className="text-zinc-400">
              <Zap className="w-4 h-4 text-emerald-400 inline mr-2" />
              <span className="text-sm font-medium">生成中</span>
            </div>
            <StepDots />
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-4 py-10 flex flex-col items-center">
          {/* Animated spinner */}
          <div className="relative mb-8">
            <div className="w-32 h-32 rounded-full border-4 border-zinc-800" />
            <div
              className="absolute inset-0 w-32 h-32 rounded-full border-4 border-transparent border-t-emerald-500 animate-spin"
              style={{
                clipPath: `inset(0 0 ${100 - pct}% 0)`,
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-emerald-400">{pct}%</span>
            </div>
          </div>

          {/* Phase list */}
          <div className="w-full space-y-3 mb-8">
            {phases.map((phase, idx) => {
              const meta = PHASE_META[phase];
              const Icon = meta.icon;
              const isActive = phase === progress.phase;
              const isDone = idx < currentPhaseIdx || progress.phase === "done";
              const isPending = idx > currentPhaseIdx && progress.phase !== "done";

              return (
                <div
                  key={phase}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    isActive
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : isDone
                      ? "border-zinc-800 bg-zinc-900/50"
                      : "border-zinc-800/50 bg-zinc-900/30 opacity-50"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isDone
                        ? "bg-emerald-500/20 text-emerald-400"
                        : isActive
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-zinc-800 text-zinc-600"
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : isActive ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{meta.label}</p>
                    {isActive && progress.message && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {progress.message}
                      </p>
                    )}
                  </div>
                  {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500/50" />}
                </div>
              );
            })}
          </div>

          {/* Error state */}
          {progress.error && (
            <div className="w-full p-4 rounded-xl border border-red-500/30 bg-red-500/5 mb-4">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-red-400">{progress.error}</p>
                </div>
              </div>
              <Button
                onClick={retryGeneration}
                variant="outline"
                className="mt-3 border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
                size="sm"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                重试
              </Button>
            </div>
          )}

          {/* Back to dashboard link */}
          {!generating && !progress.error && (
            <Link
              href="/dashboard"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition mt-4"
            >
              返回首页
            </Link>
          )}
        </main>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════ */
  /*  STEP 4: Complete — preview & actions                            */
  /* ══════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
          <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-100 transition">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium">创作完成</span>
          </div>
          <div className="w-16" /> {/* spacer for centering */}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* Success message */}
        <div className="text-center py-4">
          <div className="text-4xl mb-3">🎉</div>
          <h1 className="text-xl font-bold mb-1">短剧创作完成！</h1>
          <p className="text-sm text-zinc-400">
            你的短剧已经生成完毕，可以预览、下载或分享
          </p>
        </div>

        {/* Video preview */}
        {videoUrl ? (
          <div className="rounded-xl overflow-hidden border border-zinc-800 bg-black">
            <video
              src={videoUrl}
              controls
              className="w-full aspect-video"
              playsInline
              preload="metadata"
            />
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <Video className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">视频暂未生成</p>
            <p className="text-xs text-zinc-600 mt-1">
              你可以前往
              <Link
                href={`/create/storyboard?dramaId=${dramaId}`}
                className="text-emerald-400 hover:text-emerald-300 ml-1"
              >
                分镜页面
              </Link>
              手动合成视频
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          {videoUrl && (
            <>
              <Button
                onClick={handleDownload}
                variant="outline"
                className="h-12 rounded-xl border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
              >
                <Download className="w-4 h-4 mr-2" />
                下载视频
              </Button>
              <Button
                onClick={handleShare}
                variant="outline"
                className="h-12 rounded-xl border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
              >
                {shareUrl ? (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    复制链接
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4 mr-2" />
                    分享
                  </>
                )}
              </Button>
            </>
          )}
        </div>

        {/* Share URL display */}
        {shareUrl && (
          <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
            <p className="text-xs text-zinc-500 mb-1">分享链接</p>
            <p className="text-sm text-emerald-400 break-all">{shareUrl}</p>
          </div>
        )}

        {/* Go to drama page */}
        <Button
          asChild
          variant="outline"
          className="w-full h-12 rounded-xl border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
        >
          <Link href={`/create/storyboard?dramaId=${dramaId}`}>
            <Play className="w-4 h-4 mr-2" />
            在编辑器中查看
          </Link>
        </Button>

        {/* Create another */}
        <Button
          onClick={handleReset}
          className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          再来一条
        </Button>
      </main>
    </div>
  );
}
