"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeInput } from "@/components/create/theme-input";
import { StyleSelector } from "@/components/create/style-selector";
import { EpisodeCounter } from "@/components/create/episode-counter";
import { BgmUpload } from "@/components/create/bgm-upload";
import { StepIndicator } from "@/components/create/step-indicator";
import { Loader2, Sparkles } from "lucide-react";
import type { DramaGenreType, DramaStyleType } from "@/types/drama";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜" },
  { number: 4, title: "预览" },
];

export default function CreatePage() {
  return (
    <Suspense>
      <CreatePageContent />
    </Suspense>
  );
}

function CreatePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState<DramaGenreType | "">("");
  const [style, setStyle] = useState<DramaStyleType | "">("");
  const [episodeCount, setEpisodeCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bgmFile, setBgmFile] = useState<File | null>(null);

  // Pre-fill from URL params (template links)
  useEffect(() => {
    const pTheme = searchParams.get("theme");
    const pGenre = searchParams.get("genre");
    const pStyle = searchParams.get("style");
    if (pTheme) setTheme(pTheme);
    if (pGenre) setGenre(pGenre as DramaGenreType);
    if (pStyle) setStyle(pStyle as DramaStyleType);
  }, [searchParams]);

  const canSubmit = theme.trim().length > 0 && genre !== "" && style !== "";

  const handleCreate = async () => {
    if (!canSubmit) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/dramas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: theme.slice(0, 20) + (theme.length > 20 ? "..." : ""),
          description: theme,
          theme,
          genre,
          style,
          episodeCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "创建失败");
        return;
      }

      const dramaId = data.drama.id;

      // Upload BGM if file was selected
      if (bgmFile) {
        try {
          const formData = new FormData();
          formData.append("file", bgmFile);
          formData.append("dramaId", dramaId);

          const bgmRes = await fetch("/api/upload-bgm", {
            method: "POST",
            body: formData,
          });

          if (bgmRes.ok) {
            const bgmData = await bgmRes.json();
            // Update drama with bgmUrl
            await fetch(`/api/dramas/${dramaId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bgmUrl: bgmData.bgmUrl }),
            });
          }
        } catch {
          // BGM upload failed, not critical
          console.warn("BGM upload failed, continuing without BGM");
        }
      }

      router.push(`/create/script?dramaId=${dramaId}`);
    } catch {
      setError("创建失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-14 sm:h-16">
          <StepIndicator currentStep={1} steps={steps} />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
        {/* Step hint */}
        <div className="mb-6 sm:mb-8 p-3 sm:p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-xs sm:text-sm text-emerald-400">
            💡 描述你的短剧主题、类型和风格，AI 将根据你的创意创作剧本
          </p>
        </div>

        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-2">开始你的创作 ✨</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            告诉我们你的创意，AI 将为你打造一部精彩短剧
          </p>
        </div>

        <div className="space-y-6 sm:space-y-8">
          <ThemeInput value={theme} onChange={setTheme} />

          <StyleSelector
            genre={genre}
            style={style}
            onGenreChange={(v) => setGenre(v)}
            onStyleChange={(v) => setStyle(v)}
          />

          <EpisodeCounter value={episodeCount} onChange={setEpisodeCount} />

          {/* BGM Upload — saves file to state, uploads after drama creation */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              🎵 背景音乐（可选）
            </label>
            <p className="text-xs text-muted-foreground">
              上传 MP3 或 WAV 文件，视频合成时将自动混入背景音
            </p>
            {bgmFile ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{bgmFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(bgmFile.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBgmFile(null)}
                  className="shrink-0 h-9 w-9 p-0 text-muted-foreground hover:text-red-400"
                >
                  <span className="h-4 w-4 flex items-center justify-center text-lg leading-none">×</span>
                </Button>
              </div>
            ) : (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && /\.(mp3|wav)$/i.test(file.name) && file.size <= 20 * 1024 * 1024) {
                    setBgmFile(file);
                  } else {
                    setError("请上传 MP3 或 WAV 格式的音频文件（最大 20MB）");
                  }
                }}
                onClick={() => document.getElementById("bgm-file-input")?.click()}
                className="border-2 border-dashed border-border/50 rounded-lg p-4 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
              >
                <input
                  id="bgm-file-input"
                  type="file"
                  accept=".mp3,.wav"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (!/\.(mp3|wav)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
                        setError("请上传 MP3 或 WAV 格式的音频文件（最大 20MB）");
                        return;
                      }
                      setBgmFile(file);
                    }
                  }}
                />
                <p className="text-sm text-muted-foreground">点击或拖拽上传音乐文件</p>
                <p className="text-xs text-muted-foreground/60 mt-1">支持 MP3、WAV，最大 20MB</p>
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded p-3">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
            <Button
              onClick={handleCreate}
              disabled={!canSubmit || loading}
              className="bg-emerald-600 hover:bg-emerald-500 px-8 min-h-[44px] sm:w-auto w-full"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  下一步：生成剧本
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
