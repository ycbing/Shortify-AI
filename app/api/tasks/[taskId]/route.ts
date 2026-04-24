import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function buildTaskProgress(task: {
  dramaId: string;
  type: string;
  status: string | null;
  inputData: unknown;
}) {
  const inputData = asRecord(task.inputData);

  if (task.type === "script") {
    const total = asNumber(inputData.episodeCount);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(eq(episodes.dramaId, task.dramaId));

    return {
      completed: count,
      total,
      unit: "episodes",
      label: total > 0 ? `已生成 ${count}/${total} 集剧本` : "正在生成剧本",
    };
  }

  if (task.type === "storyboard") {
    const total = asNumber(inputData.episodeCount);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(and(eq(episodes.dramaId, task.dramaId), sql`${episodes.imageUrl} is not null`));

    return {
      completed: count,
      total,
      unit: "episodes",
      label: total > 0 ? `已生成 ${count}/${total} 集分镜` : "正在生成分镜",
    };
  }

  if (task.type === "voiceover") {
    const total = asNumber(inputData.episodeCount);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(and(eq(episodes.dramaId, task.dramaId), sql`${episodes.voiceoverUrl} is not null`));

    return {
      completed: count,
      total,
      unit: "episodes",
      label: total > 0 ? `已生成 ${count}/${total} 集配音` : "正在生成配音",
    };
  }

  if (task.type === "compose") {
    const total = asNumber(inputData.episodeCount);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(and(eq(episodes.dramaId, task.dramaId), sql`${episodes.videoUrl} is not null`));

    return {
      completed: count,
      total,
      unit: "episodes",
      label: total > 0 ? `已合成 ${count}/${total} 集视频` : "正在合成视频",
    };
  }

  if (task.type === "video") {
    const totalEpisodes = asNumber(inputData.episodeCount);
    const totalShots = asNumber(inputData.shotCount);
    const dramaEpisodes = await db
      .select({
        videoUrl: episodes.videoUrl,
        shotData: episodes.shotData,
      })
      .from(episodes)
      .where(eq(episodes.dramaId, task.dramaId));

    let completedShots = 0;
    let completedEpisodes = 0;

    for (const episode of dramaEpisodes) {
      const shots = Array.isArray(episode.shotData) ? episode.shotData : [];
      completedShots += shots.filter(
        (shot) =>
          shot &&
          typeof shot === "object" &&
          "aiVideoUrl" in shot &&
          typeof (shot as { aiVideoUrl?: unknown }).aiVideoUrl === "string" &&
          Boolean((shot as { aiVideoUrl?: string }).aiVideoUrl)
      ).length;

      if (episode.videoUrl) {
        completedEpisodes += 1;
      }
    }

    return {
      completed: completedShots,
      total: totalShots,
      unit: "shots",
      episodeCompleted: completedEpisodes,
      episodeTotal: totalEpisodes,
      label:
        totalShots > 0
          ? `已生成 ${completedShots}/${totalShots} 个镜头视频`
          : "正在生成 AI 视频",
    };
  }

  return {
    completed: task.status === "completed" ? 1 : 0,
    total: 1,
    unit: "tasks",
    label: task.status === "completed" ? "任务已完成" : "任务处理中",
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { taskId } = await params;

    const [task] = await db
      .select({
        id: generationTasks.id,
        dramaId: generationTasks.dramaId,
        episodeId: generationTasks.episodeId,
        type: generationTasks.type,
        status: generationTasks.status,
        inputData: generationTasks.inputData,
        outputData: generationTasks.outputData,
        errorMessage: generationTasks.errorMessage,
        startedAt: generationTasks.startedAt,
        completedAt: generationTasks.completedAt,
      })
      .from(generationTasks)
      .innerJoin(dramas, eq(dramas.id, generationTasks.dramaId))
      .where(and(eq(generationTasks.id, taskId), eq(dramas.userId, session.user.id)))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const progress = await buildTaskProgress(task);

    return NextResponse.json({
      task: {
        ...task,
        progress,
      },
    });
  } catch (error) {
    console.error("Failed to fetch task:", error);
    return NextResponse.json({ error: "获取任务详情失败" }, { status: 500 });
  }
}
