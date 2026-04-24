type JsonRecord = Record<string, unknown>;

type TaskLike = {
  type: string;
  status: string | null;
  errorMessage?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  outputData?: unknown;
};

type TaskProgressLike = {
  completed: number;
  total: number;
  unit: string;
  label: string;
};

export type TaskPresentation = {
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

const TASK_TYPE_LABELS: Record<string, string> = {
  script: "剧本",
  storyboard: "分镜",
  voiceover: "配音",
  compose: "合成",
  subtitle: "字幕",
  video: "AI 视频",
};

const TASK_STATUS_META: Record<string, { label: string; tone: TaskPresentation["statusTone"] }> = {
  pending: { label: "排队中", tone: "warning" },
  processing: { label: "进行中", tone: "warning" },
  completed: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStageLabel(type: string, outputData: unknown) {
  const record = asRecord(outputData);
  const stage = typeof record.stage === "string" ? record.stage : null;

  if (!stage) return null;

  if (type === "video") {
    if (stage === "submit") return "正在提交镜头任务";
    if (stage === "waiting") return "等待 AI 视频结果";
    if (stage === "persist") return "保存镜头视频";
    if (stage === "episode-complete") return "整理分集结果";
  }

  if (type === "compose") {
    if (stage === "subtitles") return "生成字幕";
    if (stage === "compose") return "合成分集视频";
    if (stage === "merge") return "拼接整剧成片";
  }

  if (stage === "generate") {
    return type === "storyboard"
      ? "生成分镜"
      : type === "voiceover"
        ? "生成配音"
        : "处理中";
  }

  return null;
}

function classifyFailure(errorMessage: string | null | undefined, status: string | null) {
  if (status === "cancelled") {
    return {
      code: "cancelled",
      title: "任务已取消",
      hint: "可以在准备好后重新发起任务。",
      retryable: true,
    };
  }

  const message = errorMessage || "";

  if (!message) {
    return {
      code: null,
      title: null,
      hint: null,
      retryable: status !== "completed",
    };
  }

  if (message.includes("积分不足")) {
    return {
      code: "insufficient_credits",
      title: "积分不足",
      hint: "补充积分后可以重新发起任务。",
      retryable: true,
    };
  }

  if (message.includes("超时") || message.includes("timeout")) {
    return {
      code: "timeout",
      title: "任务超时",
      hint: "上游服务响应过慢，建议稍后重试。",
      retryable: true,
    };
  }

  if (message.includes("未生成任何")) {
    return {
      code: "empty_output",
      title: "没有产出可用结果",
      hint: "可以检查输入素材是否完整，再重新生成。",
      retryable: true,
    };
  }

  if (message.includes("不存在") || message.includes("没有找到")) {
    return {
      code: "not_found",
      title: "依赖资源缺失",
      hint: "请确认短剧、剧集或素材仍然存在。",
      retryable: false,
    };
  }

  return {
    code: "unknown",
    title: "任务执行失败",
    hint: "建议稍后重试；如果持续失败，再检查素材或模型配置。",
    retryable: true,
  };
}

export function buildTaskPresentation(
  task: TaskLike,
  progress?: TaskProgressLike | null
): TaskPresentation {
  const typeLabel = TASK_TYPE_LABELS[task.type] || task.type;
  const statusMeta = TASK_STATUS_META[task.status || "processing"] || TASK_STATUS_META.processing;
  const outputData = asRecord(task.outputData);
  const stageLabel = getStageLabel(task.type, outputData);
  const failure = classifyFailure(task.errorMessage, task.status);
  const startedAt = toDate(task.startedAt);
  const completedAt = toDate(task.completedAt);
  const durationMs =
    startedAt && completedAt
      ? Math.max(0, completedAt.getTime() - startedAt.getTime())
      : startedAt && task.status === "processing"
        ? Math.max(0, Date.now() - startedAt.getTime())
        : null;
  const creditsUsed = asNumber(outputData.creditsUsed);

  const summary = progress?.label
    || (stageLabel ? `${typeLabel}${statusMeta.label}，${stageLabel}` : `${typeLabel}${statusMeta.label}`);

  return {
    typeLabel,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    stageLabel,
    summary,
    retryable: failure.retryable,
    failureCode: failure.code,
    failureTitle: failure.title,
    failureHint: failure.hint,
    durationMs,
    creditsUsed,
  };
}
