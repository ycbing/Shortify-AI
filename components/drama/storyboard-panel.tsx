"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Download } from "lucide-react";

interface StoryboardItem {
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  narration: string;
}

interface StoryboardPanelProps {
  items: StoryboardItem[];
  onRegenerate?: (episodeNumber: number) => void;
  loading?: boolean;
}

export function StoryboardPanel({
  items,
  onRegenerate,
  loading = false,
}: StoryboardPanelProps) {
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const selected = items.find((i) => i.episodeNumber === selectedItem);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Thumbnail grid */}
      <div className="lg:col-span-1 space-y-3">
        {items.map((item) => (
          <div
            key={item.episodeNumber}
            onClick={() => setSelectedItem(item.episodeNumber)}
            className={`cursor-pointer rounded-lg overflow-hidden border transition-all ${
              selectedItem === item.episodeNumber
                ? "border-emerald-500 ring-1 ring-emerald-500/50"
                : "border-border/50 hover:border-muted-foreground/50"
            }`}
          >
            <div className="aspect-video bg-muted relative">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-muted-foreground text-sm">暂无图片</span>
                </div>
              )}
              <Badge
                variant="outline"
                className="absolute top-1 left-1 text-xs bg-black/60"
              >
                EP{item.episodeNumber}
              </Badge>
            </div>
            <div className="p-2">
              <p className="text-xs font-medium truncate">{item.title}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div className="lg:col-span-2">
        {selected ? (
          <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50">
            <div className="aspect-video bg-muted relative">
              {selected.imageUrl ? (
                <img
                  src={selected.imageUrl}
                  alt={selected.title}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-muted-foreground">暂无分镜图片</span>
                </div>
              )}
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  第 {selected.episodeNumber} 集 - {selected.title}
                </h3>
                <div className="flex gap-2">
                  {selected.imageUrl && (
                    <Button variant="outline" size="sm">
                      <Download className="h-3 w-3 mr-1" />
                      下载
                    </Button>
                  )}
                  {onRegenerate && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => onRegenerate(selected.episodeNumber)}
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
                      重新生成
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{selected.narration}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 border border-dashed border-border/50 rounded-lg">
            <p className="text-sm text-muted-foreground">选择一集查看分镜详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
