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
import { checkCredits, deductCredits, CREDIT_COSTS } from "@/lib/credits";
import { execSync } from "child_process";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId, episodeId } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    const drama = await db.select().from(dramas).where(eq(dramas.id, dramaId)).limit(1);
    if (!drama.length) {
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
    const taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "video",
      status: "processing",
      inputData: { episodeCount: episodesNeedingVideo.length, shotCount: totalShotsNeeded },
      startedAt: new Date(),
    });

    // Process in background
    processVideos(dramaId, episodesNeedingVideo, drama[0].style || "realistic", taskId, session.user.id).catch(
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
 * Concatenate multiple video files using ffmpeg concat demuxer.
 * All videos must have the same codec/parameters.
 */
async function concatVideos(
  videoPaths: string[],
  outputDir: string,
  epNum: number
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `episode-${epNum}-concat.mp4`);
  const listFile = path.join(outputDir, `concat-list-${epNum}.txt`);

  // Write concat list file (ffmpeg concat demuxer format)
  const lines = videoPaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(listFile, lines);

  try {
    // Use concat demuxer - re-encode to ensure compatible formats
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outputPath}"`,
      { timeout: 120000 }
    );
  } catch (err) {
    // If concat copy fails (different codecs), re-encode
    console.warn(`Concat copy failed, re-encoding episode ${epNum}...`, err);
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -movflags +faststart "${outputPath}"`,
      { timeout: 300000 }
    );
  }

  // Cleanup list file
  try {
    await fs.unlink(listFile);
  } catch {
    // ignore
  }

  return outputPath;
}

async function processVideos(
  dramaId: string,
  episodesList: typeof episodes.$inferSelect[],
  style: string,
  taskId: string,
  userId: string
) {
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

        shotVideoPaths.push(localVideoPath);

        // 7. Upload video to COS
        const cosKey = aiVideoCosKey(dramaId, epNum, shot.shotNumber);
        const cosUrl = await uploadFileToCos(localVideoPath, cosKey);
        shot.aiVideoUrl = cosUrl;

        // Deduct credits per shot
        await deductCredits(userId, "video", CREDIT_COSTS.video, dramaId, `AI 视频生成：第 ${epNum} 集 镜头 ${shot.shotNumber}`);
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

    // 8. If we generated any shot videos, concat them into a full episode video
    if (shotVideoPaths.length > 0) {
      try {
        const outputDir = path.join(uploadDir, "videos", dramaId, `episode-${epNum}-ai`);
        const episodeVideoPath = await concatVideos(shotVideoPaths, outputDir, epNum);

        // Upload the concatenated video to COS
        const cosKey = videoCosKey(dramaId, epNum, "ai-concat.mp4");
        const finalUrl = await uploadFileToCos(episodeVideoPath, cosKey);

        // Update episode.videoUrl with the concatenated video
        await db
          .update(episodes)
          .set({ videoUrl: finalUrl })
          .where(eq(episodes.id, episode.id));

        console.log(`Episode ${epNum}: concatenated video saved: ${finalUrl}`);
      } catch (err) {
        console.error(`Failed to concat videos for Episode ${epNum}:`, err);
      }
    }

    results.push({
      episodeNumber: epNum,
      success: shotsGenerated > 0 || shotsSkipped === shots.length,
      shotsGenerated,
      shotsSkipped,
    });
  }

  // Update drama and task status
  await db
    .update(dramas)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(dramas.id, dramaId));

  await db
    .update(generationTasks)
    .set({
      status: "completed",
      outputData: { results, mode: "per-shot", creditsUsed: totalCreditsUsed },
      completedAt: new Date(),
    })
    .where(eq(generationTasks.id, taskId));
}
