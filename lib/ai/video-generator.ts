import { getStyleImagePrompt } from "./script-generator";
import path from "path";
import fs from "fs/promises";
import { createLogger } from "@/lib/logger";
import { resolveConfig } from "@/lib/ai/model-resolver";
import { generateWanVideo } from "./wan-video-generator";

const log = createLogger("video-generator");

// 环境变量回退
const ENV_COGVIDEO_BASE_URL =
  process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const ENV_GLM_API_KEY = process.env.GLM_API_KEY || "";

interface CogVideoSubmitResponse {
  model: string;
  id: string;
  request_id: string;
  task_status: string;
}

interface CogVideoAsyncResult {
  id: string;
  request_id: string;
  created: number;
  model: string;
  task_status: string;
  video_result?: Array<{
    url: string;
    cover_image_url: string;
  }>;
  choices?: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface VideoGenerationOptions {
  /** 视频质量模式: "quality" 高质量 | "speed" 快速生成 */
  quality?: "quality" | "speed";
  /** 分辨率: "1280x720" | "1920x1080" | "3840x2160"，默认 "1920x1080" */
  size?: string;
  /** 帧率: 30 | 60，默认 30 */
  fps?: number;
  /** 视频时长: 5 | 10（秒），默认 5 */
  duration?: number;
  /** 是否生成音频，默认 false */
  withAudio?: boolean;
  /** 最大重试次数（429 限流时），默认 3 */
  maxRetries?: number;
  /** 重试间隔基数（毫秒），默认 2000，每次重试指数退避 */
  retryBaseMs?: number;
}

export interface GenerateVideoOptions {
  characterReference?: { imageUrl: string; type: string };
  quality?: "quality" | "speed";
  size?: string;
  userId?: string;
}

/**
 * Unified video generation via CogVideoX (Zhipu)
 */
export async function generateVideo(
  prompt: string,
  imageUrl: string,
  style?: string,
  options?: GenerateVideoOptions
): Promise<{ videoUrl: string; coverUrl?: string }> {
  const userId = options?.userId || null;
  
  // 尝试从模型配置解析（优先用户配置 > 全局 > 环境变量）
  const config = await resolveConfig(userId, "video").catch(() => null);
  // 环境变量 VIDEO_PROVIDER 优先于数据库配置（避免数据库旧配置覆盖）
  const provider = process.env.VIDEO_PROVIDER || config?.provider || "cogvideo";
  const hasCharRef = !!options?.characterReference?.imageUrl;

  log.info("Video generation", {
    provider,
    source: config?.source || "env",
    model: config?.modelName || process.env.VIDEO_MODEL || "cogvideox-3",
    hasCharRef,
  });

  // ========== 阿里百炼 Wan2.7 (provider=wan / dashscope) ==========
  if (provider === "wan" || provider === "dashscope") {
    const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
    const isT2V = (process.env.WAN_VIDEO_MODEL || "").includes("t2v");
    const fullPrompt = isT2V
      ? `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面，高质量。`
      : `基于这张图片生成短视频：${prompt}。画面风格：${stylePrompt}。电影感画面。`;
    // t2v: 不传图片；i2v: 传分镜图
    return generateWanVideo(fullPrompt, isT2V ? undefined : imageUrl, {
      resolution: process.env.WAN_VIDEO_RESOLUTION || "720P",
      duration: Number(process.env.WAN_VIDEO_DURATION) || 5,
    });
  }

  // ========== 智谱 CogVideoX (provider=glm) 或默认 ==========
  // CogVideoX 支持通过 resolveConfig 的 baseUrl/apiKey 或环境变量
  const { taskId } = await submitVideoGeneration(prompt, imageUrl, style, {
    quality: options?.quality,
    size: options?.size,
    userId: userId || undefined,
  });
  return waitForVideoCompletion(taskId);
}

/**
 * 提交视频生成任务（异步）
 * 智谱 CogVideoX-3 API: POST /videos/generations
 */
export async function submitVideoGeneration(
  prompt: string,
  imageUrl?: string,
  style: string = "realistic",
  options?: VideoGenerationOptions & { userId?: string }
): Promise<{ taskId: string }> {
  const {
    quality = "quality",
    size = "1920x1080",
    fps,
    duration,
    withAudio,
    maxRetries = 3,
    retryBaseMs = 2000,
    userId,
  } = options || {};

  // 尝试从模型配置解析
  const modelConfig = await resolveConfig(userId || null, "video").catch(() => null);
  const baseUrl = modelConfig?.baseUrl || ENV_COGVIDEO_BASE_URL;
  const apiKey = modelConfig?.apiKey || ENV_GLM_API_KEY;

  if (!apiKey) {
    throw new Error("视频生成 API Key 未配置：请在设置中配置模型服务或设置 GLM_API_KEY 环境变量");
  }

  // 从配置或环境变量获取视频参数
  const resolvedQuality = (modelConfig?.config?.quality as string) || quality;
  const resolvedSize = (modelConfig?.config?.size as string) || size;
  const resolvedFps = fps ?? (modelConfig?.config?.fps as number) ?? 30;
  const resolvedDuration = duration ?? (modelConfig?.config?.duration as number) ?? 5;

  const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
  const fullPrompt = imageUrl
    ? `基于这张图片生成短视频：${prompt}。画面风格：${stylePrompt}。电影感画面。`
    : `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面。`;

  const body: Record<string, unknown> = {
    model: modelConfig?.modelName || process.env.VIDEO_MODEL || "cogvideox-3",
    prompt: fullPrompt,
    quality: resolvedQuality,
    size: resolvedSize,
  };

  if (imageUrl) {
    body.image_url = imageUrl;
  }

  // 可选参数（仅在有值时发送）
  if (resolvedFps !== undefined) body.fps = resolvedFps;
  if (resolvedDuration !== undefined) body.duration = resolvedDuration;
  if (withAudio !== undefined) body.with_audio = withAudio;

  // 带重试的请求（429 限流 + 余额不足检测）
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/videos/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const result: CogVideoSubmitResponse = await response.json();
        if (!result.id) {
          throw new Error(`No task id returned: ${JSON.stringify(result)}`);
        }
        return { taskId: result.id };
      }

