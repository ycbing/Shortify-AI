import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, generationTasks } from "@/lib/db/schema";

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
