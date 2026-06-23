import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import https from "https";
import http from "http";
import { isCosUrl, cosKeyFromUrl, getSignedCosUrl } from "./cos-storage";
import type { Shot, ShotAudio } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("video-composer");

const execAsync = promisify(exec);

export interface ComposeOptions {
  imagePath: string;
  audioPath: string;
  outputPath: string;
  subtitlePath?: string;
  resolution?: "1280x720" | "1920x1080" | "3840x2160" | "1080x1920";
  fadeDuration?: number; // seconds
  aspectRatio?: "landscape" | "vertical";
}

// ============ Transition types for xfade ============

export type TransitionType =
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "slideleft"
  | "slideright"
  | "wipeleft"
  | "wiperight"
  | "dissolve"
  | "pixelize"
  | "circleopen"
  | "circleclose"
  | "radial"
  | "smoothleft"
  | "smoothright"
  | "none";

const XFADE_MAP: Record<TransitionType, string> = {
  fade: "fade",
  fadeblack: "fadeblack",
  fadewhite: "fadewhite",
  slideleft: "slideleft",
  slideright: "slideright",
  wipeleft: "wipewipeleft",
  wiperight: "wiperight",
  dissolve: "dissolve",
  pixelize: "pixelize",
  circleopen: "circleopen",
  circleclose: "circleclose",
  radial: "radial",
  smoothleft: "smoothleft",
  smoothright: "smoothright",
  none: "none",
};

/**
 * Get the actual duration of a video file using ffprobe.
 */
async function getClipDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Concatenate video clips with xfade transitions.
 * Processes clips pair by pair to build the final output.
 */
export async function concatWithXfade(
  clipPaths: string[],
  outputPath: string,
  transition: TransitionType = "fade",
  transitionDuration: number = 0.5,
  tempDir: string
): Promise<string> {
  if (clipPaths.length === 0) throw new Error("No clips to concat");
  if (clipPaths.length === 1) {
    await fs.copyFile(clipPaths[0], outputPath);
    return outputPath;
  }

  if (transition === "none") {
    // Fallback to simple concat without transitions
    const concatListPath = path.join(tempDir, "concat-list.txt");
    const concatContent = clipPaths.map((p) => `file '${path.relative(tempDir, p)}'`).join("\n");
    await fs.writeFile(concatListPath, concatContent);
    const cmd = `cd "${tempDir}" && ffmpeg -f concat -safe 1 -i concat-list.txt -c copy -y "${path.basename(outputPath)}"`
    await execAsync(cmd, { timeout: 300000 });
    return outputPath;
  }

  const xfadeName = XFADE_MAP[transition] || "fade";
  const td = Math.max(0.3, Math.min(transitionDuration, 2)); // clamp 0.3-2s

  // Normalize all clips to uniform encoding first (h264, aac 44100 stereo)
  const normPaths: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const normPath = path.join(tempDir, `norm-${i}.mp4`);
    const cmd = `ffmpeg -i "${clipPaths[i]}" -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 -c:a aac -ar 44100 -ac 2 -b:a 128k -y "${normPath}"`;
    await execAsync(cmd, { timeout: 180000 });
    normPaths.push(normPath);
  }

  // Pair-wise xfade merge
  let currentPaths = normPaths;
  let pass = 0;

  while (currentPaths.length > 1) {
    pass++;
    const nextPaths: string[] = [];

    for (let i = 0; i < currentPaths.length; i += 2) {
      if (i + 1 >= currentPaths.length) {
        // Odd clip out, carry forward
        nextPaths.push(currentPaths[i]);
        continue;
      }

      const clipA = currentPaths[i];
      const clipB = currentPaths[i + 1];
      const durationA = await getClipDuration(clipA);

      if (durationA <= td) {
 log.warn(`Clip A too short (${durationA.toFixed(1)}s) for xfade (${td}s), concatenating without transition`);
        const simpleOut = path.join(tempDir, `merge-pass${pass}-${nextPaths.length}.mp4`);
        const concatListPath = path.join(tempDir, `concat-pass${pass}-${nextPaths.length}.txt`);
        await fs.writeFile(concatListPath, `file '${path.relative(tempDir, clipA)}'\nfile '${path.relative(tempDir, clipB)}'`);
        await execAsync(`cd "${tempDir}" && ffmpeg -f concat -safe 1 -i "concat-pass${pass}-${nextPaths.length}.txt" -c copy -y "${path.basename(simpleOut)}"`, { timeout: 180000 });
        nextPaths.push(simpleOut);
        continue;
      }

      const offset = durationA - td;
      const mergeOut = path.join(tempDir, `merge-pass${pass}-${nextPaths.length}.mp4`);

      // Video: xfade, Audio: acrossfade
      const cmd = `ffmpeg -i "${clipA}" -i "${clipB}" ` +
        `-filter_complex ` +
        `"[0:v][1:v]xfade=transition=${xfadeName}:duration=${td}:offset=${offset}[v];` +
        `[0:a][1:a]acrossfade=d=${td}:c1=tri:c2=tri[aout]" ` +
        `-map "[v]" -map "[aout]" ` +
        `-c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p ` +
        `-c:a aac -ar 44100 -ac 2 -b:a 128k ` +
        `-y "${mergeOut}"`;

      await execAsync(cmd, { timeout: 300000 }).catch(async (err) => {
        log.warn(`xfade failed, falling back to simple concat: ${err instanceof Error ? err.message : err}`);
        const concatListPath = path.join(tempDir, `concat-fallback-${nextPaths.length}.txt`);
        await fs.writeFile(concatListPath, `file '${path.relative(tempDir, clipA)}'\nfile '${path.relative(tempDir, clipB)}'`);
        await execAsync(`cd "${tempDir}" && ffmpeg -f concat -safe 1 -i "concat-fallback-${nextPaths.length}.txt" -c copy -y "${path.basename(mergeOut)}"`, { timeout: 180000 });
      });

      nextPaths.push(mergeOut);
    }

    currentPaths = nextPaths;
  }

  // Move final result to outputPath
  await fs.rename(currentPaths[0], outputPath);
  return outputPath;
}

