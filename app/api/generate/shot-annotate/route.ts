import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getOwnedDrama } from "@/lib/dramas";
import { annotateShots, type AnnotateMode } from "@/lib/ai/shot-annotator";
import { GENRE_MAP } from "@/lib/ai/script-generator";
import {
  completeGenerationTask,
  createOrReuseGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  touchGenerationTaskHeartbeat,
  GenerationTaskCancelledError,
  throwIfGenerationTaskCancelled,
} from "@/lib/generation";
import type { Shot } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("shot-annotate-api");

/**
 * POST /api/generate/shot-annotate
 * 分镜编辑器 v2：LLM 为镜头批量补齐 emotion / sfx
 * - 单集（episodeId）：同步返回
 * - 全剧：后台任务，返回 taskId 供轮询
 * - mode=fill（默认）只补缺失，mode=overwrite 全部重标
 */
export async function POST(request: NextRequest) {
  let taskId: string | null = null;
  let dramaId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    dramaId = body?.dramaId;
    const episodeId: string | undefined = body?.episodeId;
    const mode: AnnotateMode = body?.mode === "overwrite" ? "overwrite" : "fill";

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }
    const genreLabel = drama.genre ? GENRE_MAP[drama.genre as keyof typeof GENRE_MAP] : null;

    // ---- 单集：同步 ----
    if (episodeId) {
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);
      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }
      const shots: Shot[] = Array.isArray(episode.shotData) ? episode.shotData : [];
      if (shots.length === 0) {
        return NextResponse.json({ error: "该集无分镜数据" }, { status: 400 });
      }

      const annotated = await annotateShots(shots, { mode, genre: genreLabel });
      await db
        .update(episodes)
        .set({ shotData: annotated as never })
        .where(eq(episodes.id, episodeId));

      return NextResponse.json({ episodeId, shots: annotated });
    }

    // ---- 全剧：后台任务 ----
    const activeTask = await getActiveGenerationTask(dramaId, "shot-annotate");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有标注任务正在进行，已为你恢复到当前任务",
      });
    }

    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "shot-annotate",
      // 标注不改变短剧状态（保持 completed 等原状态）
      processingDramaStatus: drama.status || "generating",
      inputData: { mode },
    });
    taskId = taskResult.taskId;

    processAnnotation({
      taskId,
      dramaId,
      mode,
      genreLabel,
    }).catch((err) =>
      log.error("Background annotation failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    );

    return NextResponse.json({
      taskId,
      message: "正在为全部剧集标注情绪与音效，请稍候...",
    });
  } catch (error) {
    log.error("Shot annotation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `标注失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

async function processAnnotation({
  taskId,
  dramaId,
  mode,
  genreLabel,
}: {
  taskId: string;
  dramaId: string;
  mode: AnnotateMode;
  genreLabel: string | null;
}) {
  try {
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    const targets = allEpisodes.filter(
      (ep) => Array.isArray(ep.shotData) && (ep.shotData as Shot[]).length > 0
    );
    if (targets.length === 0) {
      throw new Error("无分镜数据可标注");
    }

    let done = 0;
    for (const episode of targets) {
      await throwIfGenerationTaskCancelled(taskId);
      await touchGenerationTaskHeartbeat(taskId, {
        currentEpisode: episode.episodeNumber,
        stage: "annotate",
        completedCount: done,
        episodeCount: targets.length,
      });

      try {
        const shots: Shot[] = episode.shotData as Shot[];
        const annotated = await annotateShots(shots, { mode, genre: genreLabel });
        await throwIfGenerationTaskCancelled(taskId);
        await db
          .update(episodes)
          .set({ shotData: annotated as never })
          .where(eq(episodes.id, episode.id));
      } catch (err) {
        if (err instanceof GenerationTaskCancelledError) throw err;
        log.warn(`Annotate episode ${episode.episodeNumber} failed, continuing`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      done++;
      await touchGenerationTaskHeartbeat(taskId, {
        currentEpisode: episode.episodeNumber,
        stage: "annotate",
        completedCount: done,
        episodeCount: targets.length,
      });
    }

    await completeGenerationTask(taskId, {
      completedCount: done,
      episodeCount: targets.length,
      mode,
    });
  } catch (error) {
    if (error instanceof GenerationTaskCancelledError) return;
    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
