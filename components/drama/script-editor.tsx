"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Save, ChevronDown, ChevronUp } from "lucide-react";

interface EpisodeData {
  episodeNumber: number;
  title: string;
  narration: string;
  sceneDescription: string;
  dialogues: { character: string; line: string }[];
  duration: number;
}

interface ScriptEditorProps {
  episodes: EpisodeData[];
  onUpdate?: (index: number, data: EpisodeData) => void;
  onRegenerate?: (episodeNumber: number) => void;
  onSave?: () => void;
  editable?: boolean;
}

export function ScriptEditor({
  episodes,
  onUpdate,
  onRegenerate,
  onSave,
  editable = true,
}: ScriptEditorProps) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(
    new Set(episodes.map((_, i) => i))
  );

  const toggleExpand = (index: number) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {onSave && (
        <div className="flex justify-end">
          <Button onClick={onSave} className="bg-emerald-600 hover:bg-emerald-500">
            <Save className="h-4 w-4 mr-2" />
            保存剧本
          </Button>
        </div>
      )}

      {episodes.map((episode, index) => (
        <div
          key={episode.episodeNumber}
          className="border border-border/50 rounded-lg overflow-hidden bg-card/50"
        >
          {/* Episode header */}
          <div
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition"
            onClick={() => toggleExpand(index)}
          >
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                第 {episode.episodeNumber} 集
              </Badge>
              <h3 className="font-medium text-sm">{episode.title}</h3>
              <span className="text-xs text-muted-foreground">{episode.duration}s</span>
            </div>
            <div className="flex items-center gap-2">
              {onRegenerate && editable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegenerate(episode.episodeNumber);
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  重新生成
                </Button>
              )}
              {expandedEpisodes.has(index) ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Episode content */}
          {expandedEpisodes.has(index) && (
            <div className="px-4 pb-4 space-y-4 border-t border-border/30">
              {/* Narration */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  🎙️ 旁白
                </label>
                {editable ? (
                  <Textarea
                    value={episode.narration}
                    onChange={(e) =>
                      onUpdate?.(index, { ...episode, narration: e.target.value })
                    }
                    rows={3}
                    className="bg-muted/30 text-sm"
                  />
                ) : (
                  <p className="text-sm bg-muted/30 rounded p-3">{episode.narration}</p>
                )}
              </div>

              {/* Scene description */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  🎨 场景描述
                </label>
                {editable ? (
                  <Textarea
                    value={episode.sceneDescription}
                    onChange={(e) =>
                      onUpdate?.(index, {
                        ...episode,
                        sceneDescription: e.target.value,
                      })
                    }
                    rows={3}
                    className="bg-muted/30 text-sm"
                  />
                ) : (
                  <p className="text-sm bg-muted/30 rounded p-3">
                    {episode.sceneDescription}
                  </p>
                )}
              </div>

              {/* Dialogues */}
              {episode.dialogues.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    💬 对话
                  </label>
                  <div className="space-y-2">
                    {episode.dialogues.map((d, di) => (
                      <div key={di} className="text-sm bg-muted/30 rounded p-2">
                        <span className="font-medium text-emerald-400">{d.character}：</span>
                        <span>{d.line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
