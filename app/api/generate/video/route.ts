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
  imageToBase64,
} from "@/lib/ai/video-generator";
import { uploadFileToCos, aiVideoCosKey } from "@/lib/ai/cos-storage";
import type { Shot } from "@/types/drama";
import path from "path";
import fs from "fs/promises";

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
      inputData: { episodeCount: targetEpisodes.length },
      startedAt: new Date(),
    });

    // Process in background (don't await all)
    processVideos(dramaId, targetEpisodes, drama[0].style || "realistic", taskId).catch(
      console.error
    );

    return NextResponse.json({
      taskId,
      message: `正在为 ${targetEpisodes.length} 集生成 AI 视频，请稍候...`,
      episodeCount: targetEpisodes.length,
    });
  } catch (error) {
    console.error("Video generation failed:", error);
    return NextResponse.json(
      { error: `视频生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

async function processVideos(
  dramaId: string,
  episodesList: typeof episodes.$inferSelect[],
  style: string,
  taskId: string
) {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const results: {
    episodeNumber: number;
    shotsProcessed: number;
    shotsFailed: number;
    error?: string;
  }[] = [];

  for (const episode of episodesList) {
    const epNum = episode.episodeNumber;
    let shotsProcessed = 0;
    let shotsFailed = 0;

    try {
      // Only process V2 shot-based episodes
      if (!episode.shotData || !Array.isArray(episode.shotData)) {
        results.push({
          episodeNumber: epNum,
          shotsProcessed: 0,
          shotsFailed: 0,
          error: "跳过：非 V2 shot 格式",
        });
        continue;
      }

      const shots = episode.shotData as Shot[];

      // Output directory for AI videos
      const aiVideoDir = path.join(
        uploadDir,
        "videos",
        dramaId,
        `episode-${epNum}-ai`
      );

      for (const shot of shots) {
        // Skip shots that already have AI video
        if (shot.aiVideoUrl) {
          console.log(
            `Episode ${epNum} shot ${shot.shotNumber}: AI video already exists, skipping`
          );
          shotsProcessed++;
          continue;
        }

        // Find shot image on disk
        const shotImageDir = path.join(
          uploadDir,
          "images",
          dramaId,
          `episode-${epNum}`
        );
        let shotImagePath: string | null = null;

        for (const ext of [".jpg", ".jpeg", ".png"]) {
          const candidate = path.join(
            shotImageDir,
            `shot-${shot.shotNumber}${ext}`
          );
          try {
            await fs.access(candidate);
            shotImagePath = candidate;
            break;
          } catch {
            // not found
          }
        }

        if (!shotImagePath) {
          console.warn(
            `Episode ${epNum} shot ${shot.shotNumber}: no image found, skipping`
          );
          shotsFailed++;
          continue;
        }

        try {
          // Build prompt from shot subtitle or line
          const prompt =
            shot.subtitle || shot.line || shot.visual || "电影场景";

          // Convert local image to base64 for CogVideoX API
          const imageBase64 = await imageToBase64(shotImagePath);

          // Submit video generation
          const { taskId: videoTaskId } = await submitVideoGeneration(
            prompt,
            imageBase64,
            style
          );

          // Wait for completion (max 5 min per shot)
          const result = await waitForVideoCompletion(videoTaskId, 300000, 5000);

          // Download video to local
          const localVideoPath = path.join(
            aiVideoDir,
            `shot-${shot.shotNumber}.mp4`
          );
          await downloadVideo(result.videoUrl, localVideoPath);

          // Upload to COS if configured
          const cosKey = aiVideoCosKey(dramaId, epNum, shot.shotNumber);
          const finalVideoUrl = await uploadFileToCos(localVideoPath, cosKey);

          // Update shot's aiVideoUrl in the episode's shotData
          shot.aiVideoUrl = finalVideoUrl;

          console.log(
            `Episode ${epNum} shot ${shot.shotNumber}: AI video saved to ${localVideoPath}`
          );
          shotsProcessed++;
        } catch (err) {
          console.error(
            `Episode ${epNum} shot ${shot.shotNumber}: generation failed`,
            err
          );
          shotsFailed++;
        }
      }

      // Save updated shotData back to database
      await db
        .update(episodes)
        .set({ shotData: shots as unknown as Record<string, unknown> })
        .where(eq(episodes.id, episode.id));

      results.push({
        episodeNumber: epNum,
        shotsProcessed,
        shotsFailed,
      });
    } catch (err) {
      console.error(`Failed to process episode ${epNum}:`, err);
      results.push({
        episodeNumber: epNum,
        shotsProcessed,
        shotsFailed,
        error: err instanceof Error ? err.message : "处理失败",
      });
    }
  }

  // Update drama and task status
  await db
    .update(dramas)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(dramas.id, dramaId));

  await db
    .update(generationTasks)
    .set({ status: "completed", outputData: { results }, completedAt: new Date() })
    .where(eq(generationTasks.id, taskId));
}
