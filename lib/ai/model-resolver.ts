// ============================================
// 模型配置解析器
// 优先级: 用户配置 > 全局默认 > 环境变量
// ============================================

import { eq, and } from "drizzle-orm";
import { db, modelConfigs, userModelConfigs } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createLogger } from "@/lib/logger";

const log = createLogger("model-resolver");

export type ServiceType = "llm" | "image" | "tts" | "video";

export interface ResolvedConfig {
  /** 提供商: glm, deepseek, openai, xunfei, edge, kling, liblib 等 */
  provider: string;
  /** 模型名: glm-4-flash, cogview-3-plus, x4_xiaorui 等 */
  modelName: string;
  /** 解密后的 API Key */
  apiKey: string;
  /** API 基础 URL（可选） */
  baseUrl: string;
  /** 额外配置参数（JSON） */
  config: Record<string, unknown>;
  /** 配置来源: 'user' | 'global' | 'env' */
  source: "user" | "global" | "env";
}

/** 服务类型 → 环境变量映射 */
const ENV_FALLBACKS: Record<
  ServiceType,
  {
    apiKey: string;
    baseUrl?: string;
    model?: string;
  }
> = {
  llm: {
    apiKey: "GLM_API_KEY",
    baseUrl: "GLM_BASE_URL",
    model: "LLM_MODEL",
  },
  image: {
    apiKey: "GLM_API_KEY",
    baseUrl: "GLM_BASE_URL",
    model: "IMAGE_MODEL",
  },
  tts: {
    apiKey: "XUNFEI_API_KEY",
    baseUrl: undefined,
    model: undefined,
  },
  video: {
    apiKey: "GLM_API_KEY",
    baseUrl: "GLM_BASE_URL",
    model: "VIDEO_MODEL",
  },
};

/**
 * 解析服务配置
 * @param userId 用户 ID（可选，传 null 时跳过用户配置）
 * @param serviceType 服务类型
 * @param preferredProvider 可选，指定优先使用的提供商
 */
