"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface TaskPresentation {
  typeLabel: string;
  statusLabel: string;
  summary: string;
  statusTone: "neutral" | "warning" | "success" | "danger";
}

interface GeneratingProgressBadgeProps {
  dramaId: string;
}

export function GeneratingProgressBadge({ dramaId }: GeneratingProgressBadgeProps) {
  const [task, setTask] = useState<TaskPresentation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dramaId) return;

    let cancelled = false;

    const fetchTask = async () => {
      try {
        const res = await fetch(
          `/api/tasks?dramaId=${dramaId}&status=processing&latest=1`
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.tasks && data.tasks.length > 0) {
            setTask(data.tasks[0].presentation || null);
          }
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchTask();

    // Poll every 10s for progress updates
    const interval = setInterval(fetchTask, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dramaId]);

  if (loading) return null;
  if (!task) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      <span>{task.summary}</span>
    </div>
  );
}
