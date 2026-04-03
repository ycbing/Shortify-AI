import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import type { Shot, ShotAudio } from "@/types/drama";

const execAsync = promisify(exec);

export interface ComposeOptions {
  imagePath: string;
  audioPath: string;
  outputPath: string;
  subtitlePath?: string;
  resolution?: "1280x720" | "1920x1080";
  fadeDuration?: number; // seconds
}

// ============ Legacy: single-image + audio composition ============

export async function composeVideo(options: ComposeOptions): Promise<string> {
  const {
    imagePath,
    audioPath,
    outputPath,
    subtitlePath,
    resolution = "1280x720",
    fadeDuration = 0.5,
  } = options;

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  if (subtitlePath) {
    // Subtitle version — simplified without fade for compatibility
    const cmd = `ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:color=black,subtitles='${subtitlePath}'" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
  } else {
    // Get audio duration for fade out
    let audioDuration = 30;
    try {
      const { stdout: durationStr } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
      );
      audioDuration = parseFloat(durationStr.trim()) || 30;
    } catch {
      // use default
    }

    const vfFilter = `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${audioDuration - fadeDuration}:d=${fadeDuration}`;

    const cmd = `ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "${vfFilter}" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
  }

  return outputPath;
}

// ============ V2: shot-based composition ============

interface ShotComposeInput {
  shot: Shot;
  shotAudio: ShotAudio;
  imageUrl?: string | null;
  videoUrl?: string | null; // CogVideoX video if available
}

type KenBurnsEffect = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "zoom-in-left" | "zoom-in-right" | "zoom-out-left" | "zoom-out-right";

/**
 * Pick a Ken Burns effect based on shot number for variety.
 * Alternating between different movements across shots.
 */
function pickKenBurnsEffect(shotNumber: number): KenBurnsEffect {
  const effects: KenBurnsEffect[] = [
    "zoom-in", "pan-right", "zoom-out", "pan-left",
    "zoom-in-right", "zoom-out-left", "pan-down",
    "zoom-in-left", "pan-up", "zoom-out-right",
  ];
  return effects[(shotNumber - 1) % effects.length];
}

/**
 * Build zoompan filter string for a given Ken Burns effect.
 * Returns the zoompan filter expression and the scale+framerate prepended.
 */
function buildKenBurnsFilter(effect: KenBurnsEffect, totalFrames: number): string {
  // Base scale to 1280x720, ensure image covers the frame
  const scale = "scale=1280:720";

  switch (effect) {
    case "zoom-in":
      // Slow zoom in from center
      return `${scale},zoompan=z='min(zoom+0.002,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "zoom-out":
      // Start zoomed in, slowly pull back
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "pan-left":
      // Pan from right to left while slightly zooming
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw-iw/zoom-(on*(iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "pan-right":
      // Pan from left to right while slightly zooming
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='(on*(iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "pan-up":
      // Pan from bottom to top
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih-ih/zoom-(on*(ih-ih/zoom)/${totalFrames})':s=1280x720`;

    case "pan-down":
      // Pan from top to bottom
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='(on*(ih-ih/zoom)/${totalFrames})':s=1280x720`;

    case "zoom-in-left":
      // Zoom in focusing on left third
      return `${scale},zoompan=z='min(zoom+0.002,1.4)':d=${totalFrames}:x='iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "zoom-in-right":
      // Zoom in focusing on right third
      return `${scale},zoompan=z='min(zoom+0.002,1.4)':d=${totalFrames}:x='2*iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "zoom-out-left":
      // Start zoomed on left, pull back to center
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1280x720`;

    case "zoom-out-right":
      // Start zoomed on right, pull back to center
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='2*iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1280x720`;

    default:
      return `${scale},zoompan=z='min(zoom+0.002,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720`;
  }
}

/**
 * Compose a single shot into a video clip (without subtitles).
 * Subtitles are burned into the final video after concatenation for perfect timing.
 */
