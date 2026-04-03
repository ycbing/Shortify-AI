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
import { Download, Loader2, Check, FileVideo } from "lucide-react";
import { toast } from "sonner";

interface ExportDialogProps {
  dramaId: string;
  dramaTitle?: string;
  episodeCount: number;
}

interface EpisodeDownload {
  episodeNumber: number;
  title: string | null;
  url: string;
  filename: string;
}

export function ExportDialog({ dramaId, dramaTitle, episodeCount }: ExportDialogProps) {
  const [format, setFormat] = useState("full");
  const [withSubtitle, setWithSubtitle] = useState("yes");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [downloadData, setDownloadData] = useState<{
    url?: string;
    filename?: string;
    episodes?: EpisodeDownload[];
  } | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setDownloadData(null);

    try {
      const res = await fetch(`/api/dramas/${dramaId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, withSubtitle: withSubtitle === "yes" }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "导出失败，请稍后重试");
        return;
      }

      if (format === "full") {
        setDownloadData({ url: data.url, filename: data.filename });
        // Auto-download
        if (data.url) {
          triggerDownload(data.url, data.filename);
          toast.success("导出成功，视频已开始下载");
        } else {
          toast.error("导出文件未找到");
        }
      } else {
        setDownloadData({ episodes: data.episodes });
        // Download all episodes
        for (const ep of data.episodes || []) {
          if (ep.url) {
            triggerDownload(ep.url, ep.filename);
          }
        }
        toast.success(`已开始下载 ${data.episodes?.length || 0} 个分集`);
      }
    } catch {
      toast.error("导出失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const resetAndClose = () => {
    setOpen(false);
    setTimeout(() => setDownloadData(null), 200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetAndClose(); }}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-500">
          <Download className="h-4 w-4 mr-2" />
          导出视频
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border/50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出视频</DialogTitle>
        </DialogHeader>

        {!downloadData ? (
          <div className="space-y-4 py-2">
            {/* Format selection */}
            <div className="space-y-2">
              <Label>导出方式</Label>
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

            {/* Subtitle option */}
            <div className="space-y-2">
              <Label>字幕</Label>
              <Select value={withSubtitle} onValueChange={setWithSubtitle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">带字幕</SelectItem>
                  <SelectItem value="no">不带字幕</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>共 {episodeCount} 集 · 格式 MP4</p>
              <p>文件将通过浏览器直接下载</p>
            </div>

            <Button
              onClick={handleExport}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 min-h-[44px]"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  正在准备下载...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  开始导出
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Check className="h-5 w-5 text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-400">导出成功，已开始下载</span>
            </div>

            {downloadData.url && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">如果下载未开始，请点击下方按钮：</p>
                <Button
                  variant="outline"
                  onClick={() => triggerDownload(downloadData.url!, downloadData.filename || "video.mp4")}
                  className="w-full min-h-[44px]"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {downloadData.filename || "下载视频"}
                </Button>
              </div>
            )}

            {downloadData.episodes && downloadData.episodes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">分集下载链接：</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {downloadData.episodes.map((ep) => (
                    <Button
                      key={ep.episodeNumber}
                      variant="outline"
                      size="sm"
                      onClick={() => triggerDownload(ep.url, ep.filename)}
                      className="w-full justify-start text-xs min-h-[36px]"
                    >
                      <FileVideo className="h-3 w-3 mr-2 shrink-0" />
                      第 {ep.episodeNumber} 集 - {ep.title || "未命名"}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button
              variant="secondary"
              onClick={resetAndClose}
              className="w-full min-h-[44px]"
            >
              关闭
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
