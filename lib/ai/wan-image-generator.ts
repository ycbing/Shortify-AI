// Wanx Image Generator - 阿里百炼文生图（异步）
import { createLogger } from "@/lib/logger";

const log = createLogger("wan-image-generator");

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";

interface WanxSubmitResponse {
  request_id: string;
  output: {
    task_id: string;
    task_status: string;
  };
}

interface WanxResultResponse {
  request_id: string;
  output: {
    task_id: string;
    task_status: string;
    results?: {
      b64_image?: string;
      url?: string;
    }[];
  };
}

/**
 * 提交文生图任务
 */
export async function submitWanxImage(
  prompt: string,
  options?: {
    size?: string; // "1024*1024" | "1280*720" | "720*1280" | "960*1080"
    style?: string;
    negativePrompt?: string;
  }
): Promise<string> {
  const apiKey = DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY 未配置");
  }

  const size = options?.size || "1024*1024";

  const response = await fetch(
    `${DASHSCOPE_BASE_URL}/api/v1/services/aigc/text2image/image-synthesis`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "wanx-v1",
        input: {
          prompt,
          ...(options?.negativePrompt && { negative_prompt: options.negativePrompt }),
        },
        parameters: {
          size,
          n: 1,
          style: options?.style || "<auto>",
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Wanx submit error: ${response.status} - ${error}`);
  }

  const result: WanxSubmitResponse = await response.json();
  if (!result.output?.task_id) {
    throw new Error(`No task_id: ${JSON.stringify(result)}`);
  }

  log.info("Image task submitted", { taskId: result.output.task_id, size });
  return result.output.task_id;
}

/**
 * 查询文生图任务状态
 */
export async function getWanxImageStatus(taskId: string): Promise<{
  status: string;
  imageUrl?: string;
}> {
  const apiKey = DASHSCOPE_API_KEY;
  const response = await fetch(
    `${DASHSCOPE_BASE_URL}/api/v1/tasks/${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Wanx status error: ${response.status} - ${error}`);
  }

  const result: WanxResultResponse = await response.json();

  if (result.output?.task_status === "SUCCEEDED" && result.output?.results?.[0]) {
    const imageUrl = result.output.results[0].url || result.output.results[0].b64_image;
    if (!imageUrl) {
      throw new Error("Image task succeeded but no URL returned");
    }
    return { status: "completed", imageUrl };
  }

  if (result.output?.task_status === "FAILED") {
    throw new Error(`Image generation failed for task ${taskId}`);
  }

  return { status: result.output?.task_status || "processing" };
}

/**
 * 完整的图片生成流程：提交 + 轮询等待
 */
export async function generateWanxImage(
  prompt: string,
  options?: {
    size?: string;
    style?: string;
    negativePrompt?: string;
    maxWaitMs?: number;
    pollIntervalMs?: number;
  }
): Promise<string> {
  const taskId = await submitWanxImage(prompt, options);

  const maxWaitMs = options?.maxWaitMs || 120000;
  const pollIntervalMs = options?.pollIntervalMs || 3000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await getWanxImageStatus(taskId);

    if (result.status === "completed" && result.imageUrl) {
      log.info("Image generated", { taskId, url: result.imageUrl.substring(0, 60) });
      return result.imageUrl;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Image generation timed out after ${Math.round(maxWaitMs / 1000)}s`);
}

/**
 * 将 ImageSize 格式转换为 Wanx 的 size 参数
 */
export function imageSizeToWanx(size: string, isVertical: boolean = false): string {
  if (isVertical) {
    // 竖屏
    if (size === "720x1280" || size === "960x1728") return "720*1280";
    return "960*1280";
  }
  // 横屏
  const map: Record<string, string> = {
    "1024x1024": "1024*1024",
    "1280x720": "1280*720",
    "1728x960": "1280*720",
    "960x1728": "720*1280",
    "720x1280": "720*1280",
  };
  return map[size] || "1280*720";
}

// ============================================================
// Wan2.7 Image Pro — 同步调用（推荐模型）
// Endpoint: /api/v1/services/aigc/multimodal-generation/generation
// ============================================================

/** 多图参考生成的参考图（万相 2.7 支持 0-9 张） */
export interface Wan27ReferenceImage {
  /** 参考图 URL（公网可访问）或 base64 data URL */
  url: string;
  /** 角色/主体名，用于 prompt 中按"图N"定位 */
  label?: string;
}

/**
 * 使用 wan2.7-image-pro 模型生成图片（同步，支持2K/4K）
 * 推荐使用，效果比 wanx-v1 好
 *
 * 支持多图参考生成（角色一致性）：传入 referenceImages 后，
 * 模型会按参考图中人物的面貌/发型/服装出图。
 * 注意：有图片输入时输出宽高比跟随最后一张输入图，
 * 因此必须用显式像素 size（如 "1920*1080"）控制输出比例。
 */
export async function generateWan27ImagePro(
  prompt: string,
  options?: {
    size?: "1K" | "2K" | "4K" | string; // 规格档位，或显式像素如 "1920*1080"
    n?: number;  // 生成数量 1-4，默认 1
    style?: string;
    watermark?: boolean;
    thinkingMode?: boolean;
    modelName?: string; // 模型名，默认 "wan2.7-image-pro"
    referenceImages?: Wan27ReferenceImage[]; // 参考图（角色一致性）
  }
): Promise<string> {
  const apiKey = DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");

  const modelName = options?.modelName || process.env.IMAGE_MODEL || "wan2.7-image-pro";
  const refs = (options?.referenceImages || [])
    .filter((r) => r?.url)
    .slice(0, 9); // API 上限 9 张

  // 组装 content：参考图在前，文字在后（文字中按"图N"引用）
  const content: Record<string, string>[] = refs.map((r) => ({ image: r.url }));
  if (refs.length > 0) {
    const labels = refs.map((r, i) => `图${i + 1}是${r.label || "参考角色"}的形象参考`).join("，");
    const names = refs.map((r) => r.label || "参考角色").join("、");
    content.push({
      text: `${labels}。请让${names}在画面中保持与参考图完全一致的面貌、发型与服装特征。${prompt}`,
    });
  } else {
    content.push({ text: prompt });
  }

  const response = await fetch(
    `${DASHSCOPE_BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        input: {
          messages: [{
            role: "user",
            content,
          }],
        },
        parameters: {
          size: options?.size || "2K",
          n: options?.n || 1,
          watermark: options?.watermark ?? false,
          // thinking_mode 仅在无图片输入时生效
          ...(refs.length === 0 ? { thinking_mode: options?.thinkingMode ?? true } : {}),
          ...(options?.style ? { style: options.style } : {}),
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Wan2.7 Image Pro error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  // 同步响应: output.choices[0].message.content 为数组，取第一个含 image 的条目
  const contentArr = result.output?.choices?.[0]?.message?.content;
  const imageItem = Array.isArray(contentArr)
    ? contentArr.find((item: { image?: string }) => item?.image)
    : null;
  const imageUrl = imageItem?.image ||
                   result.output?.choices?.[0]?.message?.content?.[0]?.image ||
                   result.output?.results?.[0]?.url || "";
  if (!imageUrl) throw new Error(`No image URL: ${JSON.stringify(result).substring(0, 200)}`);

  log.info("Wan2.7 Image generated", {
    model: modelName,
    size: options?.size || "2K",
    refCount: refs.length,
    url: imageUrl.substring(0, 60),
  });
  return imageUrl;
}
