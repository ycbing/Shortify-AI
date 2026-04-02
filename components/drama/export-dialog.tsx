"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, Loader2 } from "lucide-react";

interface ExportDialogProps {
  dramaId: string;
  episodeCount: number;
  onExport?: (format: string, resolution: string) => Promise<void>;
}

export function ExportDialog({ dramaId, episodeCount, onExport }: ExportDialogProps) {
  const [format, setFormat] = useState("full");
  const [resolution, setResolution] = useState("1280x720");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (!onExport) return;
    setLoading(true);
    try {
      await onExport(format, resolution);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-500">
          <Download className="h-4 w-4 mr-2" />
          导出视频
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader>
          <DialogTitle>导出视频</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>导出格式</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">完整合集（合并所有集）</SelectItem>
                <SelectItem value="episodes">分集导出</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>分辨率</Label>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1280x720">720p (1280×720)</SelectItem>
                <SelectItem value="1920x1080">1080p (1920×1080)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-xs text-muted-foreground">
            共 {episodeCount} 集 · 格式 MP4 · 预计时长 {episodeCount * 45}s
          </div>

          <Button
            onClick={handleExport}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                开始导出
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
