// Kling AI 开放平台客户端 — JWT 鉴权 + 对口型（lip-sync）任务
// 文档: https://klingai.com/document-api/api/video/lip-sync
// 鉴权: HS256 JWT（iss=accessKey, exp=now+30min, nbf=now-5s），Bearer 头
import crypto from "crypto";
import { withRetry } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";

const log = createLogger("kling-client");

const KLING_BASE_URL = process.env.KLING_BASE_URL || "https://api.klingai.com";
const LIPSYNC_MODEL = process.env.KLING_LIPSYNC_MODEL || "v1";

export function isKlingConfigured(): boolean {
  return Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

/** 对口型总开关：配置了 Kling 密钥且显式开启（消耗可灵算力，默认关闭） */
export function isLipSyncEnabled(): boolean {
  const flag = (process.env.KLING_LIPSYNC || "").toLowerCase();
  return isKlingConfigured() && (flag === "true" || flag === "on" || flag === "1");
}

function signKlingJwt(): string {
  const accessKey = process.env.KLING_ACCESS_KEY!;
  const secretKey = process.env.KLING_SECRET_KEY!;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const signature = crypto.createHmac("sha256", secretKey).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

interface KlingTaskResponse {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string; // submitted | processing | succeed | failed
    task_status_msg?: string;
    task_result?: {
      videos?: { id?: string; url?: string; duration?: number }[];
    };
  };
}

/** 通用带鉴权请求 */
async function klingFetch<T extends KlingTaskResponse>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = signKlingJwt();
  const response = await fetch(`${KLING_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kling API error: ${response.status} - ${error.substring(0, 200)}`);
  }
  const result = (await response.json()) as T;
  if (typeof result.code === "number" && result.code !== 0) {
    throw new Error(`Kling API code ${result.code}: ${result.message || "unknown"}`);
  }
  return result;
}

/**
 * 提交对口型任务，返回 task_id
 * @param videoUrl 公网可访问的视频 URL
 * @param audioUrl 公网可访问的音频 URL（驱动口型）
 */
export async function submitLipSync(
  videoUrl: string,
  audioUrl: string
): Promise<string> {
  const result = await klingFetch("/v1/videos/lip-sync", {
    method: "POST",
    body: JSON.stringify({
      model_name: LIPSYNC_MODEL,
      input: { video_url: videoUrl, audio_url: audioUrl },
    }),
  });
  const taskId = result.data?.task_id;
  if (!taskId) {
    throw new Error(`Kling lip-sync: no task_id: ${JSON.stringify(result).substring(0, 200)}`);
  }
  log.info("Lip-sync submitted", { taskId });
  return taskId;
}

export interface LipSyncTaskStatus {
  status: string;
  videoUrl?: string;
  failMsg?: string;
}

export async function getLipSyncTask(taskId: string): Promise<LipSyncTaskStatus> {
  const result = await klingFetch<KlingTaskResponse>(`/v1/videos/lip-sync/${taskId}`);
  const status = result.data?.task_status || "processing";
  if (status === "succeed") {
    const videoUrl = result.data?.task_result?.videos?.[0]?.url;
    if (!videoUrl) {
      return { status: "failed", failMsg: "task succeeded but no video url" };
    }
    return { status, videoUrl };
  }
  if (status === "failed") {
    return { status, failMsg: result.data?.task_status_msg || "lip-sync failed" };
  }
  return { status };
}

/** 轮询等待对口型完成，返回结果视频 URL */
export async function waitForLipSync(
  taskId: string,
  options?: { pollMs?: number; maxWaitMs?: number }
): Promise<string> {
  const pollMs = options?.pollMs || 5000;
  const maxWaitMs = options?.maxWaitMs || 600000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const { status, videoUrl, failMsg } = await getLipSyncTask(taskId);
    if (status === "succeed" && videoUrl) return videoUrl;
    if (status === "failed") throw new Error(`Kling lip-sync failed: ${failMsg}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Kling lip-sync timed out after ${Math.round(maxWaitMs / 1000)}s`);
}

/** 带重试的任务提交（限流时退避） */
export async function submitLipSyncWithRetry(
  videoUrl: string,
  audioUrl: string
): Promise<string> {
  return withRetry(() => submitLipSync(videoUrl, audioUrl), {
    maxRetries: 2,
    baseDelayMs: 5000,
    onRetry: (attempt, err, delayMs) => {
      log.warn(`Lip-sync submit retry ${attempt} after ${Math.round(delayMs)}ms`, {
        error: err.message,
      });
    },
  });
}
