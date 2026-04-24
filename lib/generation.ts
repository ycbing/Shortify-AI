import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, generationTasks } from "@/lib/db/schema";
import { inferDramaStatus, updateDramaStatus } from "@/lib/drama-status";

export async function getActiveGenerationTask(
  dramaId: string,
  type: string
) {
  const [task] = await db
    .select()
    .from(generationTasks)
    .where(
      and(
        eq(generationTasks.dramaId, dramaId),
        eq(generationTasks.type, type),
        eq(generationTasks.status, "processing")
      )
    )
    .orderBy(desc(generationTasks.startedAt))
    .limit(1);

  return task;
}

export async function isGenerationTaskCancelled(taskId: string) {
  const [task] = await db
    .select({ status: generationTasks.status })
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId))
    .limit(1);

  return task?.status === "cancelled";
}

export async function completeGenerationTask(
  taskId: string,
  outputData?: Record<string, unknown>
) {
  await db
    .update(generationTasks)
    .set({
      status: "completed",
      outputData,
      completedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(generationTasks.id, taskId));
}

type CreateGenerationTaskParams = {
  dramaId: string;
  type: string;
  inputData?: Record<string, unknown>;
  processingDramaStatus?: string;
};

export async function createOrReuseGenerationTask({
  dramaId,
  type,
  inputData = {},
  processingDramaStatus = "generating",
}: CreateGenerationTaskParams) {
  const activeTask = await getActiveGenerationTask(dramaId, type);
  if (activeTask) {
    return {
      taskId: activeTask.id,
      reused: true,
    };
  }

  const [drama] = await db
    .select({ status: dramas.status })
    .from(dramas)
    .where(eq(dramas.id, dramaId))
    .limit(1);

  const taskId = randomUUID();
  await db.insert(generationTasks).values({
    id: taskId,
    dramaId,
    type,
    status: "processing",
    inputData: {
      ...inputData,
      previousDramaStatus: drama?.status || null,
    },
    startedAt: new Date(),
  });

  await updateDramaStatus(dramaId, processingDramaStatus);

  return {
    taskId,
    reused: false,
  };
}

export async function updateGenerationTaskProgress(
  taskId: string,
  outputData: Record<string, unknown>
) {
  await db
    .update(generationTasks)
    .set({
      outputData,
      errorMessage: null,
    })
    .where(eq(generationTasks.id, taskId));
}

export async function failGenerationTask(
  taskId: string,
  dramaId: string,
  errorMessage: string
) {
  await db
    .update(generationTasks)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(generationTasks.id, taskId));

  await db
    .update(dramas)
    .set({
      status: "error",
      updatedAt: new Date(),
    })
    .where(eq(dramas.id, dramaId));
}

export async function cancelGenerationTask(
  taskId: string,
  dramaId: string,
  errorMessage = "任务已取消"
) {
  const [task] = await db
    .select({ inputData: generationTasks.inputData })
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId))
    .limit(1);

  const previousDramaStatus =
    task?.inputData &&
    typeof task.inputData === "object" &&
    !Array.isArray(task.inputData) &&
    "previousDramaStatus" in task.inputData &&
    typeof (task.inputData as Record<string, unknown>).previousDramaStatus === "string"
      ? ((task.inputData as Record<string, unknown>).previousDramaStatus as string)
      : null;

  const inferredStatus = await inferDramaStatus(dramaId);
  const nextDramaStatus =
    previousDramaStatus && previousDramaStatus !== "generating" && previousDramaStatus !== "error"
      ? previousDramaStatus
      : inferredStatus;

  await db
    .update(generationTasks)
    .set({
      status: "cancelled",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(generationTasks.id, taskId));

  await updateDramaStatus(dramaId, nextDramaStatus);
}
