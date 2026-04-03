"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DramaWithEpisodes } from "@/types/drama";
import { Check } from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "草稿", variant: "outline" },
  generating: { label: "生成中", variant: "default" },
  script_ready: { label: "剧本就绪", variant: "secondary" },
  storyboard_ready: { label: "分镜就绪", variant: "secondary" },
  voiceover_ready: { label: "配音就绪", variant: "secondary" },
  completed: { label: "已完成", variant: "default" },
  error: { label: "生成失败", variant: "destructive" },
};

/** Progress steps for the drama creation pipeline */
const PROGRESS_STEPS = [
  { key: "script", label: "剧本" },
  { key: "storyboard", label: "分镜" },
  { key: "voiceover", label: "配音" },
  { key: "video", label: "视频" },
];

function getCompletedSteps(status: string, episodes: DramaWithEpisodes["episodes"]): Set<string> {
  const completed = new Set<string>();
  if (!episodes || episodes.length === 0) return completed;

  // Check based on status and episode data
  if (status === "draft") return completed;

  // Script is ready if we have episodes
  if (episodes.length > 0) {
    completed.add("script");
  }

  // Storyboard is ready if episodes have images
  if (episodes.some((ep) => ep.imageUrl)) {
    completed.add("storyboard");
  }

  // Voiceover is ready if episodes have voiceovers
  if (episodes.some((ep) => ep.voiceoverUrl)) {
    completed.add("voiceover");
  }

  // Video is ready if episodes have videos
  if (episodes.some((ep) => ep.videoUrl)) {
    completed.add("video");
  }

  return completed;
}

interface DramaCardProps {
  drama: DramaWithEpisodes;
}

export function DramaCard({ drama }: DramaCardProps) {
  const status = STATUS_MAP[drama.status] || STATUS_MAP.draft;
  const dramaEpisodes = drama.episodes || [];
  const completedSteps = getCompletedSteps(drama.status, dramaEpisodes);

  return (
    <Link href={`/view/${drama.id}`}>
      <Card className="group overflow-hidden border-border/50 bg-card/50 hover:border-emerald-500/50 hover:bg-card/80 transition-all duration-300 cursor-pointer">
        {/* Cover */}
        <div className="relative aspect-video bg-muted overflow-hidden">
          {dramaEpisodes[0]?.imageUrl ? (
            <img
              src={dramaEpisodes[0].imageUrl}
              alt={drama.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
              <span className="text-4xl">🎬</span>
            </div>
          )}
          <div className="absolute top-2 right-2">
            <Badge variant={status.variant} className="text-xs backdrop-blur-md bg-black/50">
              {status.label}
            </Badge>
          </div>
        </div>

        <CardContent className="p-4">
          <h3 className="font-semibold text-sm truncate mb-1">{drama.title}</h3>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>{dramaEpisodes.length} 集</span>
            <span>
              {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
            </span>
          </div>

          {/* Progress steps */}
          {dramaEpisodes.length > 0 && drama.status !== "draft" && (
            <div className="flex items-center gap-1 pt-2 border-t border-border/30">
              {PROGRESS_STEPS.map((step, idx) => {
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
                    {idx < PROGRESS_STEPS.length - 1 && (
                      <span className="text-zinc-600 text-[8px]">→</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
