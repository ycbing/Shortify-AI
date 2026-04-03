"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeft, GripVertical, Check, Circle } from "lucide-react";
import Link from "next/link";

interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  voiceoverUrl: string | null;
  videoUrl: string | null;
}

export default function EditorPage() {
  const router = useRouter();
  const params = useParams();
  const dramaId = params.dramaId as string;

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fetchEpisodes = useCallback(async () => {
    if (!dramaId) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => {
    if (!dramaId) {
      router.push("/dashboard");
      return;
    }
    fetchEpisodes();
  }, [dramaId]);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) return;

    const newEpisodes = [...episodes];
    const [moved] = newEpisodes.splice(dragIndex, 1);
    newEpisodes.splice(targetIndex, 0, moved);

    // Update episode numbers
    newEpisodes.forEach((ep, i) => {
      ep.episodeNumber = i + 1;
    });

    setEpisodes(newEpisodes);
    setDragIndex(null);
  };

  const handleSave = async () => {
    if (!dramaId) return;
    setSaving(true);

    try {
      // Update each episode's episode number
      for (const ep of episodes) {
        await fetch(`/api/dramas/${dramaId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ episodes }),
        });
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
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
        <div className="mx-auto max-w-4xl flex items-center justify-between px-4 h-14 sm:h-16">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-base sm:text-lg font-bold truncate">编辑器</h1>
          </div>
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 min-h-[44px]">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                保存
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                保存
              </>
            )}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-4 sm:py-6">
        <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
          拖拽调整剧集顺序
        </p>

        <div className="space-y-2 sm:space-y-3">
          {episodes.map((ep, index) => (
            <div
              key={ep.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 border rounded-lg bg-card/50 cursor-grab active:cursor-grabbing transition-all ${
                dragIndex === index
                  ? "border-emerald-500 opacity-50"
                  : "border-border/50 hover:border-muted-foreground/50"
              }`}
            >
              <GripVertical className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-base sm:text-lg font-bold text-muted-foreground w-6 sm:w-8 text-center shrink-0">
                {ep.episodeNumber}
              </span>
              <div className="aspect-video w-20 sm:w-32 bg-muted rounded overflow-hidden shrink-0">
                {ep.imageUrl ? (
                  <img src={ep.imageUrl} alt={ep.title || ""} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                    无图片
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs sm:text-sm truncate">{ep.title || `第${ep.episodeNumber}集`}</p>
                <div className="flex gap-2 mt-1">
                  <span className={`text-xs ${ep.voiceoverUrl ? "text-emerald-400" : "text-muted-foreground"} inline-flex items-center gap-0.5`}>
                    {ep.voiceoverUrl ? <><Check className="h-3 w-3" /> 配音</> : <><Circle className="h-2 w-2" /> 配音</>}
                  </span>
                  <span className={`text-xs ${ep.videoUrl ? "text-emerald-400" : "text-muted-foreground"} inline-flex items-center gap-0.5`}>
                    {ep.videoUrl ? <><Check className="h-3 w-3" /> 视频</> : <><Circle className="h-2 w-2" /> 视频</>}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
