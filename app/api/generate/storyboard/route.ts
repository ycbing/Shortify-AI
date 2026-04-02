import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateImage, downloadImage } from "@/lib/ai/image-generator";
import path from "path";

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

    const uploadDir = process.env.UPLOAD_DIR || "./uploads";

    if (episodeId) {
      // Generate for a single episode
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      const drama = await db.select().from(dramas).where(eq(dramas.id, dramaId)).limit(1);
      if (!drama.length) {
        return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
      }

      const scriptContent = episode.scriptContent
        ? JSON.parse(episode.scriptContent)
        : null;

      const sceneDescription = scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

      const imageUrl = await generateImage(sceneDescription, drama[0].style || "realistic");

      // 直接使用 CogView 返回的远程 URL
      await db
        .update(episodes)
        .set({ imageUrl })
        .where(eq(episodes.id, episodeId));

      return NextResponse.json({ episodeId, imageUrl });
    }

    // Generate for all episodes
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    const drama = await db.select().from(dramas).where(eq(dramas.id, dramaId)).limit(1);
    if (!drama.length) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "storyboard",
      status: "processing",
      inputData: { episodeCount: allEpisodes.length },
      startedAt: new Date(),
    });

    const results: { episodeNumber: number; imageUrl: string }[] = [];

    for (const episode of allEpisodes) {
      try {
        const scriptContent = episode.scriptContent
          ? JSON.parse(episode.scriptContent)
          : null;

        const sceneDescription =
          scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

        const imageUrl = await generateImage(sceneDescription, drama[0].style || "realistic");

        // 直接使用 CogView 返回的远程 URL
        await db
          .update(episodes)
          .set({ imageUrl })
          .where(eq(episodes.id, episode.id));

        results.push({ episodeNumber: episode.episodeNumber, imageUrl });
      } catch (err) {
        console.error(`Failed to generate image for episode ${episode.episodeNumber}:`, err);
        results.push({ episodeNumber: episode.episodeNumber, imageUrl: "" });
      }
    }

    await db
      .update(dramas)
      .set({ status: "storyboard_ready", updatedAt: new Date() })
      .where(eq(dramas.id, dramaId));

    await db
      .update(generationTasks)
      .set({ status: "completed", outputData: { results }, completedAt: new Date() })
      .where(eq(generationTasks.id, taskId));

    return NextResponse.json({ taskId, results });
  } catch (error) {
    console.error("Storyboard generation failed:", error);
    return NextResponse.json(
      { error: `分镜生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
