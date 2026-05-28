"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Film, Trash2, Sparkles, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface Narration {
  id: string;
  title: string;
  subject: string;
  videoScript: string | null;
  searchTerms: string[];
  voiceName: string;
  videoAspect: string;
  videoTransition: string;
  videoTransitionDuration: number;
  videoUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toPublicUrl(localPath: string | null): string | null {
  if (!localPath) return null;
  if (localPath.includes(".cos.") && localPath.startsWith("http")) {
    try {
      const u = new URL(localPath);
      return `/api/uploads/cos/${encodeURIComponent(u.pathname.slice(1))}`;
    } catch {
      return localPath;
    }
  }
  if (localPath.startsWith("http")) return localPath;
  return `/api/uploads/${localPath.replace(/^\.?\/?uploads\/?/, "")}`;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "text-zinc-400" },
  generating: { label: "生成中", color: "text-amber-400" },
  script_ready: { label: "文案就绪", color: "text-blue-400" },
  completed: { label: "已完成", color: "text-emerald-400" },
  error: { label: "失败", color: "text-red-400" },
};

export default function NarratePage() {
  const router = useRouter();
  const [narrations, setNarrations] = useState<Narration[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchNarrations = useCallback(async () => {
    try {
      const res = await fetch("/api/narrations");
      if (res.ok) {
        const data = await res.json();
        setNarrations(data.narrations || []);
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNarrations();
  }, [fetchNarrations]);

  // Auto-refresh generating items
  useEffect(() => {
    if (generatingIds.size === 0) return;
    const interval = setInterval(() => void fetchNarrations(), 3000);
    return () => clearInterval(interval);
  }, [generatingIds, fetchNarrations]);

  const handleCreate = async () => {
    if (!subject.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/narrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubject("");
        toast.success("已创建");
        await fetchNarrations();
        // Auto-start generation
        handleGenerate(data.narration.id);
      } else {
        toast.error(data.error || "创建失败");
      }
    } catch {
      toast.error("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleGenerate = async (id: string, stopAt?: string) => {
    setGeneratingIds((prev) => new Set(prev).add(id));
    try {
      const body: Record<string, string> = { narrationId: id };
      if (stopAt) body.stopAt = stopAt;

      const res = await fetch("/api/narrations/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "已启动生成");
        if (stopAt !== "script") {
          // Will auto-refresh via interval
        }
        await fetchNarrations();
      } else {
        toast.error(data.error || "生成失败");
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch {
      toast.error("生成失败");
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/narrations?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("已删除");
        await fetchNarrations();
      }
    } catch {
      toast.error("删除失败");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-4xl flex items-center justify-between px-4 h-14 sm:h-16">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            </Link>
            <h1 className="font-bold text-lg">🎙️ 短视频解说</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Create form */}
        <div className="mb-8 p-4 sm:p-6 border border-border/50 rounded-lg bg-card/30">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            创建解说视频
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            输入主题，AI 自动生成解说文案，匹配 Pexels 真实视频素材，合成完整短视频
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="输入视频主题，如：量子计算的原理、深海生物的奇妙世界..."
              className="flex-1 px-4 py-3 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:border-emerald-500/50"
              disabled={creating}
            />
            <Button
              onClick={handleCreate}
              disabled={creating || !subject.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 min-h-[48px] px-6"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4 mr-2" />}
              {creating ? "创建中" : "开始"}
            </Button>
          </div>
        </div>

        {/* Narration list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : narrations.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Film className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">还没有解说视频</p>
            <p className="text-xs mt-1">在上方输入主题，一键生成</p>
          </div>
        ) : (
          <div className="space-y-3">
            {narrations.map((n) => {
              const statusInfo = STATUS_MAP[n.status] || STATUS_MAP.draft;
              const isExpanded = expandedId === n.id;
              const isGenerating = generatingIds.has(n.id) || n.status === "generating";

              return (
                <div key={n.id} className="border border-border/50 rounded-lg overflow-hidden bg-card/30">
                  {/* Header */}
                  <div
                    className="flex items-center gap-3 p-3 sm:p-4 cursor-pointer hover:bg-card/50 transition"
                    onClick={() => setExpandedId(isExpanded ? null : n.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm sm:text-base truncate">{n.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(n.createdAt).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium ${statusInfo.color}`}>
                        {isGenerating && <Loader2 className="h-3 w-3 inline animate-spin mr-1" />}
                        {statusInfo.label}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDelete(n.id); }}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="border-t border-border/50 p-3 sm:p-4 space-y-4">
                      {/* Script */}
                      {n.videoScript && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">解说文案</p>
                          <div className="text-sm bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto">
                            {n.videoScript}
                          </div>
                          {n.searchTerms && Array.isArray(n.searchTerms) && n.searchTerms.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {n.searchTerms.map((term: string, i: number) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                                  {term}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Video player */}
                      {n.videoUrl && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">最终视频</p>
                          <video
                            src={toPublicUrl(n.videoUrl) || undefined}
                            controls
                            className="w-full rounded-lg bg-black max-h-[60vh]"
                            playsInline
                          />
                          <a
                            href={toPublicUrl(n.videoUrl) || "#"}
                            download
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 mt-2"
                          >
                            <Film className="h-3.5 w-3.5" />
                            下载视频
                          </a>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2">
                        {!n.videoScript && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleGenerate(n.id, "script")}
                            disabled={isGenerating}
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                            生成文案
                          </Button>
                        )}
                        {n.videoScript && !n.videoUrl && (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-500"
                            onClick={() => void handleGenerate(n.id)}
                            disabled={isGenerating}
                          >
                            {isGenerating ? (
                              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> 生成中...</>
                            ) : (
                              <><Film className="h-3.5 w-3.5 mr-1.5" /> 生成视频</>
                            )}
                          </Button>
                        )}
                        {n.videoUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleGenerate(n.id)}
                            disabled={isGenerating}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                            重新生成
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
