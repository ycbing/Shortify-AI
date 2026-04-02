import { getStyleImagePrompt } from "./script-generator";

const COGVIDEO_BASE_URL =
  process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const GLM_API_KEY = process.env.GLM_API_KEY || "";

interface CogVideoResponse {
  id: string;
  created: number;
  model: string;
  task_id: string;
  task_status: string;
  request_id: string;
}

interface CogVideoResult {
  id: string;
  created: number;
  model: string;
  task_id: string;
  task_status: string;
  video_result: {
    url: string;
    cover_image_url: string;
    duration: number;
    frame_rate: number;
    width: number;
    height: number;
  };
  request_id: string;
}

/**
 * 提交视频生成任务（异步）
 */
export async function submitVideoGeneration(
  prompt: string,
  image?: string,
  style: string = "realistic"
): Promise<{ taskId: string }> {
  const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
  const fullPrompt = image
    ? `基于这张图片生成短视频：${prompt}。画面风格：${stylePrompt}。电影感画面。`
    : `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面。`;

  const body: Record<string, unknown> = {
    model: "cogvideox-flash",
    prompt: fullPrompt,
  };

  if (image) {
    body.image = image;
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
    throw new Error(`CogVideo API error: ${response.status} - ${error}`);
  }

  const result: CogVideoResponse = await response.json();

  if (!result.task_id) {
    throw new Error("No task_id returned from CogVideo");
  }

  return { taskId: result.task_id };
}

/**
 * 查询视频生成任务状态
 */
export async function getVideoTaskStatus(
  taskId: string
): Promise<{
  status: string;
  videoUrl?: string;
  coverUrl?: string;
  duration?: number;
}> {
  const response = await fetch(
    `${COGVIDEO_BASE_URL}/videos/generations/${taskId}`,
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

  const result = await response.json();

  if (result.task_status === "SUCCESS" && result.video_result) {
    return {
      status: "completed",
      videoUrl: result.video_result.url,
      coverUrl: result.video_result.cover_image_url,
      duration: result.video_result.duration,
    };
  }

  if (result.task_status === "FAIL") {
    return { status: "failed" };
  }

  return { status: "processing" };
}

/**
 * 等待视频生成完成（轮询）
 * @param taskId 任务ID
 * @param maxWaitMs 最大等待时间（毫秒），默认 5 分钟
 * @param pollIntervalMs 轮询间隔（毫秒），默认 5 秒
 */
export async function waitForVideoCompletion(
  taskId: string,
  maxWaitMs: number = 300000,
  pollIntervalMs: number = 5000
): Promise<{
  videoUrl: string;
  coverUrl: string;
  duration: number;
}> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await getVideoTaskStatus(taskId);

    if (result.status === "completed" && result.videoUrl) {
      return {
        videoUrl: result.videoUrl,
        coverUrl: result.coverUrl || "",
        duration: result.duration || 5,
      };
    }

    if (result.status === "failed") {
      throw new Error("Video generation failed");
    }

    // 等待后轮询
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Video generation timed out");
}
