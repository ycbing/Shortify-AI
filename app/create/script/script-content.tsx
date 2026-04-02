"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { ScriptEditor } from "@/components/drama/script-editor";
import { Loader2, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import type { GeneratedEpisode } from "@/types/drama";
import Link from "next/link";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜" },
  { number: 4, title: "预览" },
];

export default function ScriptPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dramaId = searchParams.get("dramaId");

  const [episodes, setEpisodes] = useState<GeneratedEpisode[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const fetchScript = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setTitle(data.drama.title);

        if (data.episodes.length > 0) {
          setEpisodes(
            data.episodes.map((ep: { episodeNumber: number; title: string; scriptContent: string; narrationText: string; duration: number }) => {
              let script = {};
              try {
                script = JSON.parse(ep.scriptContent || "{}");
              } catch {}
              return {
                episodeNumber: ep.episodeNumber,
                title: ep.title || `第${ep.episodeNumber}集`,
                narration: ep.narrationText || "",
                sceneDescription: (script as Record<string, string>).sceneDescription || "",
                dialogues: (script as Record<string, { character: string; line: string }[]>).dialogues || [],
                duration: ep.duration || 30,
              };
            })
          );
          setLoading(false);
          return;
        }
      }
    } catch {
      // ignore
    }

    // Auto-generate script
    setLoading(false);
    handleGenerate();
  }, [dramaId]);

  useEffect(() => {
    if (!dramaId) {
      router.push("/create");
      return;
    }
    fetchScript();
  }, [dramaId]);

  const handleGenerate = async () => {
    if (!dramaId) return;
    setGenerating(true);
    setError("");

    try {
      const res = await fetch("/api/generate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dramaId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "生成失败");
        return;
      }

      setTitle(data.script.title);
      setEpisodes(data.script.episodes);
    } catch {
      setError("剧本生成失败，请稍后重试");
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdate = (index: number, data: GeneratedEpisode) => {
    setEpisodes((prev) => prev.map((ep, i) => (i === index ? data : ep)));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 h-16">
          <StepIndicator currentStep={2} steps={steps} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">AI 剧本 ✍️</h1>
          {title && (
            <p className="text-muted-foreground">《{title}》- 共 {episodes.length} 集</p>
          )}
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-400 bg-red-500/10 rounded p-3">{error}</div>
        )}

        {generating ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mb-4" />
            <p className="text-muted-foreground">AI 正在创作剧本...</p>
            <p className="text-xs text-muted-foreground mt-2">通常需要 10-30 秒</p>
          </div>
        ) : episodes.length > 0 ? (
          <>
            <ScriptEditor
              episodes={episodes}
              onUpdate={handleUpdate}
              editable
            />

            <div className="flex justify-between mt-8">
              <Link href="/create">
                <Button variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  上一步
                </Button>
              </Link>
              <Link href={`/create/storyboard?dramaId=${dramaId}`}>
                <Button className="bg-emerald-600 hover:bg-emerald-500">
                  下一步：生成分镜
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <Sparkles className="h-8 w-8 text-emerald-400 mb-4" />
            <p className="mb-4">点击按钮让 AI 为你创作剧本</p>
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-emerald-600 hover:bg-emerald-500"
            >
              {generating ? "生成中..." : "生成剧本"}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
