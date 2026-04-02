import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { submitVideoGeneration, waitForVideoCompletion } from "@/lib/ai/video-generator";

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
    processVideos(dramaId, targetEpisodes, drama[0].style || "realistic", taskId).catch(console.error);

    return NextResponse.json({
      taskId,
      message: `正在为 ${targetEpisodes.length} 集生成视频，请稍候...`,
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
  const results: { episodeNumber: number; videoUrl: string; error?: string }[] = [];

  for (const episode of episodesList) {
    try {
      if (!episode.imageUrl && !episode.narrationText) {
        results.push({ episodeNumber: episode.episodeNumber, videoUrl: "", error: "缺少图片或旁白" });
        continue;
      }

      // Use narration text as prompt, or image as input
      const prompt = episode.narrationText || "电影场景";

      const { taskId: videoTaskId } = await submitVideoGeneration(
        prompt,
        episode.imageUrl || undefined,
        style
      );

      // Wait for completion (max 5 min per episode)
      const result = await waitForVideoCompletion(videoTaskId, 300000, 5000);

      // Save video URL to database
      await db
        .update(episodes)
        .set({ videoUrl: result.videoUrl })
        .where(eq(episodes.id, episode.id));

      results.push({ episodeNumber: episode.episodeNumber, videoUrl: result.videoUrl });
    } catch (err) {
      console.error(`Failed to generate video for episode ${episode.episodeNumber}:`, err);
      results.push({
        episodeNumber: episode.episodeNumber,
        videoUrl: "",
        error: err instanceof Error ? err.message : "生成失败",
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
