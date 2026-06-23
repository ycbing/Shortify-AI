import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  generateVideo,
  downloadVideo,
} from "@/lib/ai/video-generator";
import type { Character } from "@/types/drama";
import {
  uploadFileToCos,
  getSignedCosUrl,
  isCosConfigured,
  uploadToCos,
  aiVideoCosKey,
  videoCosKey,
  getPublicAccessibleUrl,
  restoreCosObjectAcl,
} from "@/lib/ai/cos-storage";
import type { Shot } from "@/types/drama";
import path from "path";
import fs from "fs/promises";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction, refundCredits } from "@/lib/credits";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import { getOwnedDrama } from "@/lib/dramas";
import { updateDramaStatus } from "@/lib/drama-status";
import {
  completeGenerationTask,
  createOrReuseGenerationTask,
  failGenerationTask,
  GenerationTaskCancelledError,
  getActiveGenerationTask,
  throwIfGenerationTaskCancelled,
  touchGenerationTaskHeartbeat,
  updateGenerationTaskProgress,
} from "@/lib/generation";
import { tryAcquireUserSlot, releaseUserSlot, getUserActiveCount } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";
import { videoSchema } from "@/lib/validation";

const log = createLogger("video-api");

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  let taskId: string | null = null;
  let dramaId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = videoSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0];
      return NextResponse.json(
        { error: firstIssue?.message || "请求参数无效" },
        { status: 400 }
      );
    }

    dramaId = parsed.data.dramaId;
    const episodeId = parsed.data.episodeId;

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    // Get episodes to generate video for
    let targetEpisodes;
    if (episodeId) {
      const episode = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);
      if (!episode.length) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }
      targetEpisodes = episode;
    } else {
      targetEpisodes = await db
        .select()
        .from(episodes)
        .where(eq(episodes.dramaId, dramaId))
        .orderBy(episodes.episodeNumber);
    }

    // Count total shots needing generation across all episodes
    let totalShotsNeeded = 0;
    const episodesNeedingVideo: typeof targetEpisodes = [];

    for (const ep of targetEpisodes) {
      const shots = ep.shotData as Shot[];
      if (!Array.isArray(shots) || shots.length === 0) continue;

      // Check if all shots already have aiVideoUrl
      const shotsNeeding = shots.filter((s) => !s.aiVideoUrl);
      if (shotsNeeding.length > 0) {
        totalShotsNeeded += shotsNeeding.length;
        episodesNeedingVideo.push(ep);
      }
    }

    if (totalShotsNeeded === 0) {
      return NextResponse.json({
        message: "所有镜头已有 AI 视频，无需生成",
        episodeCount: 0,
        shotCount: 0,
      });
    }

    const activeTask = await getActiveGenerationTask(dramaId, "video");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有 AI 视频任务正在进行，已为你恢复到当前任务",
        episodeCount: episodesNeedingVideo.length,
        shotCount: totalShotsNeeded,
      });
    }

    // Concurrency control
    if (!tryAcquireUserSlot(session.user.id)) {
      return NextResponse.json({
        error: `当前有 ${getUserActiveCount(session.user.id)} 个任务正在进行，请等待完成后再试`,
        code: "TOO_MANY_TASKS",
      }, { status: 429 });
    }

    // Credit check: 20 credits per shot
    const totalVideoCredits = totalShotsNeeded * CREDIT_COSTS.video;

    const videoCreditCheck = await checkCredits(session.user.id, totalVideoCredits);
    if (!videoCreditCheck.ok) {
      return NextResponse.json(
        {
          error: `积分不足，AI 视频生成需要 ${totalVideoCredits} 积分（${totalShotsNeeded} 个镜头 × ${CREDIT_COSTS.video} 积分），当前余额 ${videoCreditCheck.balance} 积分`,
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 402 }
      );
    }

    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "video",
      inputData: { episodeCount: episodesNeedingVideo.length, shotCount: totalShotsNeeded },
    });
    taskId = taskResult.taskId;

    const characters: Character[] = Array.isArray(drama.characters) ? drama.characters : [];

    // Process in background
    processVideos(dramaId, episodesNeedingVideo, drama.style || "realistic", taskId, session.user.id, characters, (drama.aspectRatio as "landscape" | "vertical") || "landscape").catch(
      err => log.error("Background video processing failed", { error: err instanceof Error ? err.message : String(err) })
    ).finally(() => releaseUserSlot(session.user.id));

    return NextResponse.json({
      taskId,
      message: `正在为 ${totalShotsNeeded} 个镜头生成 AI 视频（${episodesNeedingVideo.length} 集），请稍候...`,
      episodeCount: episodesNeedingVideo.length,
      shotCount: totalShotsNeeded,
    });
  } catch (error) {
    log.error("Video generation failed", { error: error instanceof Error ? error.message : String(error) });
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `视频生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

/**
 * Find the local image file for a specific shot.
 * Looks in uploads/images/{dramaId}/episode-{epNum}/shot-{shotNumber}.{jpg,png}
 */
async function findShotImage(
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
 * Upload a shot image to COS and return a signed URL.
 */
async function uploadShotImageAndGetPublicUrl(
  imagePath: string,
  dramaId: string,
  epNum: number,
  shotNumber: number
): Promise<string | undefined> {
  const VIDEO_PROVIDER = process.env.VIDEO_PROVIDER || "cogvideo";
  const isExternalProvider = VIDEO_PROVIDER === "liblib" || VIDEO_PROVIDER === "kling" || VIDEO_PROVIDER === "wan" || VIDEO_PROVIDER === "dashscope";

  // Upload to COS for storage
  if (isCosConfigured()) {
    try {
      const cosKey = `${dramaId}/images/episode-${epNum}/shot-${shotNumber}.jpg`;
      await uploadToCos(imagePath, cosKey);
    } catch (err) {
      log.warn("Failed to upload shot image to COS", { shotNumber });
    }
  }

  // For CogVideoX: return base64 data URI (no external URL needed)
  // For Wan2.7: also return base64 (COS private bucket URLs not accessible by DashScope)
  if (!isExternalProvider || VIDEO_PROVIDER === "wan" || VIDEO_PROVIDER === "dashscope") {
    try {
      const buffer = await fs.readFile(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch (err) {
      log.warn("Failed to read image for base64", { shotNumber });
      return undefined;
    }
  }

  // For LibLib/Kling: make COS image temporarily public
  if (isCosConfigured()) {
    try {
      const cosKey = `${dramaId}/images/episode-${epNum}/shot-${shotNumber}.jpg`;
      const publicUrl = await getPublicAccessibleUrl(cosKey);
      return publicUrl;
    } catch (err) {
      log.warn("Failed to get public URL for shot image", { shotNumber });
    }
  }

  return undefined;
}

/**
 * Mix voiceover audio into a single AI video shot.
 * Uses stream_loop to extend video to match audio duration.
 * Only encodes once here — the result is used directly for concat (stream copy).
 */
async function mixAudioToShotVideo(
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
    : "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black";

  const cmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -filter_complex "[0:v]${scaleFilter},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, audioDuration - fadeDuration)}:d=${fadeDuration}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]" -map "[v]" -map "[a]" -t ${audioDuration} -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`;

  await execAsync(cmd, { timeout: 120000 });
  return outputPath;
}

