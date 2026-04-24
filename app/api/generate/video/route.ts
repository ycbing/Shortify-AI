import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  submitVideoGeneration,
  waitForVideoCompletion,
  downloadVideo,
} from "@/lib/ai/video-generator";
import {
  uploadFileToCos,
  getSignedCosUrl,
  isCosConfigured,
  uploadToCos,
  aiVideoCosKey,
  videoCosKey,
} from "@/lib/ai/cos-storage";
import type { Shot } from "@/types/drama";
import path from "path";
import fs from "fs/promises";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction } from "@/lib/credits";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import { getOwnedDrama } from "@/lib/dramas";
import {
  completeGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  isGenerationTaskCancelled,
} from "@/lib/generation";

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
    dramaId = body.dramaId;
    const { episodeId } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

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

    // Update drama status
    await db
      .update(dramas)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(dramas.id, dramaId));

    // Create task record
    taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "video",
      status: "processing",
      inputData: { episodeCount: episodesNeedingVideo.length, shotCount: totalShotsNeeded },
      startedAt: new Date(),
    });

    // Process in background
    processVideos(dramaId, episodesNeedingVideo, drama.style || "realistic", taskId, session.user.id).catch(
      console.error
    );

    return NextResponse.json({
      taskId,
      message: `正在为 ${totalShotsNeeded} 个镜头生成 AI 视频（${episodesNeedingVideo.length} 集），请稍候...`,
      episodeCount: episodesNeedingVideo.length,
      shotCount: totalShotsNeeded,
    });
  } catch (error) {
    console.error("Video generation failed:", error);
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
async function uploadShotImageAndGetSignedUrl(
  imagePath: string,
  dramaId: string,
  epNum: number,
  shotNumber: number
): Promise<string | undefined> {
  // If COS is configured, upload and get signed URL
  if (isCosConfigured()) {
    try {
      const cosKey = `${dramaId}/images/episode-${epNum}/shot-${shotNumber}.jpg`;
      await uploadToCos(imagePath, cosKey);
      return getSignedCosUrl(cosKey, 3600);
    } catch (err) {
      console.warn(`Failed to upload shot image to COS: shot-${shotNumber}`, err);
    }
  }

  // Fallback: return local path (won't work for CogVideoX API, but logged)
  console.warn(`COS not configured or upload failed, shot image may not work: ${imagePath}`);
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
  outputPath: string
): Promise<string> {
  // Get audio duration
  let audioDuration = 5;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    audioDuration = parseFloat(stdout.trim()) || 5;
  } catch {
    // use default
  }

  const fadeDuration = Math.min(0.3, audioDuration * 0.1);

  // Video loop to audio length, overlay audio, output with consistent codec params
  // -c:v libx264 -crf 18 for high quality (this is the only encode per shot)
  const cmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, audioDuration - fadeDuration)}:d=${fadeDuration}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]" -map "[v]" -map "[a]" -t ${audioDuration} -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`;

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
  subtitlePath: string | null
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const listFile = path.join(outputDir, `concat-list-${epNum}.txt`);
  const lines = mixedPaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(listFile, lines);

  // Step 1: Concat with stream copy (NO re-encoding)
  const rawOutputPath = path.join(outputDir, `episode-${epNum}-raw.mp4`);
  try {
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy -movflags +faststart "${rawOutputPath}"`,
      { timeout: 120000 }
    );
  } catch (err) {
    // Fallback: re-encode if stream copy fails (different params)
    console.warn(`Concat copy failed for episode ${epNum}, re-encoding...`, err);
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 18 -c:a aac -movflags +faststart "${rawOutputPath}"`,
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
      console.warn(`Subtitle burn failed for episode ${epNum}, using raw video`, err);
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
  userId: string
) {
  try {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    const results: {
      episodeNumber: number;
      success: boolean;
      shotsGenerated: number;
      shotsSkipped: number;
      error?: string;
    }[] = [];

    let totalCreditsUsed = 0;

    for (const episode of episodesList) {
      if (await isGenerationTaskCancelled(taskId)) {
        return;
      }

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
        if (await isGenerationTaskCancelled(taskId)) {
          return;
        }

        // Skip shots that already have aiVideoUrl
        if (shot.aiVideoUrl) {
          shotsSkipped++;
          console.log(`Episode ${epNum} Shot ${shot.shotNumber}: already has aiVideoUrl, skipping`);
          continue;
        }

        try {
        // 1. Find the shot's storyboard image
        const shotImagePath = await findShotImage(dramaId, epNum, shot.shotNumber);
        if (!shotImagePath) {
          console.warn(`Episode ${epNum} Shot ${shot.shotNumber}: no image found, skipping`);
          continue;
        }

        // 2. Upload image to COS and get signed URL
        const signedImageUrl = await uploadShotImageAndGetSignedUrl(shotImagePath, dramaId, epNum, shot.shotNumber);
        if (!signedImageUrl) {
          console.warn(`Episode ${epNum} Shot ${shot.shotNumber}: could not get signed image URL, skipping`);
          continue;
        }

        // 3. Build prompt from shot data
        const prompt = shot.subtitle || shot.line || shot.visual || "电影场景";
        console.log(`Episode ${epNum} Shot ${shot.shotNumber}: generating AI video (prompt: ${prompt.substring(0, 50)}...)`);

        // 4. Submit video generation (no fps, no duration - cogvideox-3 doesn't support them)
        const { taskId: videoTaskId } = await submitVideoGeneration(prompt, signedImageUrl, style);
        console.log(`Episode ${epNum} Shot ${shot.shotNumber}: video task submitted: ${videoTaskId}`);

        // 5. Wait for completion (max 5 min per shot)
        const result = await waitForVideoCompletion(videoTaskId, 300000, 5000);

        // 6. Download video to local
        const localVideoDir = path.join(uploadDir, "videos", dramaId, `episode-${epNum}-ai`);
        const localVideoPath = path.join(localVideoDir, `shot-${shot.shotNumber}.mp4`);
        await downloadVideo(result.videoUrl, localVideoPath);

        // 7. Mix voiceover audio into the AI video immediately (one encode pass)
        const voiceoverPath = path.join(uploadDir, "voiceovers", dramaId, `episode-${epNum}`, `shot-${shot.shotNumber}.mp3`);
        try {
          await fs.access(voiceoverPath);
          const mixedPath = path.join(localVideoDir, `shot-${shot.shotNumber}-mixed.mp4`);
          await mixAudioToShotVideo(localVideoPath, voiceoverPath, mixedPath);
          // Replace original with mixed version
          await fs.unlink(localVideoPath).catch(() => {});
          await fs.rename(mixedPath, localVideoPath);
          console.log(`Episode ${epNum} Shot ${shot.shotNumber}: audio mixed into video`);
        } catch (err) {
          console.warn(`Episode ${epNum} Shot ${shot.shotNumber}: no voiceover or mix failed, using video without audio`, err);
        }

        shotVideoPaths.push(localVideoPath);

        // 7. Upload video to COS
        const cosKey = aiVideoCosKey(dramaId, epNum, shot.shotNumber);
        const cosUrl = await uploadFileToCos(localVideoPath, cosKey);
        shot.aiVideoUrl = cosUrl;

        // Deduct credits per shot
        await requireCreditDeduction(userId, "video", CREDIT_COSTS.video, dramaId, `AI 视频生成：第 ${epNum} 集 镜头 ${shot.shotNumber}`);
        totalCreditsUsed += CREDIT_COSTS.video;

        shotsGenerated++;
        console.log(`Episode ${epNum} Shot ${shot.shotNumber}: AI video saved: ${cosUrl}`);
        } catch (err) {
          console.error(`Failed to generate video for Episode ${epNum} Shot ${shot.shotNumber}:`, err);
          // Continue with next shot instead of failing the whole episode
        }
      }

      // Save updated shotData to database
      try {
        await db
          .update(episodes)
          .set({ shotData: shots })
          .where(eq(episodes.id, episode.id));
        console.log(`Episode ${epNum}: shotData saved with ${shotsGenerated} new AI videos`);
      } catch (err) {
        console.error(`Failed to save shotData for Episode ${epNum}:`, err);
      }

      // 8. Concat all shot videos (stream copy, no re-encoding) + burn subtitles
      if (shotVideoPaths.length > 0) {
        try {
          const outputDir = path.join(uploadDir, "videos", dramaId, `episode-${epNum}-ai`);

        // Find subtitle file
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

        // Concat with stream copy (videos already have audio mixed in)
        const episodeVideoPath = await concatMixedVideos(
          shotVideoPaths,
          outputDir,
          epNum,
          subtitlePath
        );

        // Upload the final video to COS
        const cosKey = videoCosKey(dramaId, epNum, "ai-concat.mp4");
        const finalUrl = await uploadFileToCos(episodeVideoPath, cosKey);

        // Update episode.videoUrl
        await db
          .update(episodes)
          .set({ videoUrl: finalUrl })
          .where(eq(episodes.id, episode.id));

        console.log(`Episode ${epNum}: final video saved: ${finalUrl}`);
        } catch (err) {
          console.error(`Failed to finalize episode ${epNum}:`, err);
        }
      }

      results.push({
        episodeNumber: epNum,
        success: shotsGenerated > 0 || shotsSkipped === shots.length,
        shotsGenerated,
        shotsSkipped,
      });
    }

    const hasSuccessfulEpisode = results.some((result) => result.success);
    if (!hasSuccessfulEpisode) {
      throw new Error("AI 视频生成未产出可用结果");
    }

    await db
      .update(dramas)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(dramas.id, dramaId));

    await completeGenerationTask(taskId, {
      results,
      mode: "per-shot",
      creditsUsed: totalCreditsUsed,
    });
  } catch (error) {
    console.error("Background video processing failed:", error);
    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
