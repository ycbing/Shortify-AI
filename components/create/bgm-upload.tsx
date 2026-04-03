"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Music, Upload, X, Play, Pause, Loader2 } from "lucide-react";

interface BgmUploadProps {
  /** If a dramaId is provided, uploads will be persisted to server */
  dramaId?: string;
  /** Current BGM URL (relative path) */
  value?: string | null;
  /** Called when BGM file is successfully uploaded */
  onChange: (bgmUrl: string | null) => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPT_TYPES = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/x-wav", "audio/wave"];

export function BgmUpload({ dramaId, value, onChange }: BgmUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = value ? `/api/uploads/${value.replace(/^\.?\/?uploads\/?/, "")}` : null;

  const handleFile = useCallback(
    async (file: File) => {
      if (!ACCEPT_TYPES.includes(file.type) && !file.name.match(/\.(mp3|wav)$/i)) {
        setUploadError("请上传 MP3 或 WAV 格式的音频文件");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setUploadError("文件大小不能超过 20MB");
        return;
      }

      setUploadError("");
      setUploading(true);
      setFileName(file.name);

      try {
        // If dramaId, upload to server
        if (dramaId) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("dramaId", dramaId);

          const res = await fetch("/api/upload-bgm", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "上传失败");
          }

          const data = await res.json();
          onChange(data.bgmUrl);
        } else {
          // No dramaId — just create a preview URL (temporary)
          const objectUrl = URL.createObjectURL(file);
          onChange(objectUrl);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "上传失败");
        setFileName(null);
      } finally {
        setUploading(false);
      }
    },
    [dramaId, onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDelete = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
    setFileName(null);
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onChange]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !previewUrl) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }, [playing, previewUrl]);

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium flex items-center gap-2">
        <Music className="h-4 w-4 text-emerald-400" />
        背景音乐（可选）
      </label>
      <p className="text-xs text-muted-foreground">
        上传 MP3 或 WAV 文件作为视频背景音乐，合成时将自动混入
      </p>

      {!value && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
              <p className="text-sm text-muted-foreground">上传中...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                拖拽文件到此处或点击上传
              </p>
              <p className="text-xs text-muted-foreground/60">
                支持 MP3、WAV，最大 20MB
              </p>
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-400">{uploadError}</p>
      )}

      {value && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/50">
          <Button
            variant="outline"
            size="sm"
            onClick={togglePlay}
            className="shrink-0 h-9 w-9 p-0"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <audio
            ref={audioRef}
            src={previewUrl!}
            onEnded={() => setPlaying(false)}
            preload="metadata"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{fileName || "背景音乐"}</p>
            <p className="text-xs text-muted-foreground">背景音乐已就绪</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="shrink-0 h-9 w-9 p-0 text-muted-foreground hover:text-red-400"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