      const errorText = await response.text();

      // 余额不足 — 不重试，直接报错
      if (response.status === 402 || errorText.includes("insufficient") || errorText.includes("余额")) {
        throw new Error(`CogVideo API 余额不足，请充值后重试: ${errorText}`);
      }

      // 429 限流 — 重试（指数退避）
      if (response.status === 429) {
        lastError = new Error(`CogVideo API 限流 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorText}`);
        if (attempt < maxRetries) {
          const waitMs = retryBaseMs * Math.pow(2, attempt) + Math.random() * 1000;
          log.warn(`429 rate limited, retrying in ${Math.round(waitMs)}ms`, { taskId: undefined, error: errorText });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        break; // 重试次数用完
      }

      // 其他错误 — 不重试
      throw new Error(`CogVideo API error: ${response.status} - ${errorText}`);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("余额不足") || err.message.includes("CogVideo API error:"))) {
        throw err; // 余额不足和一般错误不重试
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const waitMs = retryBaseMs * Math.pow(2, attempt) + Math.random() * 1000;
        log.warn(`Request failed, retrying in ${Math.round(waitMs)}ms`, { error: lastError.message });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("Video generation failed after retries");
}

/**
 * 查询视频生成任务状态
 * 智谱 API: GET /async-result/{id}
 */
export async function getVideoTaskStatus(
  taskId: string,
  apiKeyOverride?: string,
  baseUrlOverride?: string
): Promise<{
  status: string;
  videoUrl?: string;
  coverUrl?: string;
}> {
  const baseUrl = baseUrlOverride || ENV_COGVIDEO_BASE_URL;
  const apiKey = apiKeyOverride || ENV_GLM_API_KEY;

  const response = await fetch(
    `${baseUrl}/async-result/${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CogVideo status API error: ${response.status} - ${error}`);
  }

  const result: CogVideoAsyncResult = await response.json();

  if (result.task_status === "SUCCESS" && result.video_result?.length) {
    return {
      status: "completed",
      videoUrl: result.video_result[0].url,
      coverUrl: result.video_result[0].cover_image_url,
    };
  }

  if (result.task_status === "FAIL") {
    const failMsg = result.choices?.[0]?.message?.content || "Unknown error";
    throw new Error(`Video generation failed: ${failMsg}`);
  }

  return { status: "processing" };
}

/**
 * 等待视频生成完成（轮询）
 * @param taskId 任务ID
 * @param maxWaitMs 最大等待时间（毫秒），默认 5 分钟
 * @param pollIntervalMs 轮询间隔（毫秒），默认 8 秒
 */
export async function waitForVideoCompletion(
  taskId: string,
  maxWaitMs: number = 300000,
  pollIntervalMs: number = 8000
): Promise<{
  videoUrl: string;
  coverUrl: string;
}> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await getVideoTaskStatus(taskId);

    if (result.status === "completed" && result.videoUrl) {
      return {
        videoUrl: result.videoUrl,
        coverUrl: result.coverUrl || "",
      };
    }

    // getVideoTaskStatus throws on FAIL, so no need to check here

    // 等待后轮询
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Video generation timed out");
}

/**
 * 下载视频到本地
 * @param url 视频的远程 URL
 * @param outputPath 本地保存路径（含文件名）
 */
export async function downloadVideo(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  return outputPath;
}

/**
 * 将本地图片转为 base64 (data URI 格式，用于智谱 API 的 image_url 参数)
 */
export async function imageToBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
