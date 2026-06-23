import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, type Episode } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos, imageCosKey } from "@/lib/ai/cos-storage";
import path from "path";
import fs from "fs/promises";
import type { Shot, Character } from "@/types/drama";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction, refundCredits } from "@/lib/credits";
import { getOwnedDrama } from "@/lib/dramas";
import { updateDramaStatus } from "@/lib/drama-status";
import {
  completeGenerationTask,
  createOrReuseGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  GenerationTaskCancelledError,
  touchGenerationTaskHeartbeat,
  throwIfGenerationTaskCancelled,
  updateGenerationTaskProgress,
} from "@/lib/generation";
import { tryAcquireUserSlot, releaseUserSlot, getUserActiveCount } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";
import { storyboardSchema } from "@/lib/validation";

const log = createLogger("storyboard-api");

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

/**
 * Find characters referenced in a shot by dialogue or visual description.
 */
function findCharactersInShot(
  shot: Shot,
  characters: Character[]
): Character[] {
  const found: Character[] = [];

  if (shot.type === "dialogue" && shot.character) {
    const char = characters.find((c) => c.name === shot.character);
    if (char) found.push(char);
  }

  for (const char of characters) {
    if (
      !found.includes(char) &&
      char.name &&
      shot.visual?.includes(char.name)
    ) {
      found.push(char);
    }
  }

  return found;
}

/**
 * Build character reference list for Kling API from the refMap.
 */
function buildShotCharacterRefs(
  shot: Shot,
  characters: Character[],
  refMap: Map<string, string>
): { imageUrl: string; type: "face" | "full_body"; characterName: string }[] {
  const refs: { imageUrl: string; type: "face" | "full_body"; characterName: string }[] = [];
  const shotChars = findCharactersInShot(shot, characters);

  for (const c of shotChars) {
    const refUrl = refMap.get(c.name);
    if (refUrl) {
      refs.push({
        imageUrl: refUrl,
        type: "face",
        characterName: c.name,
      });
    }
  }

  return refs;
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
    const parsed = storyboardSchema.safeParse(body);
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

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");

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
        const refMap = new Map<string, string>();
        for (const c of characters) {
          if (c.referenceImageUrl) refMap.set(c.name, c.referenceImageUrl);
        }
        const shotResult = await handleShotStoryboard(episode, drama.style, dramaId, uploadDir, characters, refMap, true, (drama.aspectRatio as "landscape" | "vertical") || "landscape");

        await requireCreditDeduction(
          session.user.id,
          "storyboard",
          undefined,
          dramaId,
          `生成分镜 - 第${episode.episodeNumber}集`
        );

        // Inject shot-level imageUrl back into shot_data
        if (shotResult.shotImages && shotResult.shotImages.length > 0) {
          const updatedShotData = (Array.isArray(episode.shotData) ? episode.shotData : []).map(
            (shot: Shot) => {
              const matched = shotResult.shotImages!.find(s => s.shotNumber === shot.shotNumber);
              return matched?.imageUrl ? { ...shot, imageUrl: matched.imageUrl } : shot;
            }
          );
          await db
            .update(episodes)
            .set({ imageUrl: shotResult.imageUrl, shotData: updatedShotData })
            .where(eq(episodes.id, episode.id));
        }

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

    // Concurrency control: max 2 tasks per user
    if (!tryAcquireUserSlot(session.user.id)) {
      return NextResponse.json({
        error: `当前有 ${getUserActiveCount(session.user.id)} 个任务正在进行，请等待完成后再试`,
        code: "TOO_MANY_TASKS",
      }, { status: 429 });
    }

    const totalCredits = allEpisodes.length * CREDIT_COSTS.storyboard;
    const bulkCreditCheck = await checkCredits(session.user.id, totalCredits);
    if (!bulkCreditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，生成 ${allEpisodes.length} 集分镜需要 ${totalCredits} 积分，当前余额 ${bulkCreditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "storyboard",
      inputData: { episodeCount: allEpisodes.length },
    });
    taskId = taskResult.taskId;

    processStoryboardGeneration({
      taskId,
      dramaId,
      userId: session.user.id,
      style: drama.style,
      aspectRatio: (drama.aspectRatio as "landscape" | "vertical") || "landscape",
      characters: Array.isArray(drama.characters) ? drama.characters : [],
      uploadDir,
      allEpisodes,
    }).catch(err => log.error("Background storyboard processing failed", { error: err instanceof Error ? err.message : String(err) })).finally(() => releaseUserSlot(session.user.id));

    return NextResponse.json({
      taskId,
      message: `正在为 ${allEpisodes.length} 集生成分镜，请稍候...`,
      episodeCount: allEpisodes.length,
    });
  } catch (error) {
    log.error("Storyboard generation failed", { error: error instanceof Error ? error.message : String(error) });
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
  aspectRatio: "landscape" | "vertical";
  characters: Character[];
  uploadDir: string;
  allEpisodes: Episode[];
};

