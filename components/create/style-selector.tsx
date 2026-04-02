"use client";

import type { DramaGenreType, DramaStyleType } from "@/types/drama";

const GENRES: { value: DramaGenreType; label: string; emoji: string; desc: string }[] = [
  { value: "mystery", label: "悬疑", emoji: "🔍", desc: "烧脑反转" },
  { value: "romance", label: "爱情", emoji: "💕", desc: "甜蜜心动" },
  { value: "comedy", label: "喜剧", emoji: "😂", desc: "爆笑日常" },
  { value: "scifi", label: "科幻", emoji: "🚀", desc: "未来科技" },
  { value: "horror", label: "恐怖", emoji: "👻", desc: "惊悚刺激" },
];

const STYLES: { value: DramaStyleType; label: string; emoji: string }[] = [
  { value: "realistic", label: "写实", emoji: "📸" },
  { value: "anime", label: "动漫", emoji: "🎨" },
  { value: "ink", label: "水墨", emoji: "🖌️" },
  { value: "cyberpunk", label: "赛博朋克", emoji: "🌃" },
];

interface StyleSelectorProps {
  genre: DramaGenreType | "";
  style: DramaStyleType | "";
  onGenreChange: (value: DramaGenreType) => void;
  onStyleChange: (value: DramaStyleType) => void;
}

export function StyleSelector({
  genre,
  style,
  onGenreChange,
  onStyleChange,
}: StyleSelectorProps) {
  return (
    <div className="space-y-6">
      {/* Genre */}
      <div className="space-y-3">
        <label className="text-sm font-medium">🎭 题材</label>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {GENRES.map((g) => (
            <button
              key={g.value}
              onClick={() => onGenreChange(g.value)}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                genre === g.value
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/50"
                  : "border-border/50 hover:border-muted-foreground/50 bg-card/30"
              }`}
            >
              <span className="text-2xl">{g.emoji}</span>
              <span className="text-sm font-medium">{g.label}</span>
              <span className="text-xs text-muted-foreground">{g.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Style */}
      <div className="space-y-3">
        <label className="text-sm font-medium">🎨 画风</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STYLES.map((s) => (
            <button
              key={s.value}
              onClick={() => onStyleChange(s.value)}
              className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
                style === s.value
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/50"
                  : "border-border/50 hover:border-muted-foreground/50 bg-card/30"
              }`}
            >
              <span className="text-xl">{s.emoji}</span>
              <span className="text-sm font-medium">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
