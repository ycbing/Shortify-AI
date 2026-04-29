// ============================================
// Shortify AI - Task Event Bus (in-process pub/sub)
// ============================================
// Lightweight event emitter for broadcasting task progress updates
// to WebSocket connections. No Redis dependency needed for single-server.

type EventCallback = (data: TaskEvent) => void;

export interface TaskEvent {
  type: "task:progress" | "task:completed" | "task:failed" | "task:cancelled" | "task:heartbeat";
  taskId: string;
  dramaId: string;
  payload: {
    stage?: string;
    currentEpisode?: number;
    currentShot?: number;
    completedCount?: number;
    totalCount?: number;
    creditsUsed?: number;
    errorMessage?: string;
    outputData?: Record<string, unknown>;
  };
  timestamp: string;
}

class TaskEventBus {
  private listeners = new Map<string, Set<EventCallback>>();
  private globalListeners = new Set<EventCallback>();

  /**
   * Subscribe to events for a specific drama.
   */
  on(dramaId: string, callback: EventCallback): () => void {
    if (!this.listeners.has(dramaId)) {
      this.listeners.set(dramaId, new Set());
    }
    this.listeners.get(dramaId)!.add(callback);

    return () => {
      this.listeners.get(dramaId)?.delete(callback);
    };
  }

  /**
   * Subscribe to all task events (for debugging/monitoring).
   */
  onAny(callback: EventCallback): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * Emit an event to all subscribers for a drama.
   */
  emit(event: TaskEvent): void {
    // Notify drama-specific listeners
    const dramaListeners = this.listeners.get(event.dramaId);
    if (dramaListeners) {
      for (const cb of dramaListeners) {
        try {
          cb(event);
        } catch (err) {
          console.error("[event-bus] Listener error:", err);
        }
      }
    }

    // Notify global listeners
    for (const cb of this.globalListeners) {
      try {
        cb(event);
      } catch (err) {
        console.error("[event-bus] Global listener error:", err);
      }
    }
  }

  /**
   * Emit a heartbeat update (called by generation tasks).
   */
  emitProgress(
    taskId: string,
    dramaId: string,
    payload: TaskEvent["payload"]
  ): void {
    this.emit({
      type: "task:progress",
      taskId,
      dramaId,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get subscriber count for a drama.
   */
  subscriberCount(dramaId: string): number {
    return this.listeners.get(dramaId)?.size || 0;
  }
}

// Singleton instance
export const taskEventBus = new TaskEventBus();
