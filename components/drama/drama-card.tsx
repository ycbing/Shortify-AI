"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DramaWithEpisodes } from "@/types/drama";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "草稿", variant: "outline" },
  generating: { label: "生成中", variant: "default" },
  script_ready: { label: "剧本就绪", variant: "secondary" },
  storyboard_ready: { label: "分镜就绪", variant: "secondary" },
  voiceover_ready: { label: "配音就绪", variant: "secondary" },
  completed: { label: "已完成", variant: "default" },
  error: { label: "生成失败", variant: "destructive" },
};

interface DramaCardProps {
  drama: DramaWithEpisodes;
}

export function DramaCard({ drama }: DramaCardProps) {
  const status = STATUS_MAP[drama.status] || STATUS_MAP.draft;
  const dramaEpisodes = drama.episodes || [];

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
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{dramaEpisodes.length} 集</span>
            <span>
              {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
