// 单镜头资源（分镜图 / AI 视频）的公共文件操作
// 从 app/api/generate/video/route.ts 抽出，供分镜编辑器单镜头重跑复用
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { createLogger } from "@/lib/logger";
import {
  isLipSyncEnabled,
  submitLipSyncWithRetry,
  waitForLipSync,
} from "@/lib/ai/kling-client";
import { downloadVideo } from "@/lib/ai/video-generator";
import {
  uploadToCos,
  getPublicAccessibleUrl,
  restoreCosObjectAcl,
} from "@/lib/ai/cos-storage";

const log = createLogger("shot-assets");

const execAsync = promisify(exec);

/**
 * Find the local image file for a specific shot.
 * Looks in uploads/images/{dramaId}/episode-{epNum}/shot-{shotNumber}.{jpg,png,...}
 */
export async function findShotImage(
  dramaId: string,
  epNum: number,
  shotNumber: number
): Promise<string | undefined> {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const shotImageDir = path.join(uploadDir, "images", dramaId, `episode-${epNum}`);

  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const candidate = path.join(shotImageDir, `shot-${shotNumber}${ext}`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not found, try next extension
    }
  }
  return undefined;
}

/**
 * Mix voiceover audio into a single AI video shot.
 * Uses stream_loop to extend video to match audio duration.
 * Only encodes once here — the result is used directly for concat (stream copy).
 */
export async function mixAudioToShotVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  aspectRatio: "landscape" | "vertical" = "landscape"
): Promise<string> {
  // Get audio duration
  let audioDuration = 5;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    audioDuration = parseFloat(stdout.trim()) || 5;
  } catch {
    // ffprobe duration detection failed, using default
  }

  const fadeDuration = Math.min(0.3, audioDuration * 0.1);

  // Video loop to audio length, overlay audio, output with consistent codec params
  // -c:v libx264 -crf 18 for high quality (this is the only encode per shot)
  const scaleFilter = aspectRatio === "vertical"
    ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black"
    : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black";

  const cmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -filter_complex "[0:v]${scaleFilter},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, audioDuration - fadeDuration)}:d=${fadeDuration}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]" -map "[v]" -map "[a]" -t ${audioDuration} -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`;

  await execAsync(cmd, { timeout: 120000 });
  return outputPath;
}

/**
 * 对口型（可选步骤）：对白镜头的 AI 视频 + 配音 → 口型匹配视频
 * - 需 KLING_LIPSYNC=true 且配置 Kling 密钥（消耗可灵算力）
 * - 视频/配音经 COS 临时公网 URL 提交，完成后恢复 ACL
 * - 任何失败都退回原始视频，绝不阻塞主流程
 * 返回（可能已替换的）视频路径
 */
export async function tryLipSyncShotVideo(params: {
  videoPath: string;
  voiceoverPath: string;
  dramaId: string;
  episodeNumber: number;
  shotNumber: number;
}): Promise<string> {
  const { videoPath, voiceoverPath, dramaId, episodeNumber, shotNumber } = params;
  if (!isLipSyncEnabled()) return videoPath;

  const videoCosKey = `${dramaId}/videos/lipsync-src-ep${episodeNumber}-shot${shotNumber}.mp4`;
  const audioCosKey = `${dramaId}/voiceovers/lipsync-src-ep${episodeNumber}-shot${shotNumber}.mp3`;

  try {
    log.info("Lip-sync started", { episodeNumber, shotNumber });

    await uploadToCos(videoPath, videoCosKey);
    await uploadToCos(voiceoverPath, audioCosKey);
    const [videoUrl, audioUrl] = await Promise.all([
      getPublicAccessibleUrl(videoCosKey),
      getPublicAccessibleUrl(audioCosKey),
    ]);

    const taskId = await submitLipSyncWithRetry(videoUrl, audioUrl);
    const resultUrl = await waitForLipSync(taskId);

    // 结果下载并替换原始视频（替换后走常规混音，配音音轨由混音步骤统一写入）
    const lipsyncPath = videoPath.replace(/\.mp4$/, ".lipsync.mp4");
    await downloadVideo(resultUrl, lipsyncPath);
    await fs.unlink(videoPath).catch(() => {});
    await fs.rename(lipsyncPath, videoPath);

    log.info("Lip-sync done", { episodeNumber, shotNumber });
    return videoPath;
  } catch (err) {
    log.warn("Lip-sync failed, falling back to plain video", {
      episodeNumber,
      shotNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return videoPath;
  } finally {
    restoreCosObjectAcl(videoCosKey).catch(() => {});
    restoreCosObjectAcl(audioCosKey).catch(() => {});
  }
}
