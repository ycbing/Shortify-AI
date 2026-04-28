"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Trash2, Copy, Pencil, Film, Check, Settings } from "lucide-react";
import { GeneratingProgressBadge } from "@/components/drama/generating-progress-badge";
import type { DramaWithEpisodes } from "@/types/drama";
import {
  DRAMA_PROGRESS_STEPS,
  DRAMA_STATUS_META,
  getDramaEditorPath,
  getCompletedDramaSteps,
} from "@/lib/drama-status-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [dramas, setDramas] = useState<DramaWithEpisodes[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<DramaWithEpisodes | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);

  const fetchDramas = useCallback(async () => {
    try {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`/api/dramas${params}`);
      if (res.ok) {
        const data = await res.json();
        setDramas(data.dramas || []);
      }
    } catch (error) {
      console.error("Failed to fetch dramas:", error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/sign-in");
      return;
    }
    if (status === "authenticated") {
      queueMicrotask(() => {
        void fetchDramas();
      });
    }
  }, [fetchDramas, router, status]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/dramas/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setDramas((prev) => prev.filter((d) => d.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async (drama: DramaWithEpisodes) => {
    setCopying(drama.id);
    try {
      const res = await fetch(`/api/dramas/${drama.id}/copy`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        // Insert the new drama at the top
        setDramas((prev) => [data.drama, ...prev]);
      }
    } catch {
      // ignore
    } finally {
      setCopying(null);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  const filterButtons = [
    { key: "all", label: "全部" },
    { key: "draft", label: "草稿" },
    { key: "generating", label: "生成中" },
    { key: "completed", label: "已完成" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-14 sm:h-16">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <h1 className="text-base sm:text-lg font-bold truncate">我的短剧</h1>
            {session?.user && (
              <span className="text-xs sm:text-sm text-muted-foreground hidden sm:inline">
                {session.user.email}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings">
              <Button variant="outline" size="sm" className="min-h-[44px] min-w-[44px] px-2 sm:px-3" title="设置">
                <Settings className="h-4 w-4 sm:mr-1 sm:inline" />
                <span className="hidden sm:inline">积分</span>
              </Button>
            </Link>
            <Link href="/create">
              <Button className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px] min-w-[44px]">
                <Plus className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">创建短剧</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 sm:py-6">
        {/* Filters — horizontally scrollable on mobile */}
        <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
          {filterButtons.map((f) => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.key)}
              className={
                filter === f.key
                  ? "bg-emerald-600 hover:bg-emerald-500 shrink-0 min-h-[44px]"
                  : "shrink-0 min-h-[44px]"
              }
            >
              {f.label}
            </Button>
          ))}
        </div>

        {/* Drama grid — single column on mobile */}
        {dramas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-5xl mb-4">🎬</span>
            <h3 className="text-lg font-semibold mb-2">还没有短剧</h3>
            <p className="text-sm text-muted-foreground mb-6">
              点击「创建短剧」开始你的创作之旅
            </p>

            {/* Onboarding guide for new users */}
            <div className="max-w-md w-full space-y-4 text-left mt-4">
              <div className="flex items-start gap-3 p-4 border border-border/50 rounded-lg bg-card/50">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 text-emerald-400 text-sm font-bold">1</div>
                <div>
                  <p className="text-sm font-medium">输入创意</p>
                  <p className="text-xs text-muted-foreground">描述你的短剧主题、类型和风格</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 border border-border/50 rounded-lg bg-card/50">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 text-emerald-400 text-sm font-bold">2</div>
                <div>
                  <p className="text-sm font-medium">AI 生成剧本</p>
                  <p className="text-xs text-muted-foreground">AI 自动创作完整分集剧本</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 border border-border/50 rounded-lg bg-card/50">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 text-emerald-400 text-sm font-bold">3</div>
                <div>
                  <p className="text-sm font-medium">配音与合成</p>
                  <p className="text-xs text-muted-foreground">生成配音、合成视频、导出作品</p>
                </div>
              </div>

              <Link href="/create" className="block pt-2">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">
                  <Plus className="h-4 w-4 mr-2" />
                  立即开始创作
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {dramas.map((drama) => (
              <DramaCardWithActions
                key={drama.id}
                drama={drama}
                onDelete={() => setDeleteTarget(drama)}
                onCopy={() => handleCopy(drama)}
                copying={copying === drama.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50 sm:max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.title}」吗？此操作不可撤销，所有关联的剧本、分镜、配音和视频都将被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="min-h-[44px]"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="min-h-[44px]"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  确认删除
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Drama card with management actions ---

interface DramaCardProps {
  drama: DramaWithEpisodes;
  onDelete: () => void;
  onCopy: () => void;
  copying: boolean;
}

function DramaCardWithActions({ drama, onDelete, onCopy, copying }: DramaCardProps) {
  const status = DRAMA_STATUS_META[drama.status] || DRAMA_STATUS_META.draft;
  const dramaEpisodes = drama.episodes || [];
  const completedSteps = getCompletedDramaSteps(drama.status, dramaEpisodes);

  /** Convert storage path to public-accessible URL */
  const toImgUrl = (p: string | null) => {
    if (!p) return null;
    // COS private bucket URL → route through signed proxy
    if (p.includes(".cos.")) {
      try {
        const u = new URL(p);
        const cosKey = u.pathname.slice(1);
        return `/api/uploads/cos/${encodeURIComponent(cosKey)}`;
      } catch {
        return p;
      }
    }
    // External URLs (e.g. expired UCloud links) — skip, will show broken
    if (p.startsWith("http")) return p;
    // Local relative path
    return `/api/uploads/${p.replace(/^\.?\/?uploads\/?/, "")}`;
  };

  const coverSrc = toImgUrl(drama.coverUrl) || toImgUrl(dramaEpisodes[0]?.imageUrl || null);
  const editorUrl = getDramaEditorPath(drama.id, dramaEpisodes, drama.status);

  // Determine the best editor page to link to based on status
  const getViewUrl = () => `/view/${drama.id}`;
  const dramaCompleted = drama.status === "completed";

  return (
    <div className="group border border-border/50 rounded-xl overflow-hidden bg-card/50 hover:border-emerald-500/50 hover:bg-card/80 transition-all duration-300">
      {/* Cover — clickable */}
      <Link href={dramaCompleted ? getViewUrl() : editorUrl} className="block">
        <div className="relative aspect-video bg-muted overflow-hidden">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={drama.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
              <Film className="h-8 w-8 text-muted-foreground/50" />
            </div>
          )}
          <div className="absolute top-2 right-2">
            <span className="text-xs backdrop-blur-md bg-black/50 px-2 py-0.5 rounded text-white">
              {status.label}
            </span>
          </div>
        </div>
      </Link>

      <div className="p-3 sm:p-4">
        <Link href={dramaCompleted ? getViewUrl() : editorUrl}>
          <h3 className="font-semibold text-sm truncate mb-1 hover:text-emerald-400 transition">{drama.title}</h3>
        </Link>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>{dramaEpisodes.length} 集</span>
          <span>{new Date(drama.createdAt).toLocaleDateString("zh-CN")}</span>
        </div>

        {/* Progress steps */}
        {dramaEpisodes.length > 0 && drama.status !== "draft" && (
          <div className="flex items-center gap-1 mb-3 pb-3 border-b border-border/30">
              {DRAMA_PROGRESS_STEPS.map((step, idx) => {
              const isCompleted = completedSteps.has(step.key);
              return (
                <div key={step.key} className="flex items-center gap-1">
                  <div
                    className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${
                      isCompleted
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-zinc-800/50 text-zinc-500"
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="h-2.5 w-2.5" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 inline-block" />
                    )}
                    {step.label}
                  </div>
                  {idx < DRAMA_PROGRESS_STEPS.length - 1 && (
                    <span className="text-zinc-600 text-[8px]">→</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {drama.status === "generating" ? (
          <div className="mb-3">
            <GeneratingProgressBadge dramaId={drama.id} />
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Link href={editorUrl} className="flex-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full min-h-[40px] text-xs"
            >
              <Pencil className="h-3 w-3 mr-1" />
              编辑
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={onCopy}
            disabled={copying}
            className="min-h-[40px] min-w-[40px] px-2"
            title="复制"
          >
            {copying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="min-h-[40px] min-w-[40px] px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/30"
            title="删除"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
