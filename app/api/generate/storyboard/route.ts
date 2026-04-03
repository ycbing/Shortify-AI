import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos, imageCosKey } from "@/lib/ai/cos-storage";
import path from "path";
import fs from "fs/promises";
import type { Shot } from "@/types/drama";

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

      // V2: shot-based image generation
      if (episode.shotData && Array.isArray(episode.shotData)) {
        const shotResult = await handleShotStoryboard(episode, drama[0].style, dramaId, uploadDir);
        return NextResponse.json(shotResult);
      }

      // V1: legacy single image per episode
      const scriptContent = episode.scriptContent
        ? JSON.parse(episode.scriptContent)
        : null;

      const sceneDescription = scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

      const imageUrl = await generateImage(sceneDescription, drama[0].style || "realistic");

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

    const results: { episodeNumber: number; imageUrl: string; shotImages?: { shotNumber: number; imageUrl: string }[] }[] = [];

    for (const episode of allEpisodes) {
      try {
        // V2: shot-based
        if (episode.shotData && Array.isArray(episode.shotData)) {
          const result = await handleShotStoryboard(episode, drama[0].style, dramaId, uploadDir);
          results.push(result);
          continue;
        }

        // V1: legacy
        const scriptContent = episode.scriptContent
          ? JSON.parse(episode.scriptContent)
          : null;

        const sceneDescription =
          scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

        const imageUrl = await generateImage(sceneDescription, drama[0].style || "realistic");

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

// ============ V2: Shot-level storyboard ============

async function handleShotStoryboard(
  episode: { id: string; episodeNumber: number; shotData: unknown },
  style: string | null,
  dramaId: string,
  uploadDir: string
): Promise<{ episodeNumber: number; imageUrl: string; shotImages: { shotNumber: number; imageUrl: string }[] }> {
  const shots = episode.shotData as unknown as Shot[];
  const shotImages: { shotNumber: number; imageUrl: string }[] = [];

  // Generate image for each shot's visual description
  for (const shot of shots) {
    try {
      const imageUrl = await generateImage(
        shot.visual,
        style || "realistic",
        "1280x720"
      );

      // Download image to local storage
      const savePath = path.join(
        uploadDir,
        "images",
        dramaId,
        `episode-${episode.episodeNumber}`,
        `shot-${shot.shotNumber}.jpg`
      );
      await fs.mkdir(path.dirname(savePath), { recursive: true });

      const response = await fetch(imageUrl);
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(savePath, buffer);

        // Upload to COS if configured
        const cosKey = imageCosKey(dramaId, episode.episodeNumber, shot.shotNumber);
        const finalUrl = await uploadFileToCos(savePath, cosKey);
        shotImages.push({ shotNumber: shot.shotNumber, imageUrl: finalUrl });
      } else {
        shotImages.push({ shotNumber: shot.shotNumber, imageUrl });
      }
    } catch (err) {
      console.error(`Failed to generate image for shot ${shot.shotNumber}:`, err);
      shotImages.push({ shotNumber: shot.shotNumber, imageUrl: "" });
    }
  }

  // Use first shot image as episode image
  const firstImageUrl = shotImages.find((s) => s.imageUrl)?.imageUrl || "";

  await db
    .update(episodes)
    .set({ imageUrl: firstImageUrl || null })
    .where(eq(episodes.id, episode.id));

  return {
    episodeNumber: episode.episodeNumber,
    imageUrl: firstImageUrl,
    shotImages,
  };
}
