"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Trash2, Copy, Pencil, Film, Check, Settings, Search, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import { GeneratingProgressBadge } from "@/components/drama/generating-progress-badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"newest" | "updated" | "shares">("newest");

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
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
          <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-14 sm:h-16">
            <Skeleton className="h-6 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-4 sm:py-6">
          <div className="flex gap-2 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-16 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border border-border/50 rounded-xl overflow-hidden">
                <Skeleton className="aspect-video w-full" />
                <div className="p-3 sm:p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Filter + search + sort
  const filteredDramas = dramas
    .filter((d) => {
      if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "updated") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sortBy === "shares") return (b.shareCount || 0) - (a.shareCount || 0);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  // Stats
  const totalDramas = dramas.length;
  const completedDramas = dramas.filter((d) => d.status === "completed").length;
  const generatingDramas = dramas.filter((d) => d.status === "generating").length;

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
            <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition shrink-0" title="返回首页">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
              <span className="text-sm hidden sm:inline">首页</span>
            </Link>
            <span className="text-muted-foreground/30 hidden sm:inline">/</span>
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
        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3 mb-4 sm:mb-6">
          <div className="border border-border/50 rounded-lg p-3 bg-card/50">
            <p className="text-xl sm:text-2xl font-bold">{totalDramas}</p>
            <p className="text-xs text-muted-foreground">总作品</p>
          </div>
          <div className="border border-border/50 rounded-lg p-3 bg-card/50">
            <p className="text-xl sm:text-2xl font-bold text-emerald-400">{completedDramas}</p>
            <p className="text-xs text-muted-foreground">已完成</p>
          </div>
          <div className="border border-border/50 rounded-lg p-3 bg-card/50">
            <p className="text-xl sm:text-2xl font-bold text-amber-400">{generatingDramas}</p>
            <p className="text-xs text-muted-foreground">生成中</p>
          </div>
        </div>

        {/* Search + Sort + View toggle */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4 sm:mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索短剧标题..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-muted/30 border border-border/50 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 min-h-[44px] cursor-pointer"
            >
              <option value="newest">最新创建</option>
              <option value="updated">最近更新</option>
              <option value="shares">最多分享</option>
            </select>
            <div className="flex border border-border/50 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 min-h-[44px] min-w-[44px] ${viewMode === "grid" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
              ><LayoutGrid className="h-4 w-4" /></button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 min-h-[44px] min-w-[44px] ${viewMode === "list" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
              ><List className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

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
        {filteredDramas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-5xl mb-4">{search ? "🔍" : "🎬"}</span>
            <h3 className="text-lg font-semibold mb-2">{search ? "没有找到匹配的短剧" : "还没有短剧"}</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {search ? "试试其他关键词，或创建一个新短剧" : "点击「创建短剧」开始你的创作之旅"}
            </p>
            <Link href="/create" className="block pt-2">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">
                <Plus className="h-4 w-4 mr-2" />
                立即开始创作
              </Button>
            </Link>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredDramas.map((drama) => (
              <DramaCardWithActions
                key={drama.id}
                drama={drama}
                onDelete={() => setDeleteTarget(drama)}
                onCopy={() => handleCopy(drama)}
                copying={copying === drama.id}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredDramas.map((drama) => (
              <DramaListItem
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

// --- Compact list view item ---
function DramaListItem({ drama, onDelete, onCopy, copying }: DramaCardProps) {
  const status = DRAMA_STATUS_META[drama.status] || DRAMA_STATUS_META.draft;
  const dramaEpisodes = drama.episodes || [];
  const completedSteps = getCompletedDramaSteps(drama.status, dramaEpisodes);
  const editorUrl = getDramaEditorPath(drama.id, dramaEpisodes, drama.status);
  const dramaCompleted = drama.status === "completed";

  const toImgUrl = (p: string | null) => {
    if (!p) return null;
    if (p.includes(".cos.")) {
      try {
        const u = new URL(p);
        return `/api/uploads/cos/${encodeURIComponent(u.pathname.slice(1))}`;
      } catch { return p; }
    }
    if (p.startsWith("http")) return p;
    return `/api/uploads/${p.replace(/^\.?\/?uploads\/?/, "")}`;
  };

  const coverSrc = toImgUrl(drama.coverUrl) || toImgUrl(dramaEpisodes[0]?.imageUrl || null);

  return (
    <div className="group flex items-center gap-3 sm:gap-4 border border-border/50 rounded-lg p-3 bg-card/50 hover:border-emerald-500/50 hover:bg-card/80 transition-all">
      <Link href={dramaCompleted ? `/view/${drama.id}` : editorUrl} className="shrink-0">
        <div className="w-20 h-12 sm:w-28 sm:h-16 rounded overflow-hidden bg-muted">
          {coverSrc ? (
            <img src={coverSrc} alt={drama.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
              <Film className="h-5 w-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm truncate hover:text-emerald-400 transition">{drama.title}</h3>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded shrink-0">{status.label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span>{dramaEpisodes.length} 集</span>
          <span>{new Date(drama.createdAt).toLocaleDateString("zh-CN")}</span>
          {dramaEpisodes.length > 0 && drama.status !== "draft" && (
            <div className="hidden sm:flex items-center gap-1">
              {DRAMA_PROGRESS_STEPS.map((step) => (
                <span key={step.key} className={`text-[10px] ${completedSteps.has(step.key) ? "text-emerald-400" : "text-zinc-600"}`}>
                {completedSteps.has(step.key) ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-700 inline-block" />}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Link href={editorUrl}><Button variant="ghost" size="sm" className="min-h-[40px] min-w-[40px] px-2"><Pencil className="h-3.5 w-3.5" /></Button></Link>
        <Button variant="ghost" size="sm" onClick={onCopy} disabled={copying} className="min-h-[40px] min-w-[40px] px-2">{copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="min-h-[40px] min-w-[40px] px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}
