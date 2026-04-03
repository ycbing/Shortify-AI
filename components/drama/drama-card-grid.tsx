"use client";

import { DramaCard } from "./drama-card";
import type { DramaWithEpisodes } from "@/types/drama";

interface DramaCardGridProps {
  dramas: DramaWithEpisodes[];
  emptyMessage?: string;
}

export function DramaCardGrid({ dramas, emptyMessage = "还没有短剧" }: DramaCardGridProps) {
  if (dramas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <span className="text-5xl mb-4">🎬</span>
        <h3 className="text-lg font-semibold mb-2">{emptyMessage}</h3>
        <p className="text-sm text-muted-foreground">
          点击「创建短剧」开始你的创作之旅
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {dramas.map((drama) => (
        <DramaCard key={drama.id} drama={drama} />
      ))}
    </div>
  );
}
