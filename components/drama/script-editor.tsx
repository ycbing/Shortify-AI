"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Save,
  ChevronDown,
  ChevronUp,
  Users,
  Film,
  Mic,
  MessageCircle,
  Music,
  FileText,
  Palette,
  Clapperboard,
} from "lucide-react";
import type {
  Character,
  Shot,
  GeneratedEpisodeV2,
} from "@/types/drama";
import { VOICE_OPTIONS, BGM_LABELS } from "@/types/drama";
import type { BgmType } from "@/types/drama";

// ============ V2: Shot-based editor ============

interface CharacterListProps {
  characters: Character[];
}

function CharacterList({ characters }: CharacterListProps) {
  if (characters.length === 0) return null;

  return (
    <div className="border border-border/50 rounded-lg bg-card/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <Users className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-medium">角色列表</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
        {characters.map((char) => (
          <div
            key={char.name}
            className="bg-muted/30 rounded-lg p-3 space-y-1"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{char.name}</span>
              <Badge variant="outline" className="text-xs">
                <Mic className="h-2.5 w-2.5 mr-1" />
                {getVoiceLabel(char.voiceId)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{char.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getVoiceLabel(voiceId: string): string {
  for (const [label, id] of Object.entries(VOICE_OPTIONS)) {
    if (id === voiceId) return label;
  }
  return voiceId;
}

interface ShotTimelineProps {
  shots: Shot[];
}

function ShotTimeline({ shots }: ShotTimelineProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
        <span className="w-8">镜头</span>
        <span className="w-16">时长</span>
        <span className="w-16">类型</span>
        <span className="flex-1">画面</span>
        <span className="w-12">BGM</span>
      </div>
      {shots.map((shot) => (
        <div
          key={shot.shotNumber}
          className={`rounded-lg p-3 text-sm ${
            shot.type === "dialogue"
              ? "bg-emerald-500/5 border border-emerald-500/20"
              : "bg-muted/30 border border-border/30"
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="text-xs font-mono text-muted-foreground mt-0.5 w-8 shrink-0">
              #{shot.shotNumber}
            </span>
            <div className="flex-1 space-y-1.5">
              {/* Duration + Type */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{shot.duration}s</span>
                {shot.type === "dialogue" ? (
                  <Badge
                    variant="outline"
                    className="text-xs text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  >
                    <MessageCircle className="h-2.5 w-2.5 mr-1" />
                    对话
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    <Film className="h-2.5 w-2.5 mr-1" />
                    旁白
                  </Badge>
                )}
                {shot.bgm && (
                  <Badge variant="outline" className="text-xs">
                    <Music className="h-2.5 w-2.5 mr-1" />
                    {BGM_LABELS[shot.bgm as BgmType] || shot.bgm}
                  </Badge>
                )}
              </div>

              {/* Visual description */}
              <p className="text-sm">{shot.visual}</p>

              {/* Dialogue or subtitle */}
              {shot.type === "dialogue" && shot.line && (
                <div className="text-sm bg-emerald-500/5 rounded p-2 border-l-2 border-emerald-500/40">
                  <span className="font-medium text-emerald-400">
                    {shot.character}：
                  </span>
                  <span>{shot.line}</span>
                </div>
              )}
              {shot.subtitle && shot.type !== "dialogue" && (
                <p className="text-xs text-muted-foreground italic inline-flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" />
                  {shot.subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============ V1: Legacy editor (backward compat) ============

interface EpisodeDataV1 {
  episodeNumber: number;
  title: string;
  narration: string;
  sceneDescription: string;
  dialogues: { character: string; line: string }[];
  duration: number;
}

interface ScriptEditorV1Props {
  episodes: EpisodeDataV1[];
  onUpdate?: (index: number, data: EpisodeDataV1) => void;
  onRegenerate?: (episodeNumber: number) => void;
  onSave?: () => void;
  editable?: boolean;
}

function ScriptEditorV1({
  episodes,
  onUpdate,
  onRegenerate,
  onSave,
  editable = true,
}: ScriptEditorV1Props) {
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

          {expandedEpisodes.has(index) && (
            <div className="px-4 pb-4 space-y-4 border-t border-border/30">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 inline-flex items-center gap-1 block">
                  <Mic className="h-3 w-3 text-muted-foreground" />
                  旁白
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

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 inline-flex items-center gap-1 block">
                  <Palette className="h-3 w-3 text-muted-foreground" />
                  场景描述
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

              {episode.dialogues.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 inline-flex items-center gap-1 block">
                    <MessageCircle className="h-3 w-3 text-muted-foreground" />
                    对话
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

// ============ V2 Editor ============

interface EpisodeDataV2 {
  episodeNumber: number;
  title: string;
  sceneDescription: string;
  shots: Shot[];
}

interface ScriptEditorV2Props {
  episodes: EpisodeDataV2[];
  onUpdate?: (index: number, data: EpisodeDataV2) => void;
  onRegenerate?: (episodeNumber: number) => void;
  onSave?: () => void;
  editable?: boolean;
}

function ScriptEditorV2({
  episodes,
  onUpdate,
  onRegenerate,
  onSave,
  editable = true,
}: ScriptEditorV2Props) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(
    new Set(episodes.map((_, i) => i))
  );

  const toggleExpand = (index: number) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const totalShots = episodes.reduce((sum, ep) => sum + ep.shots.length, 0);
  const totalDuration = episodes.reduce(
    (sum, ep) => sum + ep.shots.reduce((s, shot) => s + (shot.duration || 0), 0),
    0
  );

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

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{episodes.length} 集</span>
        <span>·</span>
        <span>{totalShots} 个镜头</span>
        <span>·</span>
        <span>总时长 {totalDuration}s</span>
      </div>

      {episodes.map((episode, index) => {
        const epDuration = episode.shots.reduce(
          (s, shot) => s + (shot.duration || 0),
          0
        );

        return (
          <div
            key={episode.episodeNumber}
            className="border border-border/50 rounded-lg overflow-hidden bg-card/50"
          >
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition"
              onClick={() => toggleExpand(index)}
            >
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                >
                  第 {episode.episodeNumber} 集
                </Badge>
                <h3 className="font-medium text-sm">{episode.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {episode.shots.length} 镜头 · {epDuration}s
                </span>
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

            {expandedEpisodes.has(index) && (
              <div className="px-4 pb-4 space-y-4 border-t border-border/30">
                {/* Scene description */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 inline-flex items-center gap-1 block">
                    <Palette className="h-3 w-3 text-muted-foreground" />
                    场景描述
                  </label>
                  <p className="text-sm bg-muted/30 rounded p-3">
                    {episode.sceneDescription}
                  </p>
                </div>

                {/* Shot timeline */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 inline-flex items-center gap-1 block">
                    <Clapperboard className="h-3 w-3 text-muted-foreground" />
                    镜头时间线
                  </label>
                  <ShotTimeline shots={episode.shots} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============ Unified Script Editor (auto-detects v1 vs v2) ============

interface ScriptEditorProps {
  episodes: unknown[];
  characters?: Character[];
  onUpdate?: (index: number, data: unknown) => void;
  onRegenerate?: (episodeNumber: number) => void;
  onSave?: () => void;
  editable?: boolean;
}

export function ScriptEditor({
  episodes,
  characters,
  onUpdate,
  onRegenerate,
  onSave,
  editable = true,
}: ScriptEditorProps) {
  // Detect if episodes have shots (v2) or narration (v1)
  const isV2 = episodes.length > 0 && "shots" in (episodes[0] as Record<string, unknown>);

  return (
    <div className="space-y-6">
      {/* V2: Show character list */}
      {isV2 && characters && characters.length > 0 && (
        <CharacterList characters={characters} />
      )}

      {/* V1 or V2 editor */}
      {isV2 ? (
        <ScriptEditorV2
          episodes={episodes as EpisodeDataV2[]}
          onUpdate={onUpdate as (index: number, data: EpisodeDataV2) => void}
          onRegenerate={onRegenerate}
          onSave={onSave}
          editable={editable}
        />
      ) : (
        <ScriptEditorV1
          episodes={episodes as EpisodeDataV1[]}
          onUpdate={onUpdate as (index: number, data: EpisodeDataV1) => void}
          onRegenerate={onRegenerate}
          onSave={onSave}
          editable={editable}
        />
      )}
    </div>
  );
}

// Re-export legacy interface for backward compat
export type { EpisodeDataV1 };
