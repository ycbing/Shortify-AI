"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RefreshCw,
  Loader2,
  Image as ImageIcon,
  Film,
  Check,
  X,
  Pencil,
  AudioLines,
} from "lucide-react";

export type ShotStatus = "pending" | "generating" | "ready" | "error";

export interface ShotEditFields {
  visual?: string;
  line?: string;
  subtitle?: string;
  emotion?: string;
  sfx?: string;
  duration?: number;
}

interface ShotCardProps {
  shotNumber: number;
  visual: string;
  duration: number;
  type?: "dialogue" | "narration";
  character?: string;
  line?: string;
  subtitle?: string;
  emotion?: string;
  sfx?: string;
  imageUrl?: string | null;
  aiVideoUrl?: string | null;
  aiVideoStatus?: ShotStatus;
  onRegenerateImage?: () => void;
  onRegenerateVoiceover?: () => void;
  onGenerateVideo?: () => void;
  onEditSave?: (fields: ShotEditFields) => Promise<boolean> | void;
}

export function ShotCard({
  shotNumber,
  visual,
  duration,
  type,
  character,
  line,
  subtitle,
  emotion,
  sfx,
  imageUrl,
  aiVideoUrl,
  aiVideoStatus,
  onRegenerateImage,
  onRegenerateVoiceover,
  onGenerateVideo,
  onEditSave,
}: ShotCardProps) {
  const [imgError, setImgError] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ShotEditFields>({});

  const openEdit = () => {
    setDraft({
      visual,
      line: line || "",
      subtitle: subtitle || "",
      emotion: emotion || "",
      sfx: sfx || "",
      duration,
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!onEditSave) return;
    setSaving(true);
    try {
      const ok = await onEditSave({
        visual: draft.visual?.trim() || visual,
        ...(type === "dialogue" ? { line: draft.line?.trim() || "" } : { subtitle: draft.subtitle?.trim() || "" }),
        emotion: draft.emotion?.trim() || "",
        sfx: draft.sfx?.trim() || "",
        duration: draft.duration || duration,
      });
      if (ok !== false) setEditOpen(false);
    } finally {
      setSaving(false);
    }
  };

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
          {emotion && (
            <Badge variant="outline" className="text-[10px] bg-black/60 border-0 text-amber-300">
              {emotion}
            </Badge>
          )}
          {sfx && (
            <Badge variant="outline" className="text-[10px] bg-black/60 border-0 text-sky-300">
              ♪ {sfx.split(/[,，;；]/)[0]}
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
        <div className="flex items-center gap-1 flex-wrap pt-1">
          {onEditSave && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={openEdit}
            >
              <Pencil className="h-3 w-3 mr-1" />
              编辑
            </Button>
          )}
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
          {onRegenerateVoiceover && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onRegenerateVoiceover}
            >
              <AudioLines className="h-3 w-3 mr-1" />
              重配音
            </Button>
          )}
          {imageUrl && onGenerateVideo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-emerald-500 hover:text-emerald-400"
              onClick={onGenerateVideo}
            >
              <Film className="h-3 w-3 mr-1" />
              {aiVideoUrl ? "重做视频" : "生成视频"}
            </Button>
          )}
          {aiVideoUrl && !onGenerateVideo && (
            <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
              <Check className="h-3 w-3" /> 视频已生成
            </span>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">
              编辑镜头 #{shotNumber}
              {character ? ` · ${character}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {type === "dialogue" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`shot-line-${shotNumber}`}>台词</Label>
                <Textarea
                  id={`shot-line-${shotNumber}`}
                  rows={2}
                  value={draft.line || ""}
                  onChange={(e) => setDraft({ ...draft, line: e.target.value })}
                  placeholder="角色台词"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor={`shot-subtitle-${shotNumber}`}>旁白/字幕</Label>
                <Textarea
                  id={`shot-subtitle-${shotNumber}`}
                  rows={2}
                  value={draft.subtitle || ""}
                  onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
                  placeholder="旁白或字幕文本"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`shot-visual-${shotNumber}`}>画面描述（用于重新生图）</Label>
              <Textarea
                id={`shot-visual-${shotNumber}`}
                rows={3}
                value={draft.visual || ""}
                onChange={(e) => setDraft({ ...draft, visual: e.target.value })}
                placeholder="镜头画面描述（角色动作、表情、场景细节）"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`shot-emotion-${shotNumber}`}>情绪基调</Label>
                <Input
                  id={`shot-emotion-${shotNumber}`}
                  maxLength={12}
                  value={draft.emotion || ""}
                  onChange={(e) => setDraft({ ...draft, emotion: e.target.value })}
                  placeholder="如：紧张 / 开心 / 悲伤"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`shot-duration-${shotNumber}`}>时长（秒）</Label>
                <Input
                  id={`shot-duration-${shotNumber}`}
                  type="number"
                  min={1}
                  max={60}
                  value={draft.duration ?? duration}
                  onChange={(e) =>
                    setDraft({ ...draft, duration: Number(e.target.value) || duration })
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`shot-sfx-${shotNumber}`}>环境音效（可选）</Label>
              <Input
                id={`shot-sfx-${shotNumber}`}
                maxLength={60}
                value={draft.sfx || ""}
                onChange={(e) => setDraft({ ...draft, sfx: e.target.value })}
                placeholder="如：rain / wind,door（可用：rain wind thunder fire water heartbeat clock tension traffic）"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              保存后可用「换图 / 重配音 / 重做视频」按需重新生成该镜头资源（重跑视频消耗 20 积分，换图 1 积分）
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(false)} disabled={saving}>
                <X className="h-3 w-3 mr-1" />
                取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500">
                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
