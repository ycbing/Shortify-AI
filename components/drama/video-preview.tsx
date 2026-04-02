"use client";

import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Maximize } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface VideoPreviewProps {
  videoUrl: string | null;
  episodes?: {
    episodeNumber: number;
    title: string;
    imageUrl: string | null;
    voiceoverUrl: string | null;
  }[];
}

export function VideoPreview({ videoUrl, episodes = [] }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Slideshow mode: image + audio sync
  const currentEp = episodes[currentEpisode];

  const handlePlayPause = () => {
    if (videoUrl && videoRef.current) {
      if (playing) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setPlaying(!playing);
    } else if (currentEp?.voiceoverUrl && audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setPlaying(!playing);
    }
  };

  const handlePrev = () => {
    if (currentEpisode > 0) {
      setCurrentEpisode(currentEpisode - 1);
    }
  };

  const handleNext = () => {
    if (currentEpisode < episodes.length - 1) {
      setCurrentEpisode(currentEpisode + 1);
    }
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => {
        if (currentEpisode < episodes.length - 1) {
          setCurrentEpisode(currentEpisode + 1);
        } else {
          setPlaying(false);
        }
      };
    }
  }, [currentEpisode, episodes.length]);

  useEffect(() => {
    if (currentEp?.voiceoverUrl && audioRef.current && playing) {
      audioRef.current.src = currentEp.voiceoverUrl;
      audioRef.current.play();
    }
  }, [currentEpisode]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div ref={containerRef} className="border border-border/50 rounded-lg overflow-hidden bg-black">
      <audio ref={audioRef} />

      {/* Video or Slideshow */}
      <div className="aspect-video relative bg-muted flex items-center justify-center">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            onEnded={() => setPlaying(false)}
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

        {!videoUrl && episodes.length > 1 && (
          <div className="absolute bottom-2 right-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
            {currentEpisode + 1} / {episodes.length}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 p-3 bg-card">
        <Button variant="ghost" size="sm" onClick={handlePrev} disabled={currentEpisode === 0 && !videoUrl}>
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
        <Button variant="ghost" size="sm" onClick={handleNext} disabled={currentEpisode === episodes.length - 1 && !videoUrl}>
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={toggleFullscreen}>
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