export async function resolveConfig(
  userId: string | null,
  serviceType: ServiceType,
  preferredProvider?: string
): Promise<ResolvedConfig> {
  // 1. 尝试用户配置
  if (userId) {
    try {
      const userConfigs = await db
        .select()
        .from(userModelConfigs)
        .where(
          and(
            eq(userModelConfigs.userId, userId),
            eq(userModelConfigs.serviceType, serviceType)
          )
        )
        .limit(5);

      if (userConfigs.length > 0) {
        // 如果有指定提供商偏好，优先匹配
        const preferred = preferredProvider
          ? userConfigs.find((c) => c.provider === preferredProvider)
          : null;
        const target = preferred || userConfigs[0];

        return {
          provider: target.provider,
          modelName: target.modelName,
          apiKey: target.apiKey ? decrypt(target.apiKey) : "",
          baseUrl: target.baseUrl || "",
          config: (target.config as Record<string, unknown>) || {},
          source: "user",
        };
      }
    } catch (err) {
      log.warn("读取用户模型配置失败，回退到全局配置", {
        userId,
        serviceType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. 尝试全局默认配置
  try {
    const globalConfigs = await db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.serviceType, serviceType))
      .limit(5);

    if (globalConfigs.length > 0) {
      // 优先 is_default，然后匹配 preferredProvider
      const defaultConfig = globalConfigs.find((c) => c.isDefault);
      const preferred = preferredProvider
        ? globalConfigs.find((c) => c.provider === preferredProvider)
        : null;
      const target = preferred || defaultConfig || globalConfigs[0];

      return {
        provider: target.provider,
        modelName: target.modelName,
        apiKey: target.apiKey ? decrypt(target.apiKey) : "",
        baseUrl: target.baseUrl || "",
        config: (target.config as Record<string, unknown>) || {},
        source: "global",
      };
    }
  } catch (err) {
    log.warn("读取全局模型配置失败，回退到环境变量", {
      serviceType,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. 环境变量回退
  return getEnvFallback(serviceType);
}

/** 从环境变量构建回退配置 */
function getEnvFallback(serviceType: ServiceType): ResolvedConfig {
  const fallback = ENV_FALLBACKS[serviceType];

  // 根据服务类型构建默认配置
  switch (serviceType) {
    case "llm":
      return {
        provider: "glm",
        modelName: process.env.LLM_MODEL || "glm-4-flash",
        apiKey: process.env.GLM_API_KEY || "",
        baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        config: {},
        source: "env",
      };

    case "image":
      return {
        provider: "glm",
        modelName: process.env.IMAGE_MODEL || "cogview-3-flash",
        apiKey: process.env.GLM_API_KEY || "",
        baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        config: {},
        source: "env",
      };

    case "tts": {
      const xunfeiConfigured = !!(
        process.env.XUNFEI_APPID &&
        process.env.XUNFEI_API_KEY &&
        process.env.XUNFEI_API_SECRET
      );
      if (xunfeiConfigured) {
        return {
          provider: "xunfei",
          modelName: "x4_xiaorui",
          apiKey: process.env.XUNFEI_API_KEY || "",
          baseUrl: "",
          config: {
            appId: process.env.XUNFEI_APPID || "",
            appSecret: process.env.XUNFEI_API_SECRET || "",
          },
          source: "env",
        };
      }
      return {
        provider: "edge",
        modelName: "edge-tts",
        apiKey: "",
        baseUrl: "",
        config: {},
        source: "env",
      };
    }

    case "video": {
      const videoProvider = process.env.VIDEO_PROVIDER || "glm";
      if (videoProvider === "wan" || videoProvider === "dashscope") {
        return {
          provider: "wan",
          modelName: process.env.WAN_VIDEO_MODEL || "wan2.7-i2v",
          apiKey: process.env.DASHSCOPE_API_KEY || "",
          baseUrl: "https://dashscope.aliyuncs.com",
          config: {
            resolution: process.env.WAN_VIDEO_RESOLUTION || "720P",
            duration: parseInt(process.env.WAN_VIDEO_DURATION || "5", 10),
          },
          source: "env",
        };
      }
      return {
        provider: "glm",
        modelName: process.env.VIDEO_MODEL || "cogvideox-3",
        apiKey: process.env.GLM_API_KEY || "",
        baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        config: {
          quality: process.env.VIDEO_QUALITY || "speed",
          size: process.env.VIDEO_SIZE || "1920x1080",
          fps: parseInt(process.env.VIDEO_FPS || "30", 10),
          duration: parseInt(process.env.VIDEO_DURATION || "5", 10),
        },
        source: "env",
      };
    }

    default:
      throw new Error(`未知服务类型: ${serviceType}`);
  }
}

/**
 * 获取所有可用的全局配置（用于管理页面展示）
 */
export async function getAllGlobalConfigs(): Promise<
  Array<{
    id: number;
    serviceType: string;
    provider: string;
    modelName: string;
    hasApiKey: boolean;
    baseUrl: string;
    isDefault: boolean;
    config: Record<string, unknown>;
  }>
> {
  const rows = await db.select().from(modelConfigs);

  return rows.map((r) => ({
    id: r.id,
    serviceType: r.serviceType,
    provider: r.provider,
    modelName: r.modelName,
    hasApiKey: !!r.apiKey,
    baseUrl: r.baseUrl || "",
    isDefault: r.isDefault ?? false,
    config: (r.config as Record<string, unknown>) || {},
  }));
}

/**
 * 获取用户所有配置（用于设置页面展示）
 */
export async function getUserConfigs(userId: string): Promise<
  Array<{
    id: number;
    serviceType: string;
    provider: string;
    modelName: string;
    hasApiKey: boolean;
    baseUrl: string;
    config: Record<string, unknown>;
  }>
> {
  const rows = await db
    .select()
    .from(userModelConfigs)
    .where(eq(userModelConfigs.userId, userId));

  return rows.map((r) => ({
    id: r.id,
    serviceType: r.serviceType,
    provider: r.provider,
    modelName: r.modelName,
    hasApiKey: !!r.apiKey,
    baseUrl: r.baseUrl || "",
    config: (r.config as Record<string, unknown>) || {},
  }));
}
