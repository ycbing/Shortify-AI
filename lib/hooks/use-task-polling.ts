"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TaskProgress = {
  completed: number;
  total: number;
  unit: string;
  label: string;
};

type TaskStatus = {
  id: string;
  type: string;
  status: string;
  errorMessage?: string | null;
  progress?: TaskProgress;
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

  const pollOnce = useCallback(async () => {
    if (!taskId) return null;

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

    timerRef.current = window.setTimeout(() => {
      void pollOnce();
    }, intervalMs);

    return nextTask;
  }, [clearPolling, intervalMs, onCompleted, onFailed, taskId]);

  const startPolling = useCallback(async () => {
    if (!taskId) return;
    clearPolling();
    setIsPolling(true);

    try {
      await pollOnce();
    } catch (error) {
      clearPolling();
      setPollError(error instanceof Error ? error.message : "任务轮询失败");
    }
  }, [clearPolling, pollOnce, taskId]);

  useEffect(() => {
    if (!taskId || !autoStart) {
      clearPolling();
      return;
    }

    void startPolling();
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