// ============ Legacy: single-image + audio composition ============

export async function composeVideo(options: ComposeOptions): Promise<string> {
  const {
    imagePath,
    audioPath,
    outputPath,
    subtitlePath,
    resolution,
    fadeDuration = 0.5,
    aspectRatio = "landscape",
  } = options;

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  // Determine target resolution from aspect ratio
  const targetRes = resolution || (aspectRatio === "vertical" ? "1080x1920" : "1920x1080");

  // Download remote images (COS URLs) to local before passing to ffmpeg
  const localImagePath = imagePath.startsWith("http")
    ? await ensureLocalImage(imagePath, 1, dir)
    : imagePath;

  if (subtitlePath) {
    // Subtitle version — simplified without fade for compatibility
    const cmd = `ffmpeg -loop 1 -i "${localImagePath}" -i "${audioPath}" -vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:color=black,subtitles='${subtitlePath}'" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
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

    const vfFilter = `scale=${targetRes}:force_original_aspect_ratio=decrease,pad=${targetRes}:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${audioDuration - fadeDuration}:d=${fadeDuration}`;

    const cmd = `ffmpeg -loop 1 -i "${localImagePath}" -i "${audioPath}" -vf "${vfFilter}" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
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
function buildKenBurnsFilter(effect: KenBurnsEffect, totalFrames: number, resolution = "1920x1080"): string {
  // Parse resolution
  const [w, h] = resolution.split("x").map(Number);
  const upscaleW = Math.round(w * 1.4);
  const upscaleH = Math.round(h * 1.4);
  const scale = `scale=${upscaleW}:${upscaleH}:flags=lanczos`;

  switch (effect) {
    case "zoom-in":
      // Slow zoom in from center
      return `${scale},zoompan=z='min(zoom+0.002,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "zoom-out":
      // Start zoomed in, slowly pull back
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "pan-left":
      // Pan from right to left while slightly zooming
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw-iw/zoom-(on*(iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "pan-right":
      // Pan from left to right while slightly zooming
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='(on*(iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "pan-up":
      // Pan from bottom to top
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih-ih/zoom-(on*(ih-ih/zoom)/${totalFrames})':s=${w}x${h}`;

    case "pan-down":
      // Pan from top to bottom
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='(on*(ih-ih/zoom)/${totalFrames})':s=${w}x${h}`;

    case "zoom-in-left":
      // Zoom in focusing on left third
      return `${scale},zoompan=z='min(zoom+0.002,1.4)':d=${totalFrames}:x='iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "zoom-in-right":
      // Zoom in focusing on right third
      return `${scale},zoompan=z='min(zoom+0.002,1.4)':d=${totalFrames}:x='2*iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "zoom-out-left":
      // Start zoomed on left, pull back to center
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    case "zoom-out-right":
      // Start zoomed on right, pull back to center
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='2*iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;

    default:
      return `${scale},zoompan=z='min(zoom+0.002,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}`;
  }
}

/**
 * Compose a single shot into a video clip (without subtitles).
 * Subtitles are burned into the final video after concatenation for perfect timing.
 */
async function composeShotVideo(
  input: ShotComposeInput,
  outputDir: string,
  _episodeSubtitlePath?: string,
  aspectRatio: "landscape" | "vertical" = "landscape"
): Promise<string> {
  const { shot, shotAudio } = input;
  const outputPath = path.join(outputDir, `shot-${shot.shotNumber}.mp4`);

  // If CogVideoX video exists, loop video to match audio duration, then add audio
  if (input.videoUrl) {
    // Get audio duration to match
    let audioDuration = shotAudio.duration || 5;
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${shotAudio.audioUrl}"`
      );
      audioDuration = parseFloat(stdout.trim()) || shotAudio.duration || 5;
    } catch {
      // use default
    }

    const fadeDuration = Math.min(0.3, audioDuration * 0.1);
    const scaleFilter = aspectRatio === "vertical"
      ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black"
      : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black";
    const cmd = `ffmpeg -y -stream_loop -1 -i "${input.videoUrl}" -i "${shotAudio.audioUrl}" -filter_complex "[0:v]${scaleFilter},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, audioDuration - fadeDuration)}:d=${fadeDuration}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]" -map "[v]" -map "[a]" -t ${audioDuration} -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
    return outputPath;
  }

    // Otherwise: image + smooth motion + audio
  if (input.imageUrl) {
    // Download remote images (COS URLs) to local before passing to ffmpeg
    const localImagePath = await ensureLocalImage(input.imageUrl, shot.shotNumber, outputDir);
    const duration = shotAudio.duration;
    const fadeDuration = Math.min(0.5, duration * 0.15);

    // Use gentle zoom animation instead of zoompan (much smoother, no jitter)
    const effect = pickKenBurnsEffect(shot.shotNumber);
    let motionFilter: string;
    const targetRes = aspectRatio === "vertical" ? "1080x1920" : "1920x1080";
    const [tw, th] = targetRes.split("x").map(Number);
    const upscaleW = Math.round(tw * 1.1);
    const upscaleH = Math.round(th * 1.1);

    switch (effect) {
      case "zoom-in":
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='min(zoom+0.0008,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
      case "zoom-out":
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='if(eq(on,1),1.12,max(zoom-0.0008,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
      case "pan-left":
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='1.08':x='(iw-iw/zoom)-on*((iw-iw/zoom)/${Math.max(1, Math.ceil(duration * 30))})':y='ih/2-(ih/zoom/2)':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
      case "pan-right":
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='1.08':x='on*((iw-iw/zoom)/${Math.max(1, Math.ceil(duration * 30))})':y='ih/2-(ih/zoom/2)':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
      case "pan-up":
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='1.08':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)-on*((ih-ih/zoom)/${Math.max(1, Math.ceil(duration * 30))})':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
      case "pan-down":
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='1.08':x='iw/2-(iw/zoom/2)':y='on*((ih-ih/zoom)/${Math.max(1, Math.ceil(duration * 30))})':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
      default:
        motionFilter = `scale=${upscaleW}:${upscaleH}:flags=lanczos,zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.max(1, Math.ceil(duration * 30))}:s=${tw}x${th}:fps=30`;
        break;
    }

    const filterComplex = `[0:v]${motionFilter},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]`;
    const cmd = `ffmpeg -loop 1 -i "${localImagePath}" -i "${shotAudio.audioUrl}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset medium -t ${duration} -pix_fmt yuv420p -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 180000 });
    return outputPath;
  }

  // No image or video — just audio as video (black frame)
  const blackSize = aspectRatio === "vertical" ? "1080x1920" : "1920x1080";
  const cmd = `ffmpeg -f lavfi -i color=c=black:s=${blackSize}:d=${shotAudio.duration} -i "${shotAudio.audioUrl}" -c:v libx264 -crf 18 -preset medium -c:a aac -shortest -y "${outputPath}"`;
  await execAsync(cmd, { timeout: 120000 });
  return outputPath;
}

