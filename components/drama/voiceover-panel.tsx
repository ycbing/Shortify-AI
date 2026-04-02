"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Volume2, RefreshCw } from "lucide-react";
import { useState, useRef } from "react";

interface VoiceoverItem {
  episodeNumber: number;
  title: string;
  voiceoverUrl: string | null;
  duration: number | null;
}

interface VoiceoverPanelProps {
  items: VoiceoverItem[];
  onGenerate?: (episodeNumber?: number) => void;
  onGenerateAll?: () => void;
  loading?: boolean;
}

export function VoiceoverPanel({
  items,
  onGenerate,
  onGenerateAll,
  loading = false,
}: VoiceoverPanelProps) {
  const [playingEpisode, setPlayingEpisode] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = (episodeNumber: number, url: string) => {
    if (playingEpisode === episodeNumber) {
      audioRef.current?.pause();
      setPlayingEpisode(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play();
      setPlayingEpisode(episodeNumber);

      audioRef.current.onended = () => {
        setPlayingEpisode(null);
      };
    }
  };

  return (
    <div className="space-y-3">
      <audio ref={audioRef} />

      <div className="flex justify-end">
        {onGenerateAll && (
          <Button
            onClick={onGenerateAll}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500"
          >
            <Volume2 className="h-4 w-4 mr-2" />
            {loading ? "生成中..." : "全部生成配音"}
          </Button>
        )}
      </div>

      {items.map((item) => (
        <div
          key={item.episodeNumber}
          className="flex items-center gap-4 p-3 border border-border/50 rounded-lg bg-card/50"
        >
          <Badge variant="outline" className="shrink-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            EP{item.episodeNumber}
          </Badge>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {item.voiceoverUrl
                ? `已生成 · ${item.duration || "?"}s`
                : "未生成"}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {item.voiceoverUrl ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePlay(item.episodeNumber, item.voiceoverUrl!)}
              >
                {playingEpisode === item.episodeNumber ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => onGenerate?.(item.episodeNumber)}
              >
                <Volume2 className="h-3 w-3 mr-1" />
                生成
              </Button>
            )}
            {item.voiceoverUrl && onGenerate && (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => onGenerate(item.episodeNumber)}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