async function processStoryboardGeneration({
  taskId,
  dramaId,
  userId,
  style,
  aspectRatio,
  characters,
  uploadDir,
  allEpisodes,
}: StoryboardGenerationParams) {
  const results: { episodeNumber: number; imageUrl: string; shotImages?: { shotNumber: number; imageUrl: string }[] }[] = [];
  let creditsUsed = 0;

  try {
    const refMap = new Map<string, string>();
    for (const c of characters) {
      if (c.referenceImageUrl) refMap.set(c.name, c.referenceImageUrl);
    }

    for (const episode of allEpisodes) {
      await throwIfGenerationTaskCancelled(taskId);

      try {
        await touchGenerationTaskHeartbeat(taskId, {
          currentEpisode: episode.episodeNumber,
          stage: "generate",
          completedCount: results.length,
          episodeCount: allEpisodes.length,
          creditsUsed,
        });

        if (episode.shotData && Array.isArray(episode.shotData)) {
          const result = await handleShotStoryboard(
            episode,
            style,
            dramaId,
            uploadDir,
            characters,
            refMap,
            false,
            aspectRatio
          );
          await throwIfGenerationTaskCancelled(taskId);

          if (result.imageUrl) {
            await requireCreditDeduction(
              userId,
              "storyboard",
              undefined,
              dramaId,
              `生成分镜 - 第${episode.episodeNumber}集`
            );
            creditsUsed += CREDIT_COSTS.storyboard;

            // Inject shot-level imageUrl back into shot_data
            if (result.shotImages && result.shotImages.length > 0) {
              const updatedShotData = (Array.isArray(episode.shotData) ? episode.shotData : []).map(
                (shot: Shot) => {
                  const matched = result.shotImages!.find(s => s.shotNumber === shot.shotNumber);
                  return matched?.imageUrl ? { ...shot, imageUrl: matched.imageUrl } : shot;
                }
              );
              await db
                .update(episodes)
                .set({ imageUrl: result.imageUrl, shotData: updatedShotData })
                .where(eq(episodes.id, episode.id));
            } else {
              await db
                .update(episodes)
                .set({ imageUrl: result.imageUrl })
                .where(eq(episodes.id, episode.id));
            }
          }

          results.push(result);
        } else {
          const scriptContent = episode.scriptContent
            ? JSON.parse(episode.scriptContent)
            : null;

          const sceneDescription =
            scriptContent?.sceneDescription || episode.narrationText || "cinematic scene";

          const imageUrl = await generateImage(sceneDescription, style || "realistic");
          await throwIfGenerationTaskCancelled(taskId);

          await requireCreditDeduction(
            userId,
            "storyboard",
            undefined,
            dramaId,
            `生成分镜 - 第${episode.episodeNumber}集`
          );
          creditsUsed += CREDIT_COSTS.storyboard;

          await db
            .update(episodes)
            .set({ imageUrl })
            .where(eq(episodes.id, episode.id));

          results.push({ episodeNumber: episode.episodeNumber, imageUrl });
        }
      } catch (err) {
        if (err instanceof GenerationTaskCancelledError) {
          throw err;
        }
        log.error(`Failed to generate image for episode ${episode.episodeNumber}`, {
          error: err instanceof Error ? err.message : String(err),
          dramaId,
          episodeNumber: episode.episodeNumber,
        });
        results.push({ episodeNumber: episode.episodeNumber, imageUrl: "" });
      }

      await updateGenerationTaskProgress(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
        creditsUsed,
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

    await updateDramaStatus(dramaId, "storyboard_ready");

    await completeGenerationTask(taskId, {
      completedCount: results.length,
      episodeCount: allEpisodes.length,
      creditsUsed,
      results,
    });
  } catch (error) {
    if (error instanceof GenerationTaskCancelledError) {
      return;
    }

    // Refund credits if nothing was generated
    if (creditsUsed > 0 && !results.some((r) => r.imageUrl || r.shotImages?.some((s) => s.imageUrl))) {
      log.warn(`No storyboard generated, refunding ${creditsUsed} credits`, { dramaId, taskId });
      await refundCredits(userId, creditsUsed, dramaId, "分镜生成失败 - 积分退还").catch(err => log.error("Failed to refund credits", { error: err instanceof Error ? err.message : String(err) }));
    }

    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}

// ============ V2: Shot-level storyboard ============

/**
 * 为缺少参考图的角色自动生成标准参考图（正面半身照）
 * 在第一个镜头生图前调用，确保后续镜头都有参考图可用
 */
async function autoGenerateMissingReferences(
  characters: Character[],
  refMap: Map<string, string>,
  style: string,
  dramaId: string
): Promise<void> {
  const missingChars = characters.filter((c) => c.appearance && !refMap.has(c.name));
  for (const char of missingChars) {
    try {
      const appearance = char.appearance || char.description || "";
      const refPrompt = `${char.name}正面半身肖像，${appearance}，白色纯色背景，摄影棚均匀打光，高清摄影，面部五官清晰，自然表情，看向前方，肖像摄影`;
      log.info(`自动生成角色参考图: ${char.name}`);
      const imageUrl = await generateImage(refPrompt, style, "1024x1024");
      refMap.set(char.name, imageUrl);
      // 同步更新 drama.characters
      const drama = await db.select({ characters: dramas.characters }).from(dramas).where(eq(dramas.id, dramaId)).limit(1);
      if (drama[0]?.characters) {
        const chars: Character[] = Array.isArray(drama[0].characters) ? drama[0].characters : [];
        const idx = chars.findIndex((c) => c.name === char.name);
        if (idx >= 0) {
          chars[idx] = { ...chars[idx], referenceImageUrl: imageUrl };
          await db.update(dramas).set({ characters: chars as any }).where(eq(dramas.id, dramaId));
        }
      }
    } catch (err) {
      log.warn(`自动生成角色参考图失败: ${char.name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function handleShotStoryboard(
  episode: { id: string; episodeNumber: number; shotData: unknown },
  style: string | null,
  dramaId: string,
  uploadDir: string,
  characters: Character[] = [],
  refMap: Map<string, string> = new Map(),
  persistEpisodeImage: boolean = true,
  aspectRatio: "landscape" | "vertical" = "landscape"
): Promise<{ episodeNumber: number; imageUrl: string; shotImages: { shotNumber: number; imageUrl: string }[] }> {
  const shots = episode.shotData as unknown as Shot[];
  const shotImages: { shotNumber: number; imageUrl: string }[] = [];

  // 自动为缺少参考图的角色生成参考图（只在第一集触发）
  if (episode.episodeNumber === 1) {
    await autoGenerateMissingReferences(characters, refMap, style || "realistic", dramaId);
  }

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    // Rate-limit: LibLib QPS is 1/sec; wait before each request (skip first)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    try {
      const enrichedPrompt = buildAppearancePrompt(shot, characters);

      const characterReferences = buildShotCharacterRefs(shot, characters, refMap);

      const imageUrl = await generateImage(
        enrichedPrompt,
        style || "realistic",
        aspectRatio === "vertical" ? "960x1728" : "1728x960",
        { characterReferences: characterReferences.length > 0 ? characterReferences : undefined }
      );

      // First time a character appears in a shot, save the image as their reference
      const shotChars = findCharactersInShot(shot, characters);
      for (const c of shotChars) {
        if (!refMap.has(c.name)) {
          refMap.set(c.name, imageUrl);
        }
      }

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

        const cosKey = imageCosKey(dramaId, episode.episodeNumber, shot.shotNumber);
        const finalUrl = await uploadFileToCos(savePath, cosKey);
        shotImages.push({ shotNumber: shot.shotNumber, imageUrl: finalUrl });
      } else {
        shotImages.push({ shotNumber: shot.shotNumber, imageUrl });
      }
    } catch (err) {
      log.error("Failed to generate image for shot", { shotNumber: shot.shotNumber, error: err instanceof Error ? err.message : String(err) });
      shotImages.push({ shotNumber: shot.shotNumber, imageUrl: "" });
    }
  }

  const firstImageUrl = shotImages.find((s) => s.imageUrl)?.imageUrl || "";

  if (persistEpisodeImage) {
    await db
      .update(episodes)
      .set({ imageUrl: firstImageUrl || null })
      .where(eq(episodes.id, episode.id));
  }

  // Persist character reference images to drama record
  const mergedCharacters = characters.map((c) => ({
    ...c,
    referenceImageUrl: refMap.has(c.name)
      ? refMap.get(c.name)!
      : c.referenceImageUrl,
  }));
  await db
    .update(dramas)
    .set({ characters: mergedCharacters as any })
    .where(eq(dramas.id, dramaId));

  return {
    episodeNumber: episode.episodeNumber,
    imageUrl: firstImageUrl,
    shotImages,
  };
}
