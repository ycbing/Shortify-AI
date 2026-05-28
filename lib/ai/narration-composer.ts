import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { createLogger } from "@/lib/logger";
import {
  searchAndDownloadVideos,
  extractSearchTerms,
} from "@/lib/ai/pexels-material";
import { generateVoiceover } from "@/lib/ai/voiceover-generator";
import { generateSubtitleParagraphs } from "@/lib/ai/narration-script-generator";
import { concatWithXfade } from "@/lib/ai/video-composer";
import type { TransitionType } from "@/lib/ai/video-composer";
import { inferBgmPreset, BGM_VOLUME_MAP } from "@/lib/ai/bgm-library";

const log = createLogger("narration-composer");
const execAsync = promisify(exec);

export interface NarrationComposeParams {
  narrationId: string;
  userId: string;
  script: string;
  searchTerms: string[];
  voiceName: string;
  voiceRate: number;
  videoAspect: "portrait" | "landscape";
  videoCount: number;
  videoConcatMode: "random" | "sequential";
  transition: TransitionType;
  transitionDuration: number;
  genre?: string | null;
  bgmUrl?: string | null;
}

export interface NarrationProgress {
  stage: string;
  percent: number;
  detail: string;
}

export type ProgressCallback = (progress: NarrationProgress) => void;

/**
 * Full narration video generation pipeline.
 * 1. TTS → audio
 * 2. Subtitles from script
 * 3. Pexels video download
 * 4. Combine clips + audio + subtitles + transition + BGM
 */
