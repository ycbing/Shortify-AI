"use client";

import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

interface EpisodeCounterProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function EpisodeCounter({
  value,
  onChange,
  min = 3,
  max = 10,
}: EpisodeCounterProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">📺 集数</label>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="h-8 w-8"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <div className="flex items-baseline gap-1 min-w-[3rem] justify-center">
          <span className="text-2xl font-bold text-emerald-400">{value}</span>
          <span className="text-sm text-muted-foreground">集</span>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="h-8 w-8"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        每集 30-60 秒，预计总时长 {value * 45}s - {value * 60}s
      </p>
    </div>
  );
}