async function composeShotVideo(
  input: ShotComposeInput,
  outputDir: string,
  _episodeSubtitlePath?: string
): Promise<string> {
  const { shot, shotAudio } = input;
  const outputPath = path.join(outputDir, `shot-${shot.shotNumber}.mp4`);

  // If CogVideoX video exists, use it and add audio
  if (input.videoUrl) {
    const cmd = `ffmpeg -i "${input.videoUrl}" -i "${shotAudio.audioUrl}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
    return outputPath;
  }

  // Otherwise: image + Ken Burns + audio (with varied effects per shot)
  if (input.imageUrl) {
    const durationMs = Math.round(shotAudio.duration * 1000);
    const zoompanDuration = Math.max(1, Math.ceil(shotAudio.duration * 25)); // d is in frames (25fps)

    const effect = pickKenBurnsEffect(shot.shotNumber);
    const kenBurnsFilter = buildKenBurnsFilter(effect, zoompanDuration);

    // Fade in/out for smooth transitions between shots
    const fadeDuration = Math.min(0.5, shotAudio.duration * 0.15);

    const filterComplex = `[0:v]${kenBurnsFilter},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${shotAudio.duration - fadeDuration}:d=${fadeDuration}[v];[1:a]anull[a]`;
    const cmd = `ffmpeg -loop 1 -i "${input.imageUrl}" -i "${shotAudio.audioUrl}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -t ${shotAudio.duration} -pix_fmt yuv420p -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
    return outputPath;
  }

  // No image or video — just audio as video (black frame)
  const cmd = `ffmpeg -f lavfi -i color=c=black:s=1280x720:d=${shotAudio.duration} -i "${shotAudio.audioUrl}" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
  await execAsync(cmd, { timeout: 120000 });
  return outputPath;
}

/**
 * Compose an episode from shots (V2 format).
 * 1. For each shot, create a video clip (image+Ken Burns or CogVideoX)
 * 2. Concat all shot clips into the episode video
 */
export async function composeEpisodeFromShots(
  shots: Shot[],
  shotAudios: ShotAudio[],
  dramaId: string,
  episodeNumber: number,
  options?: {
    imageUrl?: string | null;
    subtitlePath?: string | null;
    shotImages?: Map<number, string>; // shotNumber -> image path
    shotVideos?: Map<number, string>; // shotNumber -> video path
    bgmPath?: string | null; // BGM file path to mix into final video
    bgmVolume?: number; // BGM volume (0-1), default 0.15
  }
): Promise<string> {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const episodeDir = path.join(uploadDir, "videos", dramaId);
  const tempDir = path.join(episodeDir, `episode-${episodeNumber}-temp`);
  const outputPath = path.join(episodeDir, `episode-${episodeNumber}.mp4`);

  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(episodeDir, { recursive: true });

  // Build audio map
  const audioMap = new Map<number, ShotAudio>();
  for (const audio of shotAudios) {
    audioMap.set(audio.shotNumber, audio);
  }

  const shotVideoPaths: string[] = [];

  for (const shot of shots) {
    const audio = audioMap.get(shot.shotNumber);
    if (!audio) {
      console.warn(`No audio for shot ${shot.shotNumber}, skipping`);
      continue;
    }

    const shotVideo = await composeShotVideo(
      {
        shot,
        shotAudio: audio,
        imageUrl: options?.shotImages?.get(shot.shotNumber) || options?.imageUrl,
        videoUrl: options?.shotVideos?.get(shot.shotNumber),
      },
      tempDir,
      options?.subtitlePath || undefined
    );

    shotVideoPaths.push(shotVideo);
  }

  // Concat all shot videos
  if (shotVideoPaths.length === 0) {
    throw new Error("No shot videos to concatenate");
  }

  const rawOutputPath = shotVideoPaths.length === 1
    ? outputPath
    : path.join(episodeDir, `episode-${episodeNumber}-raw.mp4`);

  if (shotVideoPaths.length === 1) {
    // Just rename/copy the single file
    await fs.copyFile(shotVideoPaths[0], rawOutputPath);
  } else {
    // Use ffmpeg concat demuxer
    const concatListPath = path.join(tempDir, "concat-list.txt");
    const concatContent = shotVideoPaths
      .map((p) => `file '${p}'`)
      .join("\n");
    await fs.writeFile(concatListPath, concatContent);

    // Re-encode to ensure compatible formats (some filters produce non-concat-compatible streams)
    const cmd = `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -c:a aac -movflags +faststart -y "${rawOutputPath}"`;
    await execAsync(cmd, { timeout: 300000 });
  }

  // Burn subtitles into the final video (after concat for accurate timing)
  let finalOutputPath = outputPath;
  if (options?.subtitlePath) {
    const escapedSubPath = options.subtitlePath.replace(/'/g, "'\\''");
    const cmd = `ffmpeg -i "${rawOutputPath}" -vf "subtitles='${escapedSubPath}'" -c:v libx264 -c:a aac -movflags +faststart -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 300000 });

    // Remove raw version if it's a separate file
    if (rawOutputPath !== outputPath) {
      await fs.unlink(rawOutputPath).catch(() => {});
    }
  }

  // Mix BGM into the final video
  if (options?.bgmPath) {
    const bgmVol = options.bgmVolume ?? 0.15;
    const bgmMixedPath = path.join(episodeDir, `episode-${episodeNumber}-bgm.mp4`);
    const cmd = `ffmpeg -i "${finalOutputPath}" -i "${options.bgmPath}" -filter_complex "[1:a]volume=${bgmVol},afade=t=in:st=0:d=1,afade=t=out:st=60:d=2[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -movflags +faststart -y "${bgmMixedPath}"`;
    await execAsync(cmd, { timeout: 300000 }).catch(async (err) => {
      console.warn("BGM mixing failed, using video without BGM:", err);
      return;
    });
    // Replace with BGM-mixed version
    try {
      await fs.access(bgmMixedPath);
      if (bgmMixedPath !== outputPath && bgmMixedPath !== finalOutputPath) {
        if (finalOutputPath !== outputPath) {
          await fs.unlink(finalOutputPath).catch(() => {});
        }
        await fs.rename(bgmMixedPath, outputPath);
      }
      finalOutputPath = outputPath;
    } catch {
      // BGM mixing failed, keep original
    }
  }

  // Clean up temp files
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  return outputPath;
}

// ============ Utilities ============

export async function mergeVideos(
  videoPaths: string[],
  outputPath: string,
  _transitionDuration?: number
): Promise<string> {
  if (videoPaths.length === 0) {
    throw new Error("No video paths provided");
  }

  if (videoPaths.length === 1) {
    return videoPaths[0];
  }

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const concatListPath = path.join(dir, "concat-list.txt");
  const concatContent = videoPaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(concatListPath, concatContent);

  const cmd = `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${outputPath}"`;
  await execAsync(cmd, { timeout: 300000 });

  await fs.unlink(concatListPath).catch(() => {});

  return outputPath;
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return Math.ceil(parseFloat(stdout.trim()) || 0);
}
