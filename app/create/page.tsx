"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeInput } from "@/components/create/theme-input";
import { StyleSelector } from "@/components/create/style-selector";
import { EpisodeCounter } from "@/components/create/episode-counter";
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
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState<DramaGenreType | "">("");
  const [style, setStyle] = useState<DramaStyleType | "">("");
  const [episodeCount, setEpisodeCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      router.push(`/create/script?dramaId=${data.drama.id}`);
    } catch {
      setError("创建失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 h-16">
          <StepIndicator currentStep={1} steps={steps} />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">开始你的创作 ✨</h1>
          <p className="text-muted-foreground">
            告诉我们你的创意，AI 将为你打造一部精彩短剧
          </p>
        </div>

        <div className="space-y-8">
          <ThemeInput value={theme} onChange={setTheme} />

          <StyleSelector
            genre={genre}
            style={style}
            onGenreChange={(v) => setGenre(v)}
            onStyleChange={(v) => setStyle(v)}
          />

          <EpisodeCounter value={episodeCount} onChange={setEpisodeCount} />

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded p-3">
              {error}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleCreate}
              disabled={!canSubmit || loading}
              className="bg-emerald-600 hover:bg-emerald-500 px-8"
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
