"use client";

import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Maximize, FileText } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface EpisodeData {
  episodeNumber: number;
  title: string;
  imageUrl: string | null;
  voiceoverUrl: string | null;
  videoUrl?: string | null;
  subtitleUrl?: string | null;
}

interface VideoPreviewProps {
  videoUrl: string | null;
  episodes?: EpisodeData[];
}

/** Convert a local upload path to a public /api/uploads/ URL */
function toPublicUrl(localPath: string | null | undefined): string | null {
  if (!localPath) return null;
  if (localPath.startsWith("http")) return localPath;
  return `/api/uploads/${localPath.replace(/^\.?\/?uploads\/?/, "")}`;
}

export function VideoPreview({ videoUrl, episodes = [] }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentEp = episodes[currentEpisode];
  const currentVideoUrl = currentEp?.videoUrl || videoUrl;
  const currentSubtitleUrl = currentEp?.subtitleUrl
    ? currentEp.subtitleUrl.startsWith("/api/") ? currentEp.subtitleUrl : toPublicUrl(currentEp.subtitleUrl)
    : null;

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

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    if (video) { video.pause(); video.currentTime = 0; }
    if (audio) { audio.pause(); audio.currentTime = 0; }

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
      {/* Hidden elements for ref-based control */}
      <audio ref={audioRef} />

      {/* Video or slideshow display — full width on mobile */}
      <div className="aspect-video relative bg-muted flex items-center justify-center">
        {currentVideoUrl ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            className="w-full h-full object-contain"
            playsInline
            controls
          >
            {currentSubtitleUrl && (
              <track
                kind="subtitles"
                src={currentSubtitleUrl}
                srcLang="zh"
                label="中文"
                default
              />
            )}
          </video>
        ) : currentEp?.imageUrl ? (
          <img
            src={currentEp.imageUrl}
            alt={`第 ${currentEp.episodeNumber} 集`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-center">
            <span className="text-4xl sm:text-5xl mx-auto mb-2">🎬</span>
            <p className="text-sm text-muted-foreground">暂无预览</p>
          </div>
        )}

        {/* Episode indicator */}
        {episodes.length > 1 && (
          <div className="absolute bottom-2 right-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
            {currentEpisode + 1} / {episodes.length}
          </div>
        )}

        {/* AI video badge */}
        {currentEp?.videoUrl && (
          <div className="absolute top-2 left-2 text-xs text-emerald-400 bg-black/50 px-2 py-1 rounded">
            AI 视频
          </div>
        )}

        {/* Subtitle badge */}
        {currentSubtitleUrl && (
          <div className="absolute top-2 right-2 text-xs text-blue-400 bg-black/50 px-2 py-1 rounded inline-flex items-center gap-1">
            <FileText className="h-3 w-3 text-blue-400" />
            字幕
          </div>
        )}
      </div>

      {/* Custom controls — larger touch targets on mobile */}
      {!currentVideoUrl && (
        <div className="flex items-center justify-center gap-1 sm:gap-2 p-2 sm:p-3 bg-card">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrev}
            disabled={currentEpisode === 0}
            className="min-h-[44px] min-w-[44px]"
          >
            <SkipBack className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePlayPause}
            className="bg-emerald-600 hover:bg-emerald-500 border-emerald-600 min-h-[44px] min-w-[44px] px-4"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={currentEpisode === episodes.length - 1}
            className="min-h-[44px] min-w-[44px]"
          >
            <SkipForward className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="min-h-[44px] min-w-[44px]"
          >
            <Maximize className="h-5 w-5" />
          </Button>
        </div>
      )}
    </div>
  );
}