export async function composeNarrationVideo(
  params: NarrationComposeParams,
  onProgress?: ProgressCallback
): Promise<{ videoUrl: string; audioUrl: string; audioDuration: number }> {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const workDir = path.join(uploadDir, "narrations", params.narrationId);
  await fs.mkdir(workDir, { recursive: true });

  const report = (stage: string, percent: number, detail: string) => {
    log.info(`[${percent}%] ${stage}: ${detail}`);
    onProgress?.({ stage, percent, detail });
  };

  // ===== Step 1: TTS =====
  report("tts", 5, "正在生成配音...");
  const audioPath = path.join(workDir, "audio.mp3");
  await generateVoiceover(params.script, audioPath, params.voiceName, params.voiceRate === 1 ? "+0%" : `+${Math.round((params.voiceRate - 1) * 100)}%`);

  let audioDuration = 0;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    audioDuration = parseFloat(stdout.trim()) || 0;
  } catch {
    audioDuration = 60;
  }
  log.info(`Audio duration: ${audioDuration.toFixed(1)}s`);
  report("tts", 15, `配音完成 (${audioDuration.toFixed(1)}s)`);

  // ===== Step 2: Subtitles =====
  report("subtitle", 20, "正在生成字幕...");
  const subtitlePath = path.join(workDir, "subtitle.srt");
  await generateSrtFromScript(params.script, audioDuration, subtitlePath);
  report("subtitle", 25, "字幕生成完成");

  // ===== Step 3: Download Pexels videos =====
  report("materials", 30, `正在搜索视频素材 (${params.searchTerms.join(", ")})...`);
  const orientation: "portrait" | "landscape" =
    params.videoAspect === "portrait" ? "portrait" : "landscape";

  let videoClips: string[] = [];
  try {
    videoClips = await searchAndDownloadVideos(
      params.searchTerms,
      orientation,
      audioDuration * params.videoCount,
      uploadDir,
      10
    );
    report("materials", 60, `下载了 ${videoClips.length} 个视频素材`);
  } catch (err) {
    log.warn("Pexels download failed, creating black frame fallback", {
      error: err instanceof Error ? err.message : err,
    });
    // Create black frame video as fallback
    const blackFramePath = path.join(workDir, "fallback-black.mp4");
    await execAsync(
      `ffmpeg -f lavfi -i color=c=black:s=${orientation === "portrait" ? "1080x1920" : "1920x1080"}:d=${Math.max(audioDuration, 5)} -c:v libx264 -crf 18 -pix_fmt yuv420p -y "${blackFramePath}"`,
      { timeout: 30000 }
    );
    videoClips = [blackFramePath];
    report("materials", 60, "素材下载失败，使用备用画面");
  }

  // ===== Step 4: Combine clips with transition =====
  report("combine", 65, "正在拼接视频片段...");

  const tempDir = path.join(workDir, "temp");
  await fs.mkdir(tempDir, { recursive: true });

  const combinedVideoPath = path.join(workDir, "combined.mp4");

  if (videoClips.length === 1) {
    // Single clip — just copy
    await fs.copyFile(videoClips[0], combinedVideoPath);
  } else {
    // Concat with xfade transition
    try {
      await concatWithXfade(
        videoClips,
        combinedVideoPath,
        params.transition,
        params.transitionDuration,
        tempDir
      );
    } catch (err) {
      log.warn("xfade failed, using simple concat", {
        error: err instanceof Error ? err.message : err,
      });
      // Fallback: simple concat
      const concatListPath = path.join(tempDir, "concat-list.txt");
      await fs.writeFile(
        concatListPath,
        videoClips.map((p) => `file '${p}'`).join("\n")
      );
      await execAsync(
        `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${combinedVideoPath}"`,
        { timeout: 300000 }
      );
    }
  }
  report("combine", 75, "视频片段拼接完成");

  // ===== Step 5: Add audio + subtitles =====
  report("finalize", 80, "正在合成最终视频...");
  const finalVideoPath = path.join(workDir, "final.mp4");

  // Get combined video duration
  let videoDuration = audioDuration;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${combinedVideoPath}"`
    );
    videoDuration = parseFloat(stdout.trim()) || audioDuration;
  } catch {
    // use audio duration
  }

  const escapedSubPath = subtitlePath.replace(/'/g, "'\\''");
  const cmd = `ffmpeg -i "${combinedVideoPath}" -i "${audioPath}" ` +
    `-vf "subtitles='${escapedSubPath}'" ` +
    `-c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p ` +
    `-c:a aac -b:a 128k -shortest ` +
    `-movflags +faststart -y "${finalVideoPath}"`;

  await execAsync(cmd, { timeout: 300000 });
  report("finalize", 90, "视频合成完成");

  // ===== Step 6: Mix BGM =====
  if (params.bgmUrl) {
    report("finalize", 92, "正在混入背景音乐...");
    const bgmVol = params.genre
      ? (BGM_VOLUME_MAP[inferBgmPreset(params.genre)] ?? 0.15)
      : 0.15;
    const fadeOutStart = Math.max(0, audioDuration - 2);
    const bgmMixedPath = path.join(workDir, "final-bgm.mp4");

    try {
      await execAsync(
        `ffmpeg -i "${finalVideoPath}" -i "${params.bgmUrl}" ` +
        `-filter_complex "[1:a]volume=${bgmVol},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" ` +
        `-map 0:v -map "[aout]" -c:v copy -c:a aac -movflags +faststart -y "${bgmMixedPath}"`,
        { timeout: 300000 }
      );
      await fs.rename(bgmMixedPath, finalVideoPath);
    } catch (err) {
      log.warn("BGM mixing failed", {
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  // Cleanup temp
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  report("finalize", 100, "全部完成");

  // Relative path for database storage
  const relativeVideoUrl = `narrations/${params.narrationId}/final.mp4`;
  const relativeAudioUrl = `narrations/${params.narrationId}/audio.mp3`;

  return {
    videoUrl: relativeVideoUrl,
    audioUrl: relativeAudioUrl,
    audioDuration,
  };
}

// ============ SRT Generation ============

async function generateSrtFromScript(
  script: string,
  totalDuration: number,
  outputPath: string
): Promise<string> {
  const paragraphs = generateSubtitleParagraphs(script);
  if (paragraphs.length === 0) {
    throw new Error("No paragraphs found in script");
  }

  const durationPerSentence = totalDuration / paragraphs.length;
  const lines: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const start = i * durationPerSentence;
    const end = Math.min((i + 1) * durationPerSentence, totalDuration);
    lines.push(`${i + 1}`);
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    lines.push(paragraphs[i].text);
    lines.push("");
  }

  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  return outputPath;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
