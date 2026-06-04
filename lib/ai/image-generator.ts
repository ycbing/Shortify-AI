import { getStyleImagePrompt } from "./script-generator";
import { withRetry } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";
import { generateImageWithKling } from "./kling-client";
import type { KlingCharacterReference } from "./kling-client";
import { generateImageWithLibLib, isLibLibConfigured } from "./liblib-client";
import type { LibLibCharacterReference } from "./liblib-client";
import { resolveConfig } from "@/lib/ai/model-resolver";

const log = createLogger("image-generator");
// 环境变量回退
const ENV_COGVIEW_BASE_URL =
  process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const ENV_GLM_API_KEY = process.env.GLM_API_KEY || "";

type ImageSize = "1024x1024" | "1280x720" | "1728x960";

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

export async function generateImage(
  prompt: string,
  style: string = "realistic",
  size: ImageSize = "1728x960",
  options?: GenerateImageOptions
): Promise<string> {
  const klingConfigured = process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY;
  const provider = process.env.IMAGE_PROVIDER || "cogview";
  const hasRefs = options?.characterReferences && options.characterReferences.length > 0;

  // LibLib (preferred when configured - cheaper, more models)
  const liblibConfigured = isLibLibConfigured();
  if (liblibConfigured) {
    if (hasRefs) {
      const primaryRef = options!.characterReferences![0];
      const liblibRef: LibLibCharacterReference = {
        imageUrl: primaryRef.imageUrl,
        characterName: primaryRef.characterName,
        type: primaryRef.type,
      };
      log.info(`Using LibLib Star-3 with character reference for "${primaryRef.characterName}"`, {
        provider: "liblib",
        hasReference: true,
      });
      return generateImageWithLibLib(prompt, size, liblibRef);
    }
    if (provider === "liblib") {
      log.info(`Using LibLib without character reference`, { provider: "liblib" });
      return generateImageWithLibLib(prompt, size);
    }
  }

  // Fallback to Kling when character references available
  if (hasRefs && klingConfigured) {
    const primaryRef = options!.characterReferences![0];
    const klingRef: KlingCharacterReference = {
      imageUrl: primaryRef.imageUrl,
      type: primaryRef.type,
    };
    log.info(`Using Kling with character reference for "${primaryRef.characterName}"`, {
      provider: "kling",
      hasReference: true,
    });
    return generateImageWithKling(prompt, size, klingRef);
  }

  // Fallback to Kling for everything if explicitly configured
  if (provider === "kling" && klingConfigured) {
    log.info(`Using Kling without character reference`, {
      provider: "kling",
      hasReference: false,
    });
    return generateImageWithKling(prompt, size);
  }

  // CogView with LibLib fallback
  try {
    return await generateImageWithCogView(prompt, style, size, options?.userId);
  } catch (cogviewErr) {
    if (liblibConfigured) {
      log.warn(`CogView failed, falling back to LibLib`, {
        error: cogviewErr instanceof Error ? cogviewErr.message : String(cogviewErr),
      });
      return generateImageWithLibLib(prompt, size);
    }
    throw cogviewErr;
  }
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
  await mkdir(require("path").dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);

  return savePath;
}
