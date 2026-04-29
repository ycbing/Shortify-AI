import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodes, type Episode } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateVoiceover, generateShotVoiceovers } from "@/lib/ai/voiceover-generator";
import type { Shot } from "@/types/drama";
import path from "path";
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

const log = createLogger("voiceover-api");

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
      const creditCheck = await checkCredits(session.user.id, CREDIT_COSTS.voiceover);
      if (!creditCheck.ok) {
        return NextResponse.json(
          { error: `积分不足，需要 ${CREDIT_COSTS.voiceover} 积分，当前余额 ${creditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
          { status: 402 }
        );
      }

      // Generate for single episode
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      // Check if V2 (shot-based)
      if (episode.shotData && Array.isArray(episode.shotData)) {
        // V2: generate per-shot voiceovers
        const shots = episode.shotData as Shot[];
        const shotAudios = await generateShotVoiceovers(
          shots,
          dramaId,
          episode.episodeNumber
        );

        // Store shot audio results in episode's scriptContent or outputData
        const totalDuration = shotAudios.reduce((sum, a) => sum + a.duration, 0);

        await db
          .update(episodes)
          .set({
            voiceoverUrl: path.join(
              uploadDir,
              "voiceovers",
              dramaId,
              `episode-${episode.episodeNumber}`
            ),
            duration: Math.round(totalDuration),
          })
          .where(eq(episodes.id, episodeId));

        await requireCreditDeduction(
          session.user.id,
          "voiceover",
          undefined,
          dramaId,
          `生成配音 - 第${episode.episodeNumber}集`
        );

        return NextResponse.json({
          episodeId,
          shotAudios,
          totalDuration: Math.round(totalDuration),
        });
      }

      // V1 fallback: single narration voiceover
      if (!episode.narrationText) {
        return NextResponse.json({ error: "剧集无旁白文本" }, { status: 404 });
      }

      const outputPath = path.join(
        uploadDir,
        "voiceovers",
        `${dramaId}`,
        `episode-${episode.episodeNumber}.mp3`
      );

      const result = await generateVoiceover(episode.narrationText, outputPath);

      await db
        .update(episodes)
        .set({
          voiceoverUrl: result.filePath,
          duration: result.durationSeconds,
        })
        .where(eq(episodes.id, episodeId));

      // Deduct credits
      await requireCreditDeduction(session.user.id, "voiceover", undefined, dramaId, `生成配音 - 第${episode.episodeNumber}集`);

      return NextResponse.json({
        episodeId,
        voiceoverUrl: result.filePath,
        duration: result.durationSeconds,
      });
    }

    // Generate for all episodes
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    // Check credits for all episodes
    const activeTask = await getActiveGenerationTask(dramaId, "voiceover");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有配音任务正在进行，已为你恢复到当前任务",
        episodeCount: allEpisodes.length,
      });
    }

    // Concurrency control
    if (!tryAcquireUserSlot(session.user.id)) {
      return NextResponse.json({
        error: `当前有 ${getUserActiveCount(session.user.id)} 个任务正在进行，请等待完成后再试`,
        code: "TOO_MANY_TASKS",
      }, { status: 429 });
    }

    const totalVoiceoverCredits = allEpisodes.length * CREDIT_COSTS.voiceover;
    const voiceCreditCheck = await checkCredits(session.user.id, totalVoiceoverCredits);
    if (!voiceCreditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，生成 ${allEpisodes.length} 集配音需要 ${totalVoiceoverCredits} 积分，当前余额 ${voiceCreditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "voiceover",
      inputData: { episodeCount: allEpisodes.length },
    });
    taskId = taskResult.taskId;

    processVoiceoverGeneration({
      taskId,
      dramaId,
      userId: session.user.id,
      uploadDir,
      allEpisodes,
    }).catch(console.error).finally(() => releaseUserSlot(session.user.id));

    return NextResponse.json({
      taskId,
      message: `正在为 ${allEpisodes.length} 集生成配音，请稍候...`,
      episodeCount: allEpisodes.length,
    });
  } catch (error) {
    console.error("Voiceover generation failed:", error);
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `配音生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

type VoiceoverGenerationParams = {
  taskId: string;
  dramaId: string;
  userId: string;
  uploadDir: string;
  allEpisodes: Episode[];
};

async function processVoiceoverGeneration({
  taskId,
  dramaId,
  userId,
  uploadDir,
  allEpisodes,
}: VoiceoverGenerationParams) {
  const results: { episodeNumber: number; voiceoverUrl: string; duration: number; shotAudios?: unknown[] }[] = [];
  let creditsUsed = 0;

  try {
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
          const shots = episode.shotData as Shot[];
          const shotAudios = await generateShotVoiceovers(
            shots,
            dramaId,
            episode.episodeNumber
          );

          const totalDuration = shotAudios.reduce((sum, a) => sum + a.duration, 0);
          const voiceoverDir = path.join(
            uploadDir,
            "voiceovers",
            dramaId,
            `episode-${episode.episodeNumber}`
          );
          await throwIfGenerationTaskCancelled(taskId);

          await requireCreditDeduction(
            userId,
            "voiceover",
            undefined,
            dramaId,
            `生成配音 - 第${episode.episodeNumber}集`
          );
          creditsUsed += CREDIT_COSTS.voiceover;

          await db
            .update(episodes)
            .set({
              voiceoverUrl: voiceoverDir,
              duration: Math.round(totalDuration),
            })
            .where(eq(episodes.id, episode.id));

          results.push({
            episodeNumber: episode.episodeNumber,
            voiceoverUrl: voiceoverDir,
            duration: Math.round(totalDuration),
            shotAudios,
          });
        } else if (episode.narrationText) {
          const outputPath = path.join(
            uploadDir,
            "voiceovers",
            `${dramaId}`,
            `episode-${episode.episodeNumber}.mp3`
          );

          const result = await generateVoiceover(episode.narrationText, outputPath);
          await throwIfGenerationTaskCancelled(taskId);

          await requireCreditDeduction(
            userId,
            "voiceover",
            undefined,
            dramaId,
            `生成配音 - 第${episode.episodeNumber}集`
          );
          creditsUsed += CREDIT_COSTS.voiceover;

          await db
            .update(episodes)
            .set({
              voiceoverUrl: result.filePath,
              duration: result.durationSeconds,
            })
            .where(eq(episodes.id, episode.id));

          results.push({
            episodeNumber: episode.episodeNumber,
            voiceoverUrl: result.filePath,
            duration: result.durationSeconds,
          });
        }
      } catch (err) {
        if (err instanceof GenerationTaskCancelledError) {
          throw err;
        }
        console.error(`Failed to generate voiceover for episode ${episode.episodeNumber}:`, err);
      }

      await updateGenerationTaskProgress(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
        creditsUsed,
      });
    }

    const hasGeneratedVoiceover = results.some((result) => result.voiceoverUrl);
    if (!hasGeneratedVoiceover) {
      throw new Error("未生成任何可用配音");
    }

    await updateDramaStatus(dramaId, "voiceover_ready");

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
    if (creditsUsed > 0 && !results.some((r) => r.voiceoverUrl)) {
      log.warn(`No voiceover generated, refunding ${creditsUsed} credits`, { dramaId, taskId });
      await refundCredits(userId, creditsUsed, dramaId, "配音生成失败 - 积分退还").catch(console.error);
    }

    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
