"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { ScriptEditor } from "@/components/drama/script-editor";
import { Loader2, ArrowRight, ArrowLeft, Sparkles, Users, Film } from "lucide-react";
import type { GeneratedEpisode, GeneratedScriptV2, Shot, Character, ShotAudio } from "@/types/drama";
import { isScriptV2, VOICE_OPTIONS } from "@/types/drama";
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
  const [scriptV2, setScriptV2] = useState<GeneratedScriptV2 | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
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

        // Check if V2 format (drama has characters or episodes have shotData)
        const dramaChars = data.drama.characters;
        const hasShots = (data.episodes || []).some(
          (ep: { shotData: unknown }) => ep.shotData && Array.isArray(ep.shotData)
        );

        if (hasShots && dramaChars) {
          // V2 format
          setScriptV2({
            title: data.drama.title,
            characters: dramaChars,
            episodes: data.episodes.map(
              (ep: { episodeNumber: number; title: string; shotData: Shot[]; scriptContent: string; narrationText: string; duration: number }) => ({
                episodeNumber: ep.episodeNumber,
                title: ep.title || `第${ep.episodeNumber}集`,
                sceneDescription: (() => {
                  try {
                    return JSON.parse(ep.scriptContent || "{}").sceneDescription || "";
                  } catch {
                    return "";
                  }
                })(),
                shots: ep.shotData || [],
              })
            ),
          });
          setCharacters(dramaChars);

          // Also build legacy episodes for the editor
          setEpisodes(
            data.episodes.map(
              (ep: { episodeNumber: number; title: string; scriptContent: string; narrationText: string; duration: number }) => {
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
              }
            )
          );
        } else if (data.episodes.length > 0) {
          // V1 legacy format
          setEpisodes(
            data.episodes.map(
              (ep: { episodeNumber: number; title: string; scriptContent: string; narrationText: string; duration: number }) => {
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
              }
            )
          );
        }

        setLoading(false);
        return;
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

      if (isScriptV2(data.script)) {
        setScriptV2(data.script);
        setCharacters(data.script.characters);
      }

      setEpisodes(data.script.episodes);
    } catch {
      setError("剧本生成失败，请稍后重试");
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdate = (index: number, data: unknown) => {
    setEpisodes((prev) => prev.map((ep, i) => (i === index ? (data as typeof ep) : ep)));
  };

  // Get voice label from voiceId
  const getVoiceLabel = (voiceId: string) => {
    for (const [label, id] of Object.entries(VOICE_OPTIONS)) {
      if (id === voiceId) return label;
    }
    return voiceId;
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
            <p className="text-muted-foreground">《{title}》- 共 {scriptV2 ? scriptV2.episodes.length : episodes.length} 集</p>
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
        ) : scriptV2 ? (
          <>
            {/* V2 Format: Characters + Shots Timeline */}
            <div className="space-y-8">
              {/* Character Cards */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Users className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-lg font-semibold">角色列表</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {scriptV2.characters.map((char, idx) => (
                    <div
                      key={idx}
                      className="border border-border/50 rounded-lg p-4 bg-card/50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-base">{char.name}</h3>
                        <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded">
                          {getVoiceLabel(char.voiceId)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {char.description}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Episode Shots Timeline */}
              {scriptV2.episodes.map((episode) => (
                <section key={episode.episodeNumber}>
                  <div className="flex items-center gap-2 mb-4">
                    <Film className="h-5 w-5 text-emerald-400" />
                    <h2 className="text-lg font-semibold">
                      第{episode.episodeNumber}集: {episode.title}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      ({episode.shots.reduce((sum, s) => sum + (s.duration || 5), 0)}秒)
                    </span>
                  </div>

                  {episode.sceneDescription && (
                    <div className="mb-3 p-3 rounded-lg bg-muted/30 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">场景描述</p>
                      <p className="text-sm leading-relaxed">{episode.sceneDescription}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {episode.shots.map((shot) => (
                      <div
                        key={shot.shotNumber}
                        className={`border rounded-lg p-3 ${
                          shot.type === "dialogue"
                            ? "border-blue-500/30 bg-blue-500/5"
                            : "border-border/50 bg-card/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                            #{shot.shotNumber}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              shot.type === "dialogue"
                                ? "bg-blue-500/10 text-blue-400"
                                : "bg-amber-500/10 text-amber-400"
                            }`}
                          >
                            {shot.type === "dialogue" ? "对话" : "旁白"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {shot.duration}s
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-1">
                          {shot.visual}
                        </p>
                        {shot.type === "dialogue" && shot.character && (
                          <div className="mt-2 pl-3 border-l-2 border-blue-500/50">
                            <span className="text-sm font-medium text-blue-400">
                              {shot.character}:
                            </span>
                            <span className="text-sm ml-1">"{shot.line}"</span>
                          </div>
                        )}
                        {shot.type === "narration" && shot.subtitle && (
                          <p className="mt-1 text-sm italic text-amber-300/80">
                            {shot.subtitle}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

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
        ) : episodes.length > 0 ? (
          <>
            {/* V1 Legacy Format */}
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
