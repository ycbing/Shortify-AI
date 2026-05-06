"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/create/step-indicator";
import { ScriptEditor } from "@/components/drama/script-editor";
import { Loader2, ArrowRight, ArrowLeft, Sparkles, Users, Film, Square, Save, AlertCircle } from "lucide-react";
import type { GeneratedEpisode, GeneratedScriptV2, Shot, Character } from "@/types/drama";
import { isScriptV2, VOICE_OPTIONS } from "@/types/drama";
import Link from "next/link";
import { useTaskPolling } from "@/lib/hooks/use-task-polling";

const steps = [
  { number: 1, title: "创意" },
  { number: 2, title: "剧本" },
  { number: 3, title: "分镜" },
  { number: 4, title: "预览" },
];

// Animated typing dots component
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskProgressLabel, setTaskProgressLabel] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleGenerate = useCallback(async () => {
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
        setGenerating(false);
        return;
      }

      if (data.taskId && !data.script) {
        setActiveTaskId(data.taskId);
        setTaskProgressLabel("");
        return;
      }

      setTitle(data.script.title);

      if (isScriptV2(data.script)) {
        setScriptV2(data.script);
        setCharacters(data.script.characters);
      }

      setEpisodes(data.script.episodes);
      setGenerating(false);
    } catch {
      setError("剧本生成失败，请稍后重试");
      setGenerating(false);
    }
  }, [dramaId]);

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

    try {
      const taskRes = await fetch(`/api/tasks?dramaId=${dramaId}&type=script&status=processing&latest=1`);
      const taskData = await taskRes.json();
      if (taskRes.ok && Array.isArray(taskData.tasks) && taskData.tasks[0]?.id) {
        setLoading(false);
        setGenerating(true);
        setActiveTaskId(taskData.tasks[0].id);
        return;
      }
    } catch {
      // ignore task resume errors
    }

    // Auto-generate script
    setLoading(false);
    handleGenerate();
  }, [dramaId, handleGenerate]);

  const { task: activeTask, startPolling } = useTaskPolling(activeTaskId, {
    autoStart: false,
    onCompleted: async (task) => {
      setGenerating(false);
      setActiveTaskId(null);
      setTaskProgressLabel(task.presentation?.summary || "");
      await fetchScript();
    },
    onFailed: async (task) => {
      setGenerating(false);
      setActiveTaskId(null);
      setTaskProgressLabel(task.presentation?.summary || "");
      setError(task.presentation?.failureTitle || task.errorMessage || "剧本生成失败，请稍后重试");
    },
  });

  useEffect(() => {
    if (!dramaId) {
      router.push("/create");
      return;
    }
    queueMicrotask(() => {
      void fetchScript();
    });
  }, [dramaId, fetchScript, router]);

  useEffect(() => {
    if (!activeTaskId) return;
    void startPolling();
  }, [activeTaskId, startPolling]);

  const progressLabel = activeTask?.progress?.label || taskProgressLabel;

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
      setActiveTaskId(null);
      setTaskProgressLabel("");
    } catch {
      setError("取消任务失败");
    }
  };

  const handleUpdate = (index: number, data: unknown) => {
    setEpisodes((prev) => prev.map((ep, i) => (i === index ? (data as typeof ep) : ep)));
  };

  const updateShot = (episodeIdx: number, shotIdx: number, field: string, value: string | number) => {
    if (!scriptV2) return;
    const updated = { ...scriptV2 };
    const ep = { ...updated.episodes[episodeIdx] };
    const shots = [...ep.shots];
    shots[shotIdx] = { ...shots[shotIdx], [field]: value };
    ep.shots = shots;
    updated.episodes = updated.episodes.map((e, i) => (i === episodeIdx ? ep : e));
    setScriptV2(updated);
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (!dramaId || !scriptV2) return;
    setSaving(true);
    try {
      // Build episodes data for the API
      const episodesData = scriptV2.episodes.map((ep) => ({
        episodeNumber: ep.episodeNumber,
        shots: ep.shots,
        scriptContent: JSON.stringify({
          sceneDescription: ep.sceneDescription,
          shots: ep.shots,
        }),
      }));

      const res = await fetch(`/api/dramas/${dramaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characters, episodes: episodesData }),
      });

      if (res.ok) {
        setHasUnsavedChanges(false);
        const { toast } = await import("sonner");
        toast.success("剧本保存成功");
      } else {
        const { toast } = await import("sonner");
        toast.error("保存失败，请重试");
      }
    } catch {
      const { toast } = await import("sonner");
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
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
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-14 sm:h-16">
          <StepIndicator currentStep={2} steps={steps} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {/* Step hint */}
        <div className="mb-6 sm:mb-8 p-3 sm:p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-xs sm:text-sm text-emerald-400">
            ✍️ AI 正在为你创作剧本，你可以编辑调整每一集的内容
          </p>
        </div>

        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-2">AI 剧本 ✍️</h1>
          {title && (
            <p className="text-sm sm:text-base text-muted-foreground">《{title}》- 共 {scriptV2 ? scriptV2.episodes.length : episodes.length} 集</p>
          )}
        </div>

        {error && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-red-400 bg-red-500/10 rounded p-3">
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={generating}
              className="min-h-[40px] border-red-500/30 text-red-300 hover:text-red-200"
            >
              重试生成
            </Button>
          </div>
        )}

        {generating ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20">
            {/* Animated progress indicator */}
            <div className="relative mb-6">
              <div className="w-16 h-16 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
              <Sparkles className="h-6 w-6 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-base sm:text-lg font-medium text-foreground mb-2">
              AI 正在创作中
              <TypingDots />
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {progressLabel || "通常需要 10-30 秒，请耐心等待"}
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>构思剧情</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500/50 animate-pulse" style={{ animationDelay: "500ms" }} />
                <span>编写台词</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500/30 animate-pulse" style={{ animationDelay: "1000ms" }} />
                <span>打磨细节</span>
              </div>
            </div>
            {activeTaskId && (
              <Button
                variant="outline"
                onClick={handleCancelTask}
                className="mt-6 min-h-[40px]"
              >
                <Square className="h-4 w-4 mr-2" />
                取消任务
              </Button>
            )}
          </div>
        ) : scriptV2 ? (
          <>
            {/* V2 Format: Characters + Shots Timeline */}
            <div className="space-y-6 sm:space-y-8">
              {/* Character Cards */}
              <section>
                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                  <Users className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-base sm:text-lg font-semibold">角色列表</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {characters.map((char, idx) => (
                    <div
                      key={idx}
                      className="border border-border/50 rounded-lg p-3 sm:p-4 bg-card/50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-sm sm:text-base">{char.name}</h3>
                        <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded">
                          {getVoiceLabel(char.voiceId)}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                        {char.description}
                      </p>
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <p className="text-xs text-muted-foreground/70 mb-1">🎨 外貌描述（用于图片生成一致性）</p>
                        <textarea
                          className="w-full text-xs sm:text-sm text-amber-300/80 leading-relaxed bg-transparent border border-border/30 rounded p-2 resize-y min-h-[3rem] focus:outline-none focus:border-emerald-500/50"
                          value={char.appearance || ""}
                          placeholder="描述角色的固定外貌特征（发型、服装、体型、配饰等），确保不同镜头中角色外观一致"
                          onChange={(e) => {
                            const updated = [...characters];
                            updated[idx] = { ...updated[idx], appearance: e.target.value };
                            setCharacters(updated);
                            // Also update scriptV2
                            if (scriptV2) {
                              setScriptV2({ ...scriptV2, characters: updated });
                            }
                          }}
                          onBlur={async () => {
                            // Auto-save character appearance changes to backend
                            if (!dramaId) return;
                            try {
                              await fetch(`/api/dramas/${dramaId}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ characters: characters }),
                              });
                            } catch {
                              // Silent fail for auto-save
                            }
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Episode Shots Timeline */}
              {scriptV2.episodes.map((episode) => (
                <section key={episode.episodeNumber}>
                  <div className="flex items-center gap-2 mb-3 sm:mb-4">
                    <Film className="h-5 w-5 text-emerald-400" />
                    <h2 className="text-base sm:text-lg font-semibold">
                      第{episode.episodeNumber}集: {episode.title}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      ({episode.shots.reduce((sum, s) => sum + (s.duration || 5), 0)}秒)
                    </span>
                  </div>

                  {episode.sceneDescription && (
                    <div className="mb-3 p-3 rounded-lg bg-muted/30 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">场景描述</p>
                      <p className="text-xs sm:text-sm leading-relaxed">{episode.sceneDescription}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {episode.shots.map((shot, shotIdx) => (
                      <div
                        key={shot.shotNumber}
                        className={`border rounded-lg p-2.5 sm:p-3 ${
                          shot.type === "dialogue"
                            ? "border-blue-500/30 bg-blue-500/5"
                            : "border-border/50 bg-card/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
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
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="number"
                              min={1}
                              max={30}
                              value={shot.duration || 5}
                              onChange={(e) => updateShot(episode.episodeNumber - 1, shotIdx, "duration", Math.max(1, parseInt(e.target.value) || 5))}
                              className="w-12 bg-muted/50 border border-border/30 rounded px-1.5 py-0.5 text-center text-xs focus:outline-none focus:border-emerald-500/50"
                            />
                            <span>秒</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground/70 uppercase">画面描述</label>
                            <textarea
                              className="w-full text-xs sm:text-sm text-muted-foreground leading-relaxed bg-transparent border border-border/20 rounded p-2 resize-y min-h-[2rem] focus:outline-none focus:border-emerald-500/50"
                              value={shot.visual}
                              onChange={(e) => updateShot(episode.episodeNumber - 1, shotIdx, "visual", e.target.value)}
                              rows={2}
                            />
                          </div>
                          {shot.type === "dialogue" && shot.character && (
                            <div className="pl-3 border-l-2 border-blue-500/50">
                              <label className="text-[10px] text-muted-foreground/70 uppercase">台词</label>
                              <textarea
                                className="w-full text-xs sm:text-sm leading-relaxed bg-transparent border border-border/20 rounded p-2 resize-y min-h-[2rem] focus:outline-none focus:border-emerald-500/50 mt-1"
                                value={shot.line || ""}
                                onChange={(e) => updateShot(episode.episodeNumber - 1, shotIdx, "line", e.target.value)}
                                rows={2}
                              />
                            </div>
                          )}
                          {shot.type === "narration" && (
                            <div>
                              <label className="text-[10px] text-muted-foreground/70 uppercase">旁白字幕</label>
                              <textarea
                                className="w-full text-xs sm:text-sm italic text-amber-300/80 bg-transparent border border-border/20 rounded p-2 resize-y min-h-[2rem] focus:outline-none focus:border-emerald-500/50 mt-1"
                                value={shot.subtitle || ""}
                                onChange={(e) => updateShot(episode.episodeNumber - 1, shotIdx, "subtitle", e.target.value)}
                                rows={2}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Unsaved changes banner */}
            {hasUnsavedChanges && (
              <div className="sticky bottom-0 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm text-amber-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>有未保存的修改</span>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-500 min-h-[40px]"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  保存剧本
                </Button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between gap-3 mt-8">
              <Link href="/create">
                <Button variant="outline" className="w-full sm:w-auto min-h-[44px]">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  上一步
                </Button>
              </Link>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className="w-full sm:w-auto min-h-[44px]"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  保存修改
                </Button>
                <Link href={`/create/storyboard?dramaId=${dramaId}`}>
                  <Button className="bg-emerald-600 hover:bg-emerald-500 w-full sm:w-auto min-h-[44px]">
                    下一步：生成分镜
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
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

            <div className="flex flex-col sm:flex-row justify-between gap-3 mt-8">
              <Link href="/create">
                <Button variant="outline" className="w-full sm:w-auto min-h-[44px]">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  上一步
                </Button>
              </Link>
              <Link href={`/create/storyboard?dramaId=${dramaId}`}>
                <Button className="bg-emerald-600 hover:bg-emerald-500 w-full sm:w-auto min-h-[44px]">
                  下一步：生成分镜
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20">
            <Sparkles className="h-8 w-8 text-emerald-400 mb-4" />
            <p className="mb-4">点击按钮让 AI 为你创作剧本</p>
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]"
            >
              {generating ? "生成中..." : "生成剧本"}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
