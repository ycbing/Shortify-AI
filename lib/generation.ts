import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, generationTasks } from "@/lib/db/schema";
import { inferDramaStatus, updateDramaStatus } from "@/lib/drama-status";
import { taskEventBus, type TaskEvent } from "@/lib/task-event-bus";
import { createLogger } from "@/lib/logger";

const log = createLogger("generation");

const GENERATION_TASK_HEARTBEAT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (was 15)

type TaskDataRecord = Record<string, unknown>;

export class GenerationTaskCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "GenerationTaskCancelledError";
  }
}

function asTaskDataRecord(value: unknown): TaskDataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as TaskDataRecord;
}

function getHeartbeatDate(outputData: unknown, startedAt: Date | null) {
  const record = asTaskDataRecord(outputData);
  const heartbeatAt =
    typeof record.heartbeatAt === "string" ? new Date(record.heartbeatAt) : null;

  if (heartbeatAt && !Number.isNaN(heartbeatAt.getTime())) {
    return heartbeatAt;
  }

  return startedAt;
}

async function restoreDramaStatusForTask(taskId: string, dramaId: string) {
  const [task] = await db
    .select({ inputData: generationTasks.inputData })
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId))
    .limit(1);

  const inputData = asTaskDataRecord(task?.inputData);
  const previousDramaStatus =
    typeof inputData.previousDramaStatus === "string"
      ? inputData.previousDramaStatus
      : null;

  const inferredStatus = await inferDramaStatus(dramaId);
  const nextDramaStatus =
    previousDramaStatus &&
    previousDramaStatus !== "generating" &&
    previousDramaStatus !== "error"
      ? previousDramaStatus
      : inferredStatus;

  await updateDramaStatus(dramaId, nextDramaStatus);
}

export async function expireGenerationTask(
  taskId: string,
  dramaId: string,
  errorMessage = "任务已超时失效，请重新发起生成"
) {
  log.error(`Task expired`, { taskId, dramaId });
  await db
    .update(generationTasks)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(generationTasks.id, taskId));

  await restoreDramaStatusForTask(taskId, dramaId);
}

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

  if (!task) {
    return null;
  }

  const heartbeatDate = getHeartbeatDate(task.outputData, task.startedAt ?? null);
  const isStale =
    !heartbeatDate || Date.now() - heartbeatDate.getTime() > GENERATION_TASK_HEARTBEAT_TIMEOUT_MS;

  if (isStale) {
    await expireGenerationTask(task.id, dramaId);
    return null;
  }

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
  const current = await getGenerationTaskOutput(taskId);
  await db
    .update(generationTasks)
    .set({
      status: "completed",
      outputData: {
        ...current,
        ...outputData,
        heartbeatAt: new Date().toISOString(),
      },
      completedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(generationTasks.id, taskId));

  // Emit completion event
  const task = await db
    .select({ dramaId: generationTasks.dramaId })
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId))
    .limit(1);
  if (task[0]) {
    taskEventBus.emit({
      type: "task:completed",
      taskId,
      dramaId: task[0].dramaId,
      payload: { ...outputData },
      timestamp: new Date().toISOString(),
    });
  }
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
    outputData: {
      heartbeatAt: new Date().toISOString(),
    },
    startedAt: new Date(),
  });

  await updateDramaStatus(dramaId, processingDramaStatus);

  return {
    taskId,
    reused: false,
  };
}

async function getGenerationTaskOutput(taskId: string) {
  const [task] = await db
    .select({ outputData: generationTasks.outputData })
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId))
    .limit(1);

  return asTaskDataRecord(task?.outputData);
}

export async function touchGenerationTaskHeartbeat(
  taskId: string,
  outputPatch: Record<string, unknown> = {}
) {
  const current = await getGenerationTaskOutput(taskId);

  await db
    .update(generationTasks)
    .set({
      outputData: {
        ...current,
        ...outputPatch,
        heartbeatAt: new Date().toISOString(),
      },
      errorMessage: null,
    })
    .where(eq(generationTasks.id, taskId));
}

export async function updateGenerationTaskProgress(
  taskId: string,
  outputData: Record<string, unknown>
) {
  await touchGenerationTaskHeartbeat(taskId, outputData);

  // Emit real-time progress event
  const task = await db
    .select({ dramaId: generationTasks.dramaId })
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId))
    .limit(1);
  if (task[0]) {
    taskEventBus.emitProgress(taskId, task[0].dramaId, outputData);
  }
}

export async function failGenerationTask(
  taskId: string,
  dramaId: string,
  errorMessage: string
) {
  log.error(`Task failed`, { taskId, dramaId, errorMessage });
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

  // Emit failure event
  taskEventBus.emit({
    type: "task:failed",
    taskId,
    dramaId,
    payload: { errorMessage },
    timestamp: new Date().toISOString(),
  });
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

  await restoreDramaStatusForTask(taskId, dramaId);
}

export async function throwIfGenerationTaskCancelled(taskId: string) {
  if (await isGenerationTaskCancelled(taskId)) {
    throw new GenerationTaskCancelledError();
  }
}
