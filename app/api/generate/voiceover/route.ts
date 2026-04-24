import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks, type Episode } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateVoiceover, generateShotVoiceovers } from "@/lib/ai/voiceover-generator";
import type { Shot } from "@/types/drama";
import path from "path";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction } from "@/lib/credits";
import { getOwnedDrama } from "@/lib/dramas";
import {
  completeGenerationTask,
  failGenerationTask,
  updateGenerationTaskProgress,
} from "@/lib/generation";

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
    const totalVoiceoverCredits = allEpisodes.length * CREDIT_COSTS.voiceover;
    const voiceCreditCheck = await checkCredits(session.user.id, totalVoiceoverCredits);
    if (!voiceCreditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，生成 ${allEpisodes.length} 集配音需要 ${totalVoiceoverCredits} 积分，当前余额 ${voiceCreditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "voiceover",
      status: "processing",
      inputData: { episodeCount: allEpisodes.length },
      startedAt: new Date(),
    });

    processVoiceoverGeneration({
      taskId,
      dramaId,
      userId: session.user.id,
      uploadDir,
      allEpisodes,
      totalCredits: totalVoiceoverCredits,
    }).catch(console.error);

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
  totalCredits: number;
};

async function processVoiceoverGeneration({
  taskId,
  dramaId,
  userId,
  uploadDir,
  allEpisodes,
  totalCredits,
}: VoiceoverGenerationParams) {
  try {
    const results: { episodeNumber: number; voiceoverUrl: string; duration: number; shotAudios?: unknown[] }[] = [];

    for (const episode of allEpisodes) {
      try {
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
        console.error(`Failed to generate voiceover for episode ${episode.episodeNumber}:`, err);
      }

      await updateGenerationTaskProgress(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
      });
    }

    const hasGeneratedVoiceover = results.some((result) => result.voiceoverUrl);
    if (!hasGeneratedVoiceover) {
      throw new Error("未生成任何可用配音");
    }

    await requireCreditDeduction(
      userId,
      "voiceover",
      totalCredits,
      dramaId,
      `生成配音 - 共${allEpisodes.length}集`
    );

    await db
      .update(dramas)
      .set({ status: "voiceover_ready", updatedAt: new Date() })
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
