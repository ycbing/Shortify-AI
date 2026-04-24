import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { buildTaskPresentation } from "@/lib/task-presentation";

type JsonRecord = Record<string, unknown>;

export type TaskListFilters = {
  dramaId?: string;
  type?: string;
  status?: string;
  latest?: boolean;
  limit?: number;
};

export type TaskProgress = {
  completed: number;
  total: number;
  unit: string;
  label: string;
  episodeCompleted?: number;
  episodeTotal?: number;
};

export type TaskListItem = Awaited<ReturnType<typeof listTasksForUser>>[number];
export type TaskDetail = Awaited<ReturnType<typeof getTaskWithProgressForUser>>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function listTasksForUser(userId: string, filters: TaskListFilters = {}) {
  const conditions = [eq(dramas.userId, userId)];
  if (filters.dramaId) conditions.push(eq(generationTasks.dramaId, filters.dramaId));
  if (filters.type) conditions.push(eq(generationTasks.type, filters.type));
  if (filters.status) conditions.push(eq(generationTasks.status, filters.status));

  const rows = await db
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
    .where(and(...conditions))
    .orderBy(desc(generationTasks.startedAt));

  const limitedRows = filters.latest
    ? rows.slice(0, 1)
    : filters.limit && filters.limit > 0
      ? rows.slice(0, filters.limit)
      : rows;

  return limitedRows.map((task) => ({
    ...task,
    presentation: buildTaskPresentation(task),
  }));
}

export async function getTaskForUser(taskId: string, userId: string) {
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
    .where(and(eq(generationTasks.id, taskId), eq(dramas.userId, userId)))
    .limit(1);

  return task;
}

export async function getTaskWithProgressForUser(taskId: string, userId: string) {
  const task = await getTaskForUser(taskId, userId);

  if (!task) {
    return null;
  }

  const progress = await buildTaskProgress(task);

  return {
    ...task,
    progress,
    presentation: buildTaskPresentation(task, progress),
  };
}

export async function buildTaskProgress(task: {
  dramaId: string;
  type: string;
  status: string | null;
  inputData: unknown;
  outputData?: unknown;
}): Promise<TaskProgress> {
  const inputData = asRecord(task.inputData);
  const outputData = asRecord(task.outputData);

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
    const trackedCompleted = asNumber(outputData.completedCount);
    if (trackedCompleted > 0 || task.status === "completed") {
      const completed = task.status === "completed"
        ? (trackedCompleted || total)
        : trackedCompleted;

      return {
        completed,
        total,
        unit: "episodes",
        label: total > 0 ? `已生成 ${completed}/${total} 集分镜` : "正在生成分镜",
      };
    }

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
    const trackedCompleted = asNumber(outputData.completedCount);
    if (trackedCompleted > 0 || task.status === "completed") {
      const completed = task.status === "completed"
        ? (trackedCompleted || total)
        : trackedCompleted;

      return {
        completed,
        total,
        unit: "episodes",
        label: total > 0 ? `已生成 ${completed}/${total} 集配音` : "正在生成配音",
      };
    }

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
    const trackedCompleted = asNumber(outputData.completedCount);
    if (trackedCompleted > 0 || task.status === "completed") {
      const completed = task.status === "completed"
        ? (trackedCompleted || total)
        : trackedCompleted;

      return {
        completed,
        total,
        unit: "episodes",
        label: total > 0 ? `已合成 ${completed}/${total} 集视频` : "正在合成视频",
      };
    }

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
