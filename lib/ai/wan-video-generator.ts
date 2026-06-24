import { createLogger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";

const log = createLogger("wan-video-generator");

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_SUBMIT_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";
const DASHSCOPE_TASK_URL = (taskId: string) =>
  `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;

const DEFAULT_MODEL = process.env.WAN_VIDEO_MODEL || "wan2.7-i2v";
const DEFAULT_RESOLUTION = process.env.WAN_VIDEO_RESOLUTION || "720P";
const DEFAULT_DURATION = Number(process.env.WAN_VIDEO_DURATION) || 5;

// ── Types ──────────────────────────────────────────────────────

interface WanSubmitOutput {
  task_id: string;
  task_status: string;
}

interface WanSubmitResponse {
  request_id: string;
  output: WanSubmitOutput;
}

interface WanTaskOutput {
  task_id: string;
  task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  video_url?: string;
  message?: string;
}

interface WanTaskResponse {
  request_id: string;
  output: WanTaskOutput;
}

export interface WanVideoOptions {
  resolution?: string;
  duration?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

// ── Submit ─────────────────────────────────────────────────────

/**
 * 提交 Wan2.7 视频生成异步任务
 * 自动识别模型类型：
 * - 含 imageUrl + 模型名含 "i2v" → i2v 模式（图生视频）
 * - 无 imageUrl 或模型名含 "t2v" → t2v 模式（文生视频）
 */
export async function submitWanVideo(
  prompt: string,
  imageUrl?: string,
  options?: WanVideoOptions
): Promise<string> {
  const apiKey = DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY 未配置，请设置环境变量 DASHSCOPE_API_KEY");
  }

  const model = DEFAULT_MODEL;
  const isI2V = imageUrl && (model.includes("i2v") || !model.includes("t2v"));

  // Build input based on model type
  const input: Record<string, unknown> = { prompt };
  if (isI2V) {
    // i2v: convert image to base64 and include as media
    let imageInput = imageUrl;
    if (imageUrl && !imageUrl.startsWith("data:") && !imageUrl.startsWith("http://")) {
      // Already accessible URL, use as-is
    } else if (imageUrl && !imageUrl.startsWith("data:")) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) {
          log.warn("Failed to fetch image for Wan2.7, trying as direct URL", {
            status: imgResponse.status,
          });
        } else {
          const buffer = Buffer.from(await imgResponse.arrayBuffer());
          const ext = imageUrl.toLowerCase().includes(".png") ? "png" : "jpeg";
          imageInput = `data:image/${ext};base64,${buffer.toString("base64")}`;
          log.info("Converted image to base64 for Wan2.7", {
            size: buffer.length,
            imageNumber: imageUrl.split("/").pop(),
          });
        }
      } catch (err) {
        log.warn("Failed to convert image to base64, using original URL", { error: (err as Error).message });
      }
    }
    input.media = [{ type: "first_frame", url: imageInput }];
  }

  const {
    resolution = DEFAULT_RESOLUTION,
    duration = DEFAULT_DURATION,
    maxRetries = 3,
    retryBaseMs = 2000,
  } = options || {};

  const body = {
    model,
    input,
    parameters: {
      resolution,
      duration,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(DASHSCOPE_SUBMIT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const result: WanSubmitResponse = await response.json();
        const taskId = result.output?.task_id;
        if (!taskId) {
          throw new Error(`No task_id returned: ${JSON.stringify(result)}`);
        }
        log.info("Wan video task submitted", { taskId });
        return taskId;
      }

      const errorText = await response.text();

      // 429 限流 — 指数退避重试
      if (response.status === 429) {
        lastError = new Error(`DashScope API 限流 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorText}`);
        if (attempt < maxRetries) {
          const waitMs = retryBaseMs * Math.pow(2, attempt) + Math.random() * 1000;
          log.warn(`429 rate limited, retrying in ${Math.round(waitMs)}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        break;
      }

      // 其他错误直接抛出
      throw new Error(`DashScope API error: ${response.status} - ${errorText}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("DashScope API error:")) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const waitMs = retryBaseMs * Math.pow(2, attempt) + Math.random() * 1000;
        log.warn(`Submit failed, retrying in ${Math.round(waitMs)}ms`, { error: lastError.message });
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("Wan video submission failed after retries");
}

// ── Status ─────────────────────────────────────────────────────

export interface WanVideoStatus {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  videoUrl?: string;
  message?: string;
}

/**
 * 查询 Wan2.7 视频生成任务状态
 */
export async function getWanVideoStatus(taskId: string): Promise<WanVideoStatus> {
  const apiKey = DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY 未配置");
  }

  const response = await fetch(DASHSCOPE_TASK_URL(taskId), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DashScope task status error: ${response.status} - ${error}`);
  }

  const result: WanTaskResponse = await response.json();
  const output = result.output;

  return {
    status: output.task_status,
    videoUrl: output.video_url,
    message: output.message,
  };
}

// ── Full Generation ───────────────────────────────────────────

/**
 * 完整的 Wan2.7 视频生成流程：提交 → 轮询 → 返回结果
 * 支持 t2v（文生视频）和 i2v（图生视频）自动切换
 */
export async function generateWanVideo(
  prompt: string,
  imageUrl?: string,
  options?: WanVideoOptions
): Promise<{ videoUrl: string; coverUrl?: string }> {
  const {
    pollIntervalMs = 10000,
    maxWaitMs = 300000, // 5 minutes
  } = options || {};

  const taskId = await submitWanVideo(prompt, imageUrl, options);
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getWanVideoStatus(taskId);

    if (status.status === "SUCCEEDED" && status.videoUrl) {
      log.info("Wan video generation succeeded", { taskId });
      return {
        videoUrl: status.videoUrl,
        coverUrl: undefined,
      };
    }

    if (status.status === "FAILED") {
      throw new Error(`Wan video generation failed: ${status.message || "Unknown error"}`);
    }

    // PENDING or RUNNING — keep polling
    log.debug("Waiting for Wan video", { taskId, status: status.status });
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("Wan video generation timed out");
}

// ── Download ──────────────────────────────────────────────────

/**
 * 下载 Wan 生成的视频到本地
 */
export async function downloadWanVideo(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Wan video: ${response.status} ${response.statusText}`);
  }

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  log.info("Wan video downloaded", { outputPath });
  return outputPath;
}
