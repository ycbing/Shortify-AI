"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================
// Task event types
// ============================================

interface TaskProgress {
  completed: number;
  total: number;
  unit: string;
  label: string;
  episodeCompleted?: number;
  episodeTotal?: number;
}

interface TaskPresentation {
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
}

interface TaskStatus {
  id: string;
  type: string;
  status: string;
  errorMessage?: string | null;
  progress?: TaskProgress;
  outputData?: Record<string, unknown> | null;
  presentation?: TaskPresentation;
}

interface WSTaskEvent {
  type: "task:progress" | "task:completed" | "task:failed" | "task:cancelled" | "task:heartbeat";
  taskId: string;
  dramaId: string;
  payload: {
    stage?: string;
    currentEpisode?: number;
    currentShot?: number;
    completedCount?: number;
    totalCount?: number;
    episodeCount?: number;
    creditsUsed?: number;
    errorMessage?: string;
    outputData?: Record<string, unknown>;
  };
  timestamp: string;
}

// ============================================
// useRealtimeTask - WebSocket with polling fallback
// ============================================

type UseRealtimeTaskOptions = {
  intervalMs?: number;
  autoStart?: boolean;
  onCompleted?: (task: TaskStatus) => void | Promise<void>;
  onFailed?: (task: TaskStatus) => void | Promise<void>;
  onProgress?: (event: WSTaskEvent) => void;
};

export function useRealtimeTask(
  taskId: string | null,
  dramaId: string | null,
  options: UseRealtimeTaskOptions = {}
) {
  const {
    intervalMs = 5000,
    autoStart = true,
    onCompleted,
    onFailed,
    onProgress,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [connectionMode, setConnectionMode] = useState<"ws" | "poll">("poll");
  const [pollError, setPollError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Cleanup all connections
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setIsConnected(false);
    setIsPolling(false);
  }, []);

  // Handle terminal task states
  const handleTerminal = useCallback(
    async (status: string, errorMessage?: string | null) => {
      cleanup();
      if (!mountedRef.current) return;

      const finalTask: TaskStatus = {
        ...(task || { id: taskId || "", type: "", status }),
        status,
        errorMessage,
      };

      setTask(finalTask);

      if (status === "completed") {
        // Fetch fresh task data on completion
        try {
          const res = await fetch(`/api/tasks/${taskId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.task) setTask(data.task);
          }
        } catch {
          // ignore
        }
        await onCompleted?.(finalTask);
      } else if (status === "failed" || status === "cancelled") {
        try {
          const res = await fetch(`/api/tasks/${taskId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.task) setTask(data.task);
          }
        } catch {
          // ignore
        }
        await onFailed?.(finalTask);
      }
    },
    [cleanup, onCompleted, onFailed, task, taskId]
  );

  // Polling fallback
  const startPolling = useCallback(() => {
    if (!taskId || pollTimerRef.current) return;
    setConnectionMode("poll");
    setIsPolling(true);

    const poll = async () => {
      if (!taskId || !mountedRef.current) return;

      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "获取任务状态失败");

        const nextTask = data.task as TaskStatus;
        setTask(nextTask);
        setPollError(null);

        if (nextTask.status === "completed") {
          await handleTerminal("completed");
          return;
        }
        if (nextTask.status === "failed") {
          await handleTerminal("failed", nextTask.errorMessage);
          return;
        }
        if (nextTask.status === "cancelled") {
          await handleTerminal("cancelled", nextTask.errorMessage);
          return;
        }

        pollTimerRef.current = window.setTimeout(poll, intervalMs);
      } catch (error) {
        setPollError(error instanceof Error ? error.message : "任务轮询失败");
        pollTimerRef.current = window.setTimeout(poll, intervalMs);
      }
    };

    void poll();
  }, [taskId, intervalMs, handleTerminal]);

  // WebSocket connection
  const connectWS = useCallback(() => {
    if (!taskId || !dramaId) return;

    // Determine WS URL
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? `localhost:8001`
      : window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws?token=anonymous`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const connectTimeout = window.setTimeout(() => {
        // WS connection took too long, fall back to polling
        console.log("[realtime] WebSocket connection timeout, falling back to polling");
        ws.close();
        wsRef.current = null;
        startPolling();
      }, 3000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        if (!mountedRef.current) return;
        console.log("[realtime] WebSocket connected");
        setIsConnected(true);
        setConnectionMode("ws");
        setPollError(null);

        // Subscribe to drama events
        ws.send(JSON.stringify({ type: "subscribe", dramaId }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "subscribed") {
            return; // subscription confirmed
          }

          if (msg.type === "pong") {
            return;
          }

          // Handle task events
          if (msg.taskId !== taskId) return; // ignore events for other tasks

          switch (msg.type) {
            case "task:progress": {
              onProgress?.(msg as WSTaskEvent);

              // Update task progress display
              setTask((prev) => {
                if (!prev) return prev;
                const p = msg.payload;
                const completedCount = p.completedCount ?? prev.progress?.completed ?? 0;
                const totalCount = p.totalCount ?? p.episodeCount ?? prev.progress?.total ?? 0;

                return {
                  ...prev,
                  progress: {
                    ...prev.progress,
                    unit: prev.progress?.unit ?? "episodes",
                    completed: completedCount,
                    total: totalCount,
                    label: p.stage === "generate"
                      ? `正在生成第 ${p.currentEpisode ?? "?"} / ${totalCount} 集...`
                      : p.stage === "submit"
                      ? `正在提交第 ${p.currentEpisode} 集第 ${p.currentShot} 个镜头...`
                      : p.stage === "waiting"
                      ? `等待第 ${p.currentEpisode} 集第 ${p.currentShot} 个镜头视频生成...`
                      : p.stage === "persist"
                      ? `正在保存第 ${p.currentEpisode} 集第 ${p.currentShot} 个镜头...`
                      : p.stage === "episode-complete"
                      ? `第 ${p.currentEpisode} 集完成 (${completedCount}/${totalCount})`
                      : prev.progress?.label || `处理中 ${completedCount}/${totalCount}`,
                  },
                };
              });
              break;
            }

            case "task:completed": {
              handleTerminal("completed");
              break;
            }

            case "task:failed": {
              handleTerminal("failed", msg.payload.errorMessage);
              break;
            }

            case "task:cancelled": {
              handleTerminal("cancelled", msg.payload.errorMessage);
              break;
            }
          }
        } catch (err) {
          console.warn("[realtime] Invalid WS message:", err);
        }
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        if (!mountedRef.current) return;
        console.log("[realtime] WebSocket closed");
        setIsConnected(false);

        // Reconnect once after a short delay, then fall back to polling
        if (!pollTimerRef.current && !reconnectTimerRef.current) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            if (mountedRef.current && wsRef.current === null && !pollTimerRef.current) {
              startPolling();
            }
          }, 1000);
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        // onerror is always followed by onclose, which handles fallback
      };
    } catch {
      // WebSocket not supported, fall back to polling
      startPolling();
    }
  }, [taskId, dramaId, handleTerminal, onProgress, startPolling]);

  // Start connection
  useEffect(() => {
    mountedRef.current = true;

    if (!taskId || !autoStart) return;

    // Try WebSocket first, fallback to polling
    connectWS();

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [taskId, autoStart, connectWS, cleanup]);

  return {
    task,
    isConnected,
    isPolling,
    connectionMode,
    pollError,
  };
}
