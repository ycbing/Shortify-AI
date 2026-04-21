"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Loader2,
  Play,
  Image as ImageIcon,
  Film,
  Check,
  X,
  Clock,
} from "lucide-react";

export type ShotStatus = "pending" | "generating" | "ready" | "error";

interface ShotCardProps {
  shotNumber: number;
  visual: string;
  duration: number;
  type?: "dialogue" | "narration";
  character?: string;
  line?: string;
  subtitle?: string;
  imageUrl?: string | null;
  aiVideoUrl?: string | null;
  aiVideoStatus?: ShotStatus;
  onRegenerateImage?: () => void;
  onGenerateVideo?: () => void;
}

export function ShotCard({
  shotNumber,
  visual,
  duration,
  type,
  character,
  line,
  subtitle,
  imageUrl,
  aiVideoUrl,
  aiVideoStatus,
  onRegenerateImage,
  onGenerateVideo,
}: ShotCardProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50 hover:border-emerald-500/30 transition-all group">
      {/* Thumbnail */}
      <div className="aspect-video bg-muted relative">
        {aiVideoUrl ? (
          <video
            src={aiVideoUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={`镜头 ${shotNumber}`}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <Badge variant="outline" className="text-[10px] bg-black/60 border-0 text-white">
            #{shotNumber}
          </Badge>
          {type === "dialogue" && character && (
            <Badge variant="outline" className="text-[10px] bg-black/60 border-0 text-emerald-300">
              {character}
            </Badge>
          )}
          {aiVideoUrl && (
            <Badge variant="outline" className="text-[10px] bg-emerald-600/80 border-0 text-white">
              <Film className="h-2.5 w-2.5 mr-0.5" /> AI
            </Badge>
          )}
        </div>

        {/* Duration */}
        <div className="absolute bottom-2 right-2">
          <Badge variant="outline" className="text-[10px] bg-black/60 border-0 text-white">
            {duration}s
          </Badge>
        </div>

        {/* AI Video status overlay */}
        {aiVideoStatus === "generating" && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="flex items-center gap-2 text-emerald-400 text-xs">
              <Loader2 className="h-4 w-4 animate-spin" />
              生成中...
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Dialogue / subtitle text */}
        {type === "dialogue" && line && (
          <div className="text-xs">
            <span className="text-emerald-400 font-medium">{character}：</span>
            <span className="text-muted-foreground">{line}</span>
          </div>
        )}
        {type === "narration" && subtitle && (
          <p className="text-xs text-muted-foreground italic">&ldquo;{subtitle}&rdquo;</p>
        )}

        {/* Visual description (collapsed by default) */}
        <details className="group/desc">
          <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition">
            画面描述
          </summary>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-3">
            {visual}
          </p>
        </details>

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          {onRegenerateImage && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onRegenerateImage}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              换图
            </Button>
          )}
          {imageUrl && !aiVideoUrl && onGenerateVideo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-emerald-500 hover:text-emerald-400"
              onClick={onGenerateVideo}
            >
              <Film className="h-3 w-3 mr-1" />
              生成视频
            </Button>
          )}
          {aiVideoUrl && (
            <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
              <Check className="h-3 w-3" /> 视频已生成
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