/**
 * Ensure an image path is a local file. If it's a remote URL (COS or otherwise),
 * download it to a temp file and return the local path.
 */
async function ensureLocalImage(imageUrl: string, shotNumber: number, outputDir: string): Promise<string> {
  if (!imageUrl.startsWith("http")) {
    // Already a local path — verify it exists
    await fs.access(imageUrl);
    return imageUrl;
  }

  // Remote URL — download to local temp file
  const localPath = path.join(outputDir, `shot-${shotNumber}-downloaded.jpg`);
  try {
    await fs.access(localPath);
    return localPath; // Already downloaded
  } catch {
    // Need to download
  }

  // For COS private URLs, get a signed URL
  let fetchUrl = imageUrl;
  if (isCosUrl(imageUrl)) {
    const cosKey = cosKeyFromUrl(imageUrl);
    if (cosKey) {
      fetchUrl = getSignedCosUrl(cosKey, 3600);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const doGet = (url: string) => {
      const mod = url.startsWith("https") ? https : http;
      mod.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        const file = createWriteStream(localPath);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", reject);
    };
    doGet(fetchUrl);
  });

  return localPath;
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
    outputPath?: string; // explicit output path; computed from UPLOAD_DIR if omitted
    transition?: TransitionType; // transition type between shots, default "fade"
    transitionDuration?: number; // transition duration in seconds, default 0.5
    aspectRatio?: "landscape" | "vertical"; // aspect ratio
  }
): Promise<string> {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const episodeDir = path.join(uploadDir, "videos", dramaId);
  const tempDir = path.join(episodeDir, `episode-${episodeNumber}-temp`);
  const outputPath = options?.outputPath || path.join(episodeDir, `episode-${episodeNumber}.mp4`);

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
      log.warn(`No audio for shot ${shot.shotNumber}, skipping`);
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
      options?.subtitlePath || undefined,
      options?.aspectRatio || "landscape"
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

  const transition = options?.transition || "fade";
  const transitionDuration = options?.transitionDuration || 0.5;

  if (shotVideoPaths.length === 1) {
    // Just rename/copy the single file
    await fs.copyFile(shotVideoPaths[0], rawOutputPath);
  } else if (transition !== "none") {
    // Use xfade transitions between shots
    log.info(`Concatenating ${shotVideoPaths.length} clips with ${transition} transition (${transitionDuration}s)`);
    await concatWithXfade(
      shotVideoPaths,
      rawOutputPath,
      transition,
      transitionDuration,
      tempDir
    );
  } else {
    // No transition — use original TS concat protocol
    const tsPaths: string[] = [];
    for (const shotPath of shotVideoPaths) {
      const tsPath = path.join(tempDir, `${path.basename(shotPath, '.mp4')}.ts`);
      const normCmd = `ffmpeg -i "${shotPath}" -c:v libx264 -crf 18 -preset medium -c:a aac -ar 44100 -ac 2 -b:a 128k -bsf:v h264_mp4toannexb -f mpegts -y "${tsPath}"`;
      await execAsync(normCmd, { timeout: 180000 });
      tsPaths.push(tsPath);
    }

    const concatInput = tsPaths.join('|');
    const cmd = `ffmpeg -i "concat:${concatInput}" -c copy -bsf:a aac_adtstoasc -movflags +faststart -y "${rawOutputPath}"`;
    await execAsync(cmd, { timeout: 300000 });
  }

  // Burn subtitles into the final video (after concat for accurate timing)
  let finalOutputPath = outputPath;
  if (options?.subtitlePath) {
    const escapedSubPath = options.subtitlePath.replace(/'/g, "'\\''");
    const cmd = `ffmpeg -i "${rawOutputPath}" -vf "subtitles='${escapedSubPath}'" -c:v libx264 -crf 18 -preset medium -c:a copy -movflags +faststart -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 300000 });

    // Remove raw version if it's a separate file
    if (rawOutputPath !== outputPath) {
      await fs.unlink(rawOutputPath).catch(() => {}); // best-effort cleanup
    }
  }

  // Mix BGM into the final video
  if (options?.bgmPath) {
    const bgmVol = options.bgmVolume ?? 0.15;

    // Probe actual video duration for proper fade-out timing
    let videoDuration = 60;
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalOutputPath}"`
      );
      videoDuration = Math.max(0, parseFloat(stdout.trim()) || 60);
    } catch { /* use default */ }
    const fadeOutStart = Math.max(0, videoDuration - 2);

    const bgmMixedPath = path.join(episodeDir, `episode-${episodeNumber}-bgm.mp4`);
    const cmd = `ffmpeg -i "${finalOutputPath}" -i "${options.bgmPath}" -filter_complex "[1:a]volume=${bgmVol},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -movflags +faststart -y "${bgmMixedPath}"`;
    await execAsync(cmd, { timeout: 300000 }).catch(async (err) => {
      log.warn("BGM mixing failed, using video without BGM", { error: err instanceof Error ? err.message : String(err) });
      return;
    });
    // Replace with BGM-mixed version
    try {
      await fs.access(bgmMixedPath);
      if (bgmMixedPath !== outputPath && bgmMixedPath !== finalOutputPath) {
        if (finalOutputPath !== outputPath) {
          await fs.unlink(finalOutputPath).catch(() => {}); // best-effort cleanup
        }
        await fs.rename(bgmMixedPath, outputPath);
      }
      finalOutputPath = outputPath;
    } catch {
      // BGM mixing failed, keep original
    }
  }

  // Clean up temp files
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); // best-effort cleanup

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
  // Use relative paths for ffmpeg concat (absolute paths fail with -safe 1)
  const concatContent = videoPaths.map((p) => `file '${path.relative(dir, p)}'`).join("\n");
  await fs.writeFile(concatListPath, concatContent);

  const cmd = `cd "${dir}" && ffmpeg -f concat -safe 1 -i concat-list.txt -c copy -y "${path.basename(outputPath)}"`;
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
