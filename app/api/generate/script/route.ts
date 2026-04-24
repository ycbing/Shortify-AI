import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateScript, extractNarrationFromShots } from "@/lib/ai/script-generator";
import { isScriptV2 } from "@/types/drama";
import type { DramaGenreType, DramaStyleType, GeneratedScriptV2 } from "@/types/drama";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction } from "@/lib/credits";
import { getOwnedDrama } from "@/lib/dramas";
import {
  completeGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  isGenerationTaskCancelled,
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

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    // Get drama
    const drama = await getOwnedDrama(dramaId, session.user.id);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const activeTask = await getActiveGenerationTask(dramaId, "script");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有剧本任务正在进行，已为你恢复到当前任务",
      });
    }

    const creditCheck = await checkCredits(session.user.id, CREDIT_COSTS.script);
    if (!creditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，需要 ${CREDIT_COSTS.script} 积分，当前余额 ${creditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    // Create generation task
    taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "script",
      status: "processing",
      inputData: {
        theme: drama.theme,
        genre: drama.genre,
        style: drama.style,
        episodeCount: drama.episodeCount,
      },
      startedAt: new Date(),
    });

    // Generate script (always V2 now)
    const script = await generateScript(
      drama.theme || "都市情感",
      (drama.genre as DramaGenreType) || "romance",
      (drama.style as DramaStyleType) || "realistic",
      drama.episodeCount || 3
    );

    if (await isGenerationTaskCancelled(taskId)) {
      return NextResponse.json({
        taskId,
        message: "剧本任务已取消",
      });
    }

    // Deduct credits after successful generation
    await requireCreditDeduction(session.user.id, "script", undefined, dramaId);

    // Update drama title and characters (V2)
    const updateData: Record<string, unknown> = {
      title: script.title,
      status: "script_ready",
      updatedAt: new Date(),
    };

    if (isScriptV2(script)) {
      updateData.characters = script.characters;
    }

    await db
      .update(dramas)
      .set(updateData)
      .where(eq(dramas.id, dramaId));

    // Create episodes (V2 format)
    for (const ep of script.episodes) {
      const v2Ep = ep as GeneratedScriptV2["episodes"][number];
      const narrationText = extractNarrationFromShots(v2Ep.shots);

      await db.insert(episodes).values({
        id: uuidv4(),
        dramaId,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        scriptContent: JSON.stringify({
          sceneDescription: v2Ep.sceneDescription,
          shots: v2Ep.shots,
        }),
        narrationText,
        shotData: v2Ep.shots,
        duration: v2Ep.shots.reduce((sum, s) => sum + (s.duration || 5), 0),
      });
    }

    // Complete task
    await completeGenerationTask(taskId, script as unknown as Record<string, unknown>);

    return NextResponse.json({ taskId, script });
  } catch (error) {
    console.error("Script generation failed:", error);
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `剧本生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
