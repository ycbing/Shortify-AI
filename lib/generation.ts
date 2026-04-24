import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, generationTasks } from "@/lib/db/schema";

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
  await db
    .update(generationTasks)
    .set({
      status: "cancelled",
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
