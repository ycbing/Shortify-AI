"use client";

import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Maximize, FileText, RotateCw } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

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
  defaultEpisode?: number;
}

/** Convert a local upload path to a public /api/uploads/ URL */
function toPublicUrl(localPath: string | null | undefined): string | null {
  if (!localPath) return null;
  if (localPath.startsWith("http")) return localPath;
  return `/api/uploads/${localPath.replace(/^\.?\/?uploads\/?/, "")}`;
}

export function VideoPreview({ videoUrl, episodes = [], defaultEpisode }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(defaultEpisode || 0);
  const [showRotateHint, setShowRotateHint] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync with external defaultEpisode changes (e.g. from episode list in parent)
  useEffect(() => {
    if (defaultEpisode !== undefined) {
      setCurrentEpisode(defaultEpisode);
    }
  }, [defaultEpisode]);

  const currentEp = episodes[currentEpisode];
  const currentVideoUrl = currentEp?.videoUrl || videoUrl;
  const currentSubtitleUrl = currentEp?.subtitleUrl
    ? currentEp.subtitleUrl.startsWith("/api/") ? currentEp.subtitleUrl : toPublicUrl(currentEp.subtitleUrl)
    : null;

  // Detect mobile + portrait → show rotate hint
  useEffect(() => {
    const checkOrientation = () => {
      const isMobile = window.innerWidth < 768;
      const isPortrait = window.innerHeight > window.innerWidth;
      setShowRotateHint(isMobile && isPortrait && !!currentVideoUrl);
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, [currentVideoUrl]);

  // Track fullscreen state
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  const hideControlsDelayed = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setShowControls(true);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const handlePlayPause = async () => {
    if (currentVideoUrl && videoRef.current) {
      if (playing) {
        videoRef.current.pause();
        setPlaying(false);
      } else {
        try {
          await videoRef.current.play();
          setPlaying(true);
          hideControlsDelayed();
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

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement) {
        // Try to enter landscape fullscreen on mobile
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
          await (el as HTMLDivElement & { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen();
        }
        // Try to lock to landscape on mobile
        try {
          (screen.orientation as ScreenOrientation & { lock?: (orient: string) => Promise<void> }).lock?.("landscape");
        } catch { /* not supported */ }
      } else {
        (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
        await document.exitFullscreen();
      }
    } catch {
      // fullscreen not supported
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

  return (
    <div ref={containerRef} className="border border-border/50 rounded-lg overflow-hidden bg-black relative">
      {/* Hidden elements for ref-based control */}
      <audio ref={audioRef} />

      {/* Video or slideshow display — full width on mobile */}
      <div
        className="aspect-video relative bg-muted flex items-center justify-center"
        onClick={currentVideoUrl ? handlePlayPause : undefined}
      >
        {currentVideoUrl ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            className="w-full h-full object-contain"
            playsInline
            controls={!isFullscreen}
            controlsList="nodownload"
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

        {/* Play/Pause overlay for video (tap to toggle) */}
        {currentVideoUrl && !playing && !isFullscreen && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <Play className="h-8 w-8 sm:h-10 sm:w-10 text-white ml-1" />
            </div>
          </div>
        )}

        {/* Fullscreen controls overlay */}
        {currentVideoUrl && isFullscreen && (
          <>
            <div
              className="absolute inset-0 flex items-center justify-center z-10"
              onClick={handlePlayPause}
            >
              {!playing && (
                <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                  <Play className="h-10 w-10 text-white ml-1" />
                </div>
              )}
            </div>
            {/* Bottom control bar */}
            <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  disabled={currentEpisode === 0}
                  className="text-white hover:text-white min-h-[48px] min-w-[48px]"
                >
                  <SkipBack className="h-6 w-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePlayPause}
                  className="text-white hover:text-white min-h-[48px] min-w-[48px]"
                >
                  {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNext}
                  disabled={currentEpisode === episodes.length - 1}
                  className="text-white hover:text-white min-h-[48px] min-w-[48px]"
                >
                  <SkipForward className="h-6 w-6" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullscreen}
                className="text-white hover:text-white min-h-[48px] min-w-[48px]"
              >
                <Maximize className="h-5 w-5" />
              </Button>
            </div>
          </>
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

        {/* Landscape rotation hint for mobile */}
        {showRotateHint && !isFullscreen && (
          <div
            className="absolute inset-0 z-30 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 cursor-pointer"
            onClick={toggleFullscreen}
          >
            <RotateCw className="h-10 w-10 text-white/80 animate-[spin_3s_linear_infinite]" />
            <p className="text-sm text-white/90 font-medium">横屏观看体验更佳</p>
            <p className="text-xs text-white/60">点击全屏播放</p>
          </div>
        )}
      </div>

      {/* Custom controls — slideshow mode (no native video) */}
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
