import { getStyleImagePrompt } from "./script-generator";
import { withRetry, withTimeout } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";
import { resolveConfig } from "@/lib/ai/model-resolver";
import path from "path";

const log = createLogger("image-generator");
// 环境变量回退
const ENV_COGVIEW_BASE_URL =
  process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const ENV_GLM_API_KEY = process.env.GLM_API_KEY || "";

type ImageSize = "1024x1024" | "1280x720" | "1728x960" | "720x1280" | "960x1728";

export interface GenerateImageOptions {
  characterReferences?: {
    imageUrl: string;
    type: "face" | "full_body";
    characterName: string;
  }[];
  userId?: string; // 用于解析用户自定义配置
}

interface CogViewResponse {
  id: string;
  created: number;
  data: {
    url: string;
  }[];
}

async function generateImageWithCogView(
  prompt: string,
  style: string = "realistic",
  size: ImageSize = "1728x960",
  userId?: string
): Promise<string> {
  // 尝试从模型配置解析
  const modelConfig = await resolveConfig(userId || null, "image").catch(() => null);
  const baseUrl = modelConfig?.baseUrl || ENV_COGVIEW_BASE_URL;
  const apiKey = modelConfig?.apiKey || ENV_GLM_API_KEY;

  if (!apiKey) {
    throw new Error("图片生成 API Key 未配置：请在设置中配置模型服务或设置 GLM_API_KEY 环境变量");
  }

  const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
  const fullPrompt = `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面，专业摄影级别。`;

  const model = modelConfig?.modelName || process.env.IMAGE_MODEL || "glm-image";

  const imageSize = model.includes("glm-image") ? "1728x960" : size;

  const attempts: { prompt: string; label: string }[] = [
    { prompt: fullPrompt, label: "full" },
    {
      prompt: prompt.substring(0, 80) + `。${stylePrompt}。宽屏16:9构图。`,
      label: "simplified",
    },
    {
      prompt: `人物场景，${stylePrompt}，电影感画面构图，柔和光线，温馨氛围。`,
      label: "generic-safe",
    },
    {
      prompt: `美丽的城市街道场景，${stylePrompt}，电影感画面，16:9构图。`,
      label: "ultra-safe",
    },
  ];

  let lastError = "";

  for (let i = 0; i < attempts.length; i++) {
    const { prompt: attemptPrompt, label } = attempts[i];

    try {
      const response = await withRetry(
        () =>
          withTimeout(
            () =>
              fetch(`${baseUrl}/images/generations`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model,
                  prompt: attemptPrompt,
                  size: imageSize,
                }),
              }),
            120000,
            "CogView image generation"
          ),
        {
          maxRetries: 3,
          baseDelayMs: 3000,
          noRetryOn: ["余额不足", "insufficient"],
          onRetry: (attempt, err, delayMs) => {
            log.warn(`Image generation retry ${attempt} after ${Math.round(delayMs)}ms`, {
              model,
              label,
              prompt: attemptPrompt.substring(0, 50),
              error: err.message,
            });
          },
        }
      );

      if (response.ok) {
        const result: CogViewResponse = await response.json();
        if (!result.data?.[0]?.url) {
          throw new Error("No image URL returned from CogView");
        }
        if (i > 0) {
          log.warn(`Content filter bypassed with ${label} prompt (attempt ${i + 1})`, {
            originalPrompt: prompt.substring(0, 50),
          });
        }
        return result.data[0].url;
      }

      const errorText = await response.text();
      lastError = errorText;

      if (response.status === 400 && errorText.includes("1301")) {
        log.warn(`Content filter triggered on ${label} prompt, trying next variant...`, {
          attempt: i + 1,
          prompt: attemptPrompt.substring(0, 60),
        });
        continue;
      }

      throw new Error(`CogView API error: ${response.status} - ${errorText}`);
    } catch (err) {
      const isContentFilter = err instanceof Error && (err.message.includes("1301") || err.message.includes("内容审核"));
      if (isContentFilter && i < attempts.length - 1) {
        lastError = err.message;
        log.warn(`Content filter on ${label} prompt, trying next variant...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`CogView 内容审核拦截，所有去敏尝试均失败: ${lastError.substring(0, 200)}`);
}

/**
 * ImageSize 映射为 wan2.7 显式像素尺寸。
 * 万相 2.7 规则：有图片输入时输出宽高比跟随最后一张参考图，
 * 因此必须显式指定输出像素，否则横屏镜头会生成方图（合成时被黑边填充）。
 */
function toWan27PixelSize(size: ImageSize): string {
  if (size === "720x1280" || size === "960x1728") return "1080*1920";
  if (size === "1024x1024") return "1024*1024";
  return "1920*1080";
}

export async function generateImage(
  prompt: string,
  style: string = "realistic",
  size: ImageSize = "1728x960",
  options?: GenerateImageOptions
): Promise<string> {
  // 优先使用阿里百炼 Wan / Wan2.7（DASHSCOPE_API_KEY 配置时）
  const dashscopeKey = process.env.DASHSCOPE_API_KEY;
  if (dashscopeKey) {
    const { generateWan27ImagePro, generateWanxImage, imageSizeToWanx } = await import("./wan-image-generator");
    const isVertical = size === "720x1280" || size === "960x1728";
    const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
    const fullPrompt = isVertical
      ? `${prompt}。画面风格：${stylePrompt}。竖屏9:16构图，电影感画面。`
      : `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面，专业摄影级别。`;

    const characterReferences = (options?.characterReferences || []).filter((r) => r.imageUrl);

    // 检查环境变量或模型配置，决定用哪个模型
    const model = (process.env.IMAGE_MODEL || "wan2.7-image").toLowerCase();
    if (model.includes("wan2.7-image")) {
      // wan2.7-image 系列（含 pro）支持同步调用 + 2K/4K + 多图参考（角色一致性）
      try {
        if (model.includes("4k") && characterReferences.length === 0) {
          // 4K 仅支持规格档位；有参考图时必须显式像素
          return await generateWan27ImagePro(fullPrompt, { size: "4K" });
        }
        if (characterReferences.length > 0) {
          try {
            return await generateWan27ImagePro(fullPrompt, {
              size: toWan27PixelSize(size),
              referenceImages: characterReferences.map((r) => ({
                url: r.imageUrl,
                label: r.characterName,
              })),
            });
          } catch (err) {
            // 参考图生成失败 → 降级为纯文本生成（宁可换脸也不要失败）
            log.warn("Wan2.7 reference-image generation failed, falling back to text-only", {
              refCount: characterReferences.length,
              error: (err as Error).message,
            });
          }
        }
        // 无参考图路径：显式像素尺寸对齐视频目标分辨率，避免方图黑边
        return await generateWan27ImagePro(fullPrompt, { size: toWan27PixelSize(size) });
      } catch (err) {
        log.warn("Wan2.7 Image Pro failed, falling back to wanx-v1", { error: (err as Error).message });
        // 降级到 wanx-v1
      }
    } else if (characterReferences.length > 0) {
      log.warn("Current image model does not support character references, ignoring them", {
        model,
        refCount: characterReferences.length,
      });
    }

    // 降级：wanx-v1（异步，需轮询，不支持参考图）
    const wanxSize = imageSizeToWanx(size, isVertical);
    return await generateWanxImage(fullPrompt, { size: wanxSize });
  }
  if (options?.characterReferences?.length) {
    log.warn("CogView fallback does not support character references, ignoring them", {
      refCount: options.characterReferences.length,
    });
  }
  return await generateImageWithCogView(prompt, style, size, options?.userId);
}

export async function downloadImage(
  url: string,
  savePath: string
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const { writeFile, mkdir } = await import("fs/promises");
  await mkdir(path.dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);

  return savePath;
}