/**
 * Concatenate multiple pre-mixed video files (audio already embedded).
 * Uses stream copy (no re-encoding) for maximum quality and speed.
 * Then optionally burns subtitles in a single final pass.
 */
async function concatMixedVideos(
  mixedPaths: string[],
  outputDir: string,
  epNum: number,
  subtitlePath: string | null,
  aspectRatio: "landscape" | "vertical" = "landscape"
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const listFile = path.join(outputDir, `concat-list-${epNum}.txt`);
  const lines = mixedPaths.map((p) => `file '${path.relative(outputDir, p)}'`).join("\n");
  await fs.writeFile(listFile, lines);

  // Step 1: Concat with stream copy (NO re-encoding)
  const rawOutputPath = path.join(outputDir, `episode-${epNum}-raw.mp4`);
  try {
    execSync(
      `cd "${outputDir}" && ffmpeg -y -f concat -safe 1 -i concat-list-${epNum}.txt -c copy -movflags +faststart episode-${epNum}-raw.mp4`,
      { timeout: 120000 }
    );
  } catch (err) {
    // Fallback: re-encode if stream copy fails (different params)
    log.warn("Concat copy failed, re-encoding", { episodeNumber: epNum });
    execSync(
      `cd "${outputDir}" && ffmpeg -y -f concat -safe 1 -i concat-list-${epNum}.txt -c:v libx264 -preset fast -crf 18 -c:a aac -movflags +faststart episode-${epNum}-raw.mp4`,
      { timeout: 300000 }
    );
  }

  await fs.unlink(listFile).catch(() => {});

  // Step 2: Burn subtitles (single re-encode pass only if subtitles exist)
  let finalOutputPath = rawOutputPath;
  if (subtitlePath) {
    try {
      await fs.access(subtitlePath);
      const escapedSrtPath = subtitlePath.replace(/'/g, "'\\''");
      finalOutputPath = path.join(outputDir, `episode-${epNum}.mp4`);
      execSync(
        `ffmpeg -y -i "${rawOutputPath}" -vf "subtitles='${escapedSrtPath}'" -c:v libx264 -crf 18 -c:a copy -movflags +faststart "${finalOutputPath}"`,
        { timeout: 300000 }
      );
      if (rawOutputPath !== finalOutputPath) {
        await fs.unlink(rawOutputPath).catch(() => {});
      }
    } catch (err) {
      log.warn("Subtitle burn failed, using raw video", { episodeNumber: epNum });
      finalOutputPath = rawOutputPath;
    }
  }

  return finalOutputPath;
}

async function processVideos(
  dramaId: string,
  episodesList: typeof episodes.$inferSelect[],
  style: string,
  taskId: string,
  userId: string,
  characters: Character[] = [],
  aspectRatio: "landscape" | "vertical" = "landscape"
) {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const charRefMap = new Map<string, string>();
  for (const c of characters) {
    if (c.referenceImageUrl) charRefMap.set(c.name, c.referenceImageUrl);
  }
  const results: {
    episodeNumber: number;
    success: boolean;
    shotsGenerated: number;
    shotsSkipped: number;
    error?: string;
  }[] = [];

  let totalCreditsUsed = 0;
  let completedCount = 0;

  try {


    for (const episode of episodesList) {
      await throwIfGenerationTaskCancelled(taskId);

      const epNum = episode.episodeNumber;
      const shots = (episode.shotData as Shot[]).slice(); // shallow clone

      if (!Array.isArray(shots) || shots.length === 0) {
        results.push({
          episodeNumber: epNum,
          success: false,
          shotsGenerated: 0,
          shotsSkipped: 0,
          error: "跳过：无分镜数据",
        });
        continue;
      }

      const shotVideoPaths: string[] = [];
      let shotsGenerated = 0;
      let shotsSkipped = 0;

      for (const shot of shots) {
        await throwIfGenerationTaskCancelled(taskId);

        // Skip shots that already have aiVideoUrl
        if (shot.aiVideoUrl) {
          shotsSkipped++;
          log.debug(`Shot ${shot.shotNumber} already has aiVideoUrl, skipping`, { episodeNumber: epNum });
          continue;
        }

        try {
        // 1. Find the shot's storyboard image
        const shotImagePath = await findShotImage(dramaId, epNum, shot.shotNumber);
        if (!shotImagePath) {
          log.warn("No image found for shot, skipping", { episodeNumber: epNum, shotNumber: shot.shotNumber });
          continue;
        }

        // 2. Upload image to COS and get publicly accessible URL
        const publicImageUrl = await uploadShotImageAndGetPublicUrl(shotImagePath, dramaId, epNum, shot.shotNumber);
        if (!publicImageUrl) {
          log.warn("Could not get public image URL for shot, skipping", { episodeNumber: epNum, shotNumber: shot.shotNumber });
          continue;
        }

        // 3. Build prompt from shot data
        const prompt = shot.subtitle || shot.line || shot.visual || "电影场景";
        log.info("Generating AI video for shot", { episodeNumber: epNum, shotNumber: shot.shotNumber, prompt: prompt.substring(0, 50) });

        // 4. Build character reference for this shot
        let shotCharRef: { imageUrl: string; type: "face" | "full_body" } | undefined;
        if (charRefMap.size > 0) {
          const shotChar = characters.find((c) =>
            c.name && (shot.character === c.name || shot.visual?.includes(c.name))
          );
          if (shotChar) {
            const refUrl = charRefMap.get(shotChar.name);
            if (refUrl) {
              shotCharRef = { imageUrl: refUrl, type: "face" };
            }
          }
        }

        // 5. Generate video (routes to Kling or CogVideoX automatically)
        const imageCosKey = `${dramaId}/images/episode-${epNum}/shot-${shot.shotNumber}.jpg`;
        await touchGenerationTaskHeartbeat(taskId, {
          currentEpisode: epNum,
          currentShot: shot.shotNumber,
          stage: "submit",
          completedCount,
          episodeCount: episodesList.length,
          creditsUsed: totalCreditsUsed,
        });
        const result = await generateVideo(prompt, publicImageUrl, style, {
          characterReference: shotCharRef,
          userId,
        });
        await throwIfGenerationTaskCancelled(taskId);

        // 6. Download video to local
        const localVideoDir = path.join(uploadDir, "videos", dramaId, `episode-${epNum}-ai`);
        const localVideoPath = path.join(localVideoDir, `shot-${shot.shotNumber}.mp4`);
        await downloadVideo(result.videoUrl, localVideoPath);
        await throwIfGenerationTaskCancelled(taskId);

        // Restore COS ACL (only for LibLib/Kling which use public URLs)
        const isExtProvider = (process.env.VIDEO_PROVIDER || "cogvideo") === "liblib" || (process.env.VIDEO_PROVIDER || "cogvideo") === "kling";
        if (isExtProvider) {
          restoreCosObjectAcl(imageCosKey).catch((err) => {
            log.warn("Failed to restore ACL", { cosKey: imageCosKey });
          });
          await new Promise((r) => setTimeout(r, 5000));
        }

        // 7. Mix voiceover audio into the AI video immediately (one encode pass)
        const voiceoverPath = path.join(uploadDir, "voiceovers", dramaId, `episode-${epNum}`, `shot-${shot.shotNumber}.mp3`);
        try {
          await fs.access(voiceoverPath);
          const mixedPath = path.join(localVideoDir, `shot-${shot.shotNumber}-mixed.mp4`);
          await mixAudioToShotVideo(localVideoPath, voiceoverPath, mixedPath, aspectRatio);
          // Replace original with mixed version
          await fs.unlink(localVideoPath).catch(() => {});
          await fs.rename(mixedPath, localVideoPath);
          log.debug("Audio mixed into video", { episodeNumber: epNum, shotNumber: shot.shotNumber });
        } catch (err) {
          log.warn("No voiceover or audio mix failed, using video without audio", { episodeNumber: epNum, shotNumber: shot.shotNumber });
        }

        shotVideoPaths.push(localVideoPath);

        // 7. Upload video to COS
        const cosKey = aiVideoCosKey(dramaId, epNum, shot.shotNumber);
        const cosUrl = await uploadFileToCos(localVideoPath, cosKey);
        await throwIfGenerationTaskCancelled(taskId);
        shot.aiVideoUrl = cosUrl;

        // Deduct credits per shot
        await requireCreditDeduction(userId, "video", CREDIT_COSTS.video, dramaId, `AI 视频生成：第 ${epNum} 集 镜头 ${shot.shotNumber}`);
        totalCreditsUsed += CREDIT_COSTS.video;

        shotsGenerated++;
        completedCount++;
        await updateGenerationTaskProgress(taskId, {
          completedCount,
          episodeCount: episodesList.length,
          creditsUsed: totalCreditsUsed,
          currentEpisode: epNum,
          currentShot: shot.shotNumber,
          stage: "persist",
        });
        log.info("AI video saved", { episodeNumber: epNum, shotNumber: shot.shotNumber, url: cosUrl });
        } catch (err) {
          if (err instanceof GenerationTaskCancelledError) {
            throw err;
          }
          log.error("Failed to generate video for shot", { episodeNumber: epNum, shotNumber: shot.shotNumber, error: err instanceof Error ? err.message : String(err) });
          // Continue with next shot instead of failing the whole episode
        }
      }

      // Save updated shotData to database
      try {
        await db
          .update(episodes)
          .set({ shotData: shots })
          .where(eq(episodes.id, episode.id));
        log.info("ShotData saved with new AI videos", { episodeNumber: epNum, shotsGenerated });
      } catch (err) {
        log.error("Failed to save shotData", { episodeNumber: epNum, error: err instanceof Error ? err.message : String(err) });
      }

      // 8. Concat all shot videos (stream copy, no re-encoding) + burn subtitles
      if (shotVideoPaths.length > 0) {
        try {
          const outputDir = path.join(uploadDir, "videos", dramaId, `episode-${epNum}-ai`);

        // Find or generate subtitle file
        let subtitlePath: string | null = null;
        const srtPath = path.join(uploadDir, "subtitles", dramaId, `episode-${epNum}.srt`);
        try {
          await fs.access(srtPath);
          subtitlePath = srtPath;
        } catch {
          if (episode.subtitleUrl) {
            try {
              await fs.access(episode.subtitleUrl);
              subtitlePath = episode.subtitleUrl;
            } catch { /* not found */ }
          }
        }

        // If no subtitle file exists yet, generate one from shot data
        if (!subtitlePath && shots && shots.length > 0) {
          try {
            const shotAudios = shots.map((shot: any) => ({
              shotNumber: shot.shotNumber,
              duration: shot.duration || 5,
              audioUrl: "",
              type: shot.type === "dialogue" ? "dialogue" : "narration",
              character: shot.character,
            }));
            const { generateSubtitles } = require("@/lib/ai/subtitle-generator");
            subtitlePath = await generateSubtitles(shots, shotAudios, dramaId, epNum);
            log.info("Generated missing subtitles", { episodeNumber: epNum, subtitlePath });
          } catch (err) {
            log.warn("Subtitle generation failed", { episodeNumber: epNum });
          }
        }

        // Concat with stream copy (videos already have audio mixed in)
        const episodeVideoPath = await concatMixedVideos(
          shotVideoPaths,
          outputDir,
          epNum,
          subtitlePath,
          aspectRatio
        );

        // Upload the final video to COS
        const cosKey = videoCosKey(dramaId, epNum, "ai-concat.mp4");
        const finalUrl = await uploadFileToCos(episodeVideoPath, cosKey);

        // Update episode.videoUrl
        await db
          .update(episodes)
          .set({ videoUrl: finalUrl })
          .where(eq(episodes.id, episode.id));

        log.info("Final video saved", { episodeNumber: epNum, url: finalUrl });
        } catch (err) {
          log.error("Failed to finalize episode", { episodeNumber: epNum, error: err instanceof Error ? err.message : String(err) });
        }
      }

      results.push({
        episodeNumber: epNum,
        success: shotsGenerated > 0 || shotsSkipped === shots.length,
        shotsGenerated,
        shotsSkipped,
      });

      await updateGenerationTaskProgress(taskId, {
        completedCount,
        episodeCount: episodesList.length,
        creditsUsed: totalCreditsUsed,
        currentEpisode: epNum,
        stage: "episode-complete",
      });
    }

    const hasSuccessfulEpisode = results.some((result) => result.success);
    if (!hasSuccessfulEpisode) {
      throw new Error("AI 视频生成未产出可用结果");
    }

    await updateDramaStatus(dramaId, "completed");

    await completeGenerationTask(taskId, {
      results,
      mode: "per-shot",
      completedCount,
      episodeCount: episodesList.length,
      creditsUsed: totalCreditsUsed,
    });
  } catch (error) {
    if (error instanceof GenerationTaskCancelledError) {
      return;
    }

    log.error("Background video processing failed", { error: error instanceof Error ? error.message : String(error) });
    
    // Refund credits if nothing was generated
    if (totalCreditsUsed > 0 && !results.some((r) => r.success && r.shotsGenerated > 0)) {
      log.warn(`No videos generated, refunding ${totalCreditsUsed} credits`, { dramaId, taskId });
      await refundCredits(userId, totalCreditsUsed, dramaId, "AI 视频生成失败 - 积分退还").catch(err => log.error("Failed to refund credits", { error: err instanceof Error ? err.message : String(err) }));
    }
    
    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
