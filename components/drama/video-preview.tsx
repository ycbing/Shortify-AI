"use client";

import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Maximize } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface EpisodeData {
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  voiceoverUrl: string | null;
  videoUrl?: string | null;
}

interface VideoPreviewProps {
  videoUrl: string | null;
  episodes?: EpisodeData[];
}

export function VideoPreview({ videoUrl, episodes = [] }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentEp = episodes[currentEpisode];
  // 优先使用每集的 AI 视频，其次用合并后的完整视频，最后用图片+配音幻灯片
  const currentVideoUrl = currentEp?.videoUrl || videoUrl;

  const handlePlayPause = async () => {
    if (currentVideoUrl && videoRef.current) {
      if (playing) {
        videoRef.current.pause();
        setPlaying(false);
      } else {
        try {
          await videoRef.current.play();
          setPlaying(true);
        } catch {
          // browser autoplay blocked
        }
      }
    } else if (currentEp?.voiceoverUrl && audioRef.current) {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        try {
          await audioRef.current.play();
          setPlaying(true);
        } catch {
          // browser autoplay blocked
        }
      }
    }
  };

  const handlePrev = () => {
    if (currentEpisode > 0) {
      setPlaying(false);
      setCurrentEpisode(currentEpisode - 1);
    }
  };

  const handleNext = () => {
    if (currentEpisode < episodes.length - 1) {
      setPlaying(false);
      setCurrentEpisode(currentEpisode + 1);
    }
  };

  // 切换剧集时加载对应视频/音频
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    // 暂停当前播放
    if (video) { video.pause(); video.currentTime = 0; }
    if (audio) { audio.pause(); audio.currentTime = 0; }

    // 加载新一集
    const epVideoUrl = currentEp?.videoUrl || videoUrl;
    if (epVideoUrl && video) {
      video.src = epVideoUrl;
      video.load();
    }
    if (currentEp?.voiceoverUrl && audio && !epVideoUrl) {
      audio.src = currentEp.voiceoverUrl;
      audio.load();
    }

    setPlaying(false);
  }, [currentEpisode, currentEp?.videoUrl, currentEp?.voiceoverUrl, videoUrl]);

  // 音频播放结束自动下一集
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.onended = () => {
      if (currentEpisode < episodes.length - 1) {
        setCurrentEpisode(currentEpisode + 1);
      } else {
        setPlaying(false);
      }
    };
    return () => { audio.onended = null; };
  }, [currentEpisode, episodes.length]);

  // 视频播放结束自动下一集
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.onended = () => {
      if (currentEpisode < episodes.length - 1) {
        setCurrentEpisode(currentEpisode + 1);
      } else {
        setPlaying(false);
      }
    };
    return () => { video.onended = null; };
  }, [currentEpisode, episodes.length]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div ref={containerRef} className="border border-border/50 rounded-lg overflow-hidden bg-black">
      <video ref={videoRef} className="hidden" />
      <audio ref={audioRef} />

      {/* 视频或幻灯片画面 */}
      <div className="aspect-video relative bg-muted flex items-center justify-center">
        {currentVideoUrl ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            className="w-full h-full object-contain"
            playsInline
            controls
          />
        ) : currentEp?.imageUrl ? (
          <img
            src={currentEp.imageUrl}
            alt={`第 ${currentEp.episodeNumber} 集`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-center">
            <span className="text-4xl mb-2 block">🎬</span>
            <p className="text-sm text-muted-foreground">暂无预览</p>
          </div>
        )}

        {/* 集数指示器（幻灯片模式或有多集时显示） */}
        {episodes.length > 1 && (
          <div className="absolute bottom-2 right-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
            {currentEpisode + 1} / {episodes.length}
          </div>
        )}

        {/* AI 视频标记 */}
        {currentEp?.videoUrl && (
          <div className="absolute top-2 left-2 text-xs text-emerald-400 bg-black/50 px-2 py-1 rounded">
            AI 视频
          </div>
        )}
      </div>

      {/* 控制栏（仅幻灯片模式显示自定义控制，视频模式用原生 controls） */}
      {!currentVideoUrl && (
        <div className="flex items-center justify-center gap-2 p-3 bg-card">
          <Button variant="ghost" size="sm" onClick={handlePrev} disabled={currentEpisode === 0}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePlayPause}
            className="bg-emerald-600 hover:bg-emerald-500 border-emerald-600"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleNext} disabled={currentEpisode === episodes.length - 1}>
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleFullscreen}>
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
