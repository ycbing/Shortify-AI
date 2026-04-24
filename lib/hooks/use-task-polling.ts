"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TaskProgress = {
  completed: number;
  total: number;
  unit: string;
  label: string;
};

type TaskPresentation = {
  typeLabel: string;
  statusLabel: string;
  statusTone: "neutral" | "warning" | "success" | "danger";
  stageLabel: string | null;
  summary: string;
  retryable: boolean;
  failureCode: string | null;
  failureTitle: string | null;
  failureHint: string | null;
  durationMs: number | null;
  creditsUsed: number;
};

type TaskStatus = {
  id: string;
  type: string;
  status: string;
  errorMessage?: string | null;
  progress?: TaskProgress;
  outputData?: Record<string, unknown> | null;
  presentation?: TaskPresentation;
};

type UseTaskPollingOptions = {
  intervalMs?: number;
  autoStart?: boolean;
  onCompleted?: (task: TaskStatus) => void | Promise<void>;
  onFailed?: (task: TaskStatus) => void | Promise<void>;
};

export function useTaskPolling(taskId: string | null, options: UseTaskPollingOptions = {}) {
  const {
    intervalMs = 5000,
    autoStart = true,
    onCompleted,
    onFailed,
  } = options;
  const timerRef = useRef<number | null>(null);
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const clearPolling = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(async () => {
    if (!taskId) return;
    clearPolling();
    setIsPolling(true);

    try {
      const poll = async (): Promise<TaskStatus | null> => {
        const res = await fetch(`/api/tasks/${taskId}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "获取任务状态失败");
        }

        const nextTask = data.task as TaskStatus;
        setTask(nextTask);
        setPollError(null);

        if (nextTask.status === "completed") {
          clearPolling();
          await onCompleted?.(nextTask);
          return nextTask;
        }

        if (nextTask.status === "failed") {
          clearPolling();
          await onFailed?.(nextTask);
          return nextTask;
        }

        if (nextTask.status === "cancelled") {
          clearPolling();
          await onFailed?.({
            ...nextTask,
            errorMessage: nextTask.errorMessage || "任务已取消",
          });
          return nextTask;
        }

        timerRef.current = window.setTimeout(() => {
          void poll();
        }, intervalMs);

        return nextTask;
      };

      await poll();
    } catch (error) {
      clearPolling();
      setPollError(error instanceof Error ? error.message : "任务轮询失败");
    }
  }, [clearPolling, intervalMs, onCompleted, onFailed, taskId]);

  useEffect(() => {
    if (!taskId || !autoStart) {
      return;
    }

    queueMicrotask(() => {
      void startPolling();
    });
    return clearPolling;
  }, [autoStart, clearPolling, startPolling, taskId]);

  return {
    task,
    isPolling,
    pollError,
    startPolling,
    stopPolling: clearPolling,
  };
}
