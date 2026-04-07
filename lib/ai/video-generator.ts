import { getStyleImagePrompt } from "./script-generator";
import path from "path";
import fs from "fs/promises";

const COGVIDEO_BASE_URL =
  process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const GLM_API_KEY = process.env.GLM_API_KEY || "";

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

/**
 * 提交视频生成任务（异步）
 * 智谱 CogVideoX API: POST /videos/generations
 */
export async function submitVideoGeneration(
  prompt: string,
  imageUrl?: string,
  style: string = "realistic"
): Promise<{ taskId: string }> {
  const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
  const fullPrompt = imageUrl
    ? `基于这张图片生成短视频：${prompt}。画面风格：${stylePrompt}。电影感画面。`
    : `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面。`;

  const body: Record<string, unknown> = {
    model: process.env.VIDEO_MODEL || "cogvideox-3",
    prompt: fullPrompt,
    size: "1280x720",
  };

  if (imageUrl) {
    body.image_url = imageUrl;
  }

  const response = await fetch(`${COGVIDEO_BASE_URL}/videos/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    if (response.status === 429) {
      throw new Error(`CogVideo API 限流，请稍后再试: ${error}`);
    }
    throw new Error(`CogVideo API error: ${response.status} - ${error}`);
  }

  const result: CogVideoSubmitResponse = await response.json();

  if (!result.id) {
    throw new Error(`No task id returned: ${JSON.stringify(result)}`);
  }

  return { taskId: result.id };
}

/**
 * 查询视频生成任务状态
 * 智谱 API: GET /async-result/{id}
 */
export async function getVideoTaskStatus(
  taskId: string
): Promise<{
  status: string;
  videoUrl?: string;
  coverUrl?: string;
}> {
  const response = await fetch(
    `${COGVIDEO_BASE_URL}/async-result/${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${GLM_API_KEY}`,
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
