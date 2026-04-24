import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks, type Episode } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos, imageCosKey } from "@/lib/ai/cos-storage";
import path from "path";
import fs from "fs/promises";
import type { Shot, Character } from "@/types/drama";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction } from "@/lib/credits";
import { getOwnedDrama } from "@/lib/dramas";
import {
  completeGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  isGenerationTaskCancelled,
  updateGenerationTaskProgress,
} from "@/lib/generation";

/**
 * Build appearance-enriched prompt for a shot.
 * If the shot references a character and that character has an appearance,
 * prepend the appearance description to the visual prompt.
 */
function buildAppearancePrompt(
  shot: Shot,
  characters: Character[]
): string {
  if (!shot.visual) return shot.visual || "";

  // Find character appearances to include
  const referencedCharacters: Character[] = [];

  if (shot.type === "dialogue" && shot.character) {
    const char = characters.find(
      (c) => c.name === shot.character
    );
    if (char) referencedCharacters.push(char);
  }

  // Also try to find characters mentioned by name in the visual text
  for (const char of characters) {
    if (
      char.appearance &&
      !referencedCharacters.includes(char) &&
      shot.visual.includes(char.name)
    ) {
      referencedCharacters.push(char);
    }
  }

  if (referencedCharacters.length === 0) {
    return shot.visual;
  }

  // Prepend character appearances
  const appearanceDescs = referencedCharacters
    .filter((c) => c.appearance)
    .map((c) => c.appearance)
    .join("。");

  if (!appearanceDescs) return shot.visual;

  return `${appearanceDescs}。${shot.visual}`;
}

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

    const uploadDir = process.env.UPLOAD_DIR || "./uploads";

    if (episodeId) {
      // Check credits for single episode
      const creditCheck = await checkCredits(session.user.id, CREDIT_COSTS.storyboard);
      if (!creditCheck.ok) {
        return NextResponse.json(
          { error: `积分不足，需要 ${CREDIT_COSTS.storyboard} 积分，当前余额 ${creditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
          { status: 402 }
        );
      }

      // Generate for a single episode
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      // V2: shot-based image generation
      if (episode.shotData && Array.isArray(episode.shotData)) {
        const characters: Character[] = Array.isArray(drama.characters) ? drama.characters : [];
        const shotResult = await handleShotStoryboard(episode, drama.style, dramaId, uploadDir, characters);

        await requireCreditDeduction(
          session.user.id,
          "storyboard",
          undefined,
          dramaId,
          `生成分镜 - 第${episode.episodeNumber}集`
        );

        return NextResponse.json(shotResult);
      }

      // V1: legacy single image per episode
      const scriptContent = episode.scriptContent
        ? JSON.parse(episode.scriptContent)
        : null;

      const sceneDescription = scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

      const imageUrl = await generateImage(sceneDescription, drama.style || "realistic");

      await db
        .update(episodes)
        .set({ imageUrl })
        .where(eq(episodes.id, episodeId));

      // Deduct credits
      await requireCreditDeduction(session.user.id, "storyboard", undefined, dramaId, `生成分镜 - 第${episode.episodeNumber}集`);

      return NextResponse.json({ episodeId, imageUrl });
    }

    // Check credits for all episodes
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    const activeTask = await getActiveGenerationTask(dramaId, "storyboard");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有分镜任务正在进行，已为你恢复到当前任务",
        episodeCount: allEpisodes.length,
      });
    }

    const totalCredits = allEpisodes.length * CREDIT_COSTS.storyboard;
    const bulkCreditCheck = await checkCredits(session.user.id, totalCredits);
    if (!bulkCreditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，生成 ${allEpisodes.length} 集分镜需要 ${totalCredits} 积分，当前余额 ${bulkCreditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "storyboard",
      status: "processing",
      inputData: { episodeCount: allEpisodes.length },
      startedAt: new Date(),
    });

    processStoryboardGeneration({
      taskId,
      dramaId,
      userId: session.user.id,
      style: drama.style,
      characters: Array.isArray(drama.characters) ? drama.characters : [],
      uploadDir,
      allEpisodes,
      totalCredits,
    }).catch(console.error);

    return NextResponse.json({
      taskId,
      message: `正在为 ${allEpisodes.length} 集生成分镜，请稍候...`,
      episodeCount: allEpisodes.length,
    });
  } catch (error) {
    console.error("Storyboard generation failed:", error);
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `分镜生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

type StoryboardGenerationParams = {
  taskId: string;
  dramaId: string;
  userId: string;
  style: string | null;
  characters: Character[];
  uploadDir: string;
  allEpisodes: Episode[];
  totalCredits: number;
};

async function processStoryboardGeneration({
  taskId,
  dramaId,
  userId,
  style,
  characters,
  uploadDir,
  allEpisodes,
  totalCredits,
}: StoryboardGenerationParams) {
  try {
    const results: { episodeNumber: number; imageUrl: string; shotImages?: { shotNumber: number; imageUrl: string }[] }[] = [];

    for (const episode of allEpisodes) {
      if (await isGenerationTaskCancelled(taskId)) {
        return;
      }

      try {
        if (episode.shotData && Array.isArray(episode.shotData)) {
          const result = await handleShotStoryboard(episode, style, dramaId, uploadDir, characters);
          results.push(result);
        } else {
          const scriptContent = episode.scriptContent
            ? JSON.parse(episode.scriptContent)
            : null;

          const sceneDescription =
            scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

          const imageUrl = await generateImage(sceneDescription, style || "realistic");

          await db
            .update(episodes)
            .set({ imageUrl })
            .where(eq(episodes.id, episode.id));

          results.push({ episodeNumber: episode.episodeNumber, imageUrl });
        }
      } catch (err) {
        console.error(`Failed to generate image for episode ${episode.episodeNumber}:`, err);
        results.push({ episodeNumber: episode.episodeNumber, imageUrl: "" });
      }

      await updateGenerationTaskProgress(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
      });
    }

    const firstResult = results.find((result) => result.imageUrl);
    if (firstResult?.imageUrl) {
      const currentDrama = await db
        .select({ coverUrl: dramas.coverUrl })
        .from(dramas)
        .where(eq(dramas.id, dramaId))
        .limit(1);

      if (!currentDrama[0]?.coverUrl) {
        await db
          .update(dramas)
          .set({ coverUrl: firstResult.imageUrl })
          .where(eq(dramas.id, dramaId));
      }
    }

    const hasGeneratedStoryboard = results.some(
      (result) => result.imageUrl || result.shotImages?.some((shot) => shot.imageUrl)
    );
    if (!hasGeneratedStoryboard) {
      throw new Error("未生成任何可用分镜");
    }

    await requireCreditDeduction(
      userId,
      "storyboard",
      totalCredits,
      dramaId,
      `生成分镜图片 - 共${allEpisodes.length}集`
    );

    await db
      .update(dramas)
      .set({ status: "storyboard_ready", updatedAt: new Date() })
      .where(eq(dramas.id, dramaId));

    await completeGenerationTask(taskId, {
      completedCount: results.length,
      episodeCount: allEpisodes.length,
      results,
    });
  } catch (error) {
    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}

// ============ V2: Shot-level storyboard ============

async function handleShotStoryboard(
  episode: { id: string; episodeNumber: number; shotData: unknown },
  style: string | null,
  dramaId: string,
  uploadDir: string,
  characters: Character[] = []
): Promise<{ episodeNumber: number; imageUrl: string; shotImages: { shotNumber: number; imageUrl: string }[] }> {
  const shots = episode.shotData as unknown as Shot[];
  const shotImages: { shotNumber: number; imageUrl: string }[] = [];

  // Generate image for each shot's visual description
  for (const shot of shots) {
    try {
      // Build appearance-enriched prompt for consistent character look
      const enrichedPrompt = buildAppearancePrompt(shot, characters);

      const imageUrl = await generateImage(
        enrichedPrompt,
        style || "realistic",
        "1920x1080"
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
