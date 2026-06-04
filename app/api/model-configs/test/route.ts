// ============================================
// POST /api/model-configs/test  — 测试配置是否可用
// 验证 API Key 是否有效
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("model-configs-test-api");

/**
 * 根据服务类型测试 API 连接
 */
async function testConnection(config: {
  serviceType: string;
  provider: string;
  modelName: string;
  apiKey: string;
  baseUrl: string;
  config?: Record<string, unknown>;
}): Promise<{ success: boolean; message: string }> {
  const { serviceType, provider, modelName, apiKey, baseUrl } = config;

  try {
    switch (serviceType) {
      case "llm": {
        // 测试 LLM: 发送一条简单消息
        const url = `${baseUrl || "https://open.bigmodel.cn/api/paas/v4"}/chat/completions`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5,
          }),
        });
        if (res.ok) {
          return { success: true, message: "LLM 连接成功" };
        }
        const err = await res.text();
        if (res.status === 401 || res.status === 403) {
          return { success: false, message: `API Key 无效 (${res.status})` };
        }
        return { success: false, message: `LLM 测试失败 (${res.status}): ${err.substring(0, 200)}` };
      }

      case "image": {
        // 测试图片生成 API: 尝试一个简单请求（CogView 兼容格式）
        if (provider === "glm" || provider === "zhipu") {
          const url = `${baseUrl || "https://open.bigmodel.cn/api/paas/v4"}/images/generations`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: modelName,
              prompt: "test",
              size: "1024x1024",
            }),
          });
          if (res.status === 401 || res.status === 403) {
            return { success: false, message: `API Key 无效 (${res.status})` };
          }
          // 即使 prompt 被 filter 拦截也说明 key 有效
          return { success: true, message: "生图 API 连接成功" };
        }
        // OpenAI 兼容格式
        if (provider === "openai") {
          const url = `${baseUrl || "https://api.openai.com/v1"}/images/generations`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: modelName,
              prompt: "test",
              n: 1,
              size: "1024x1024",
            }),
          });
          if (res.status === 401 || res.status === 403) {
            return { success: false, message: `API Key 无效 (${res.status})` };
          }
          return { success: true, message: "生图 API 连接成功" };
        }
        return { success: false, message: `不支持的生图提供商: ${provider}` };
      }

      case "tts": {
        if (provider === "xunfei") {
          // 讯飞: 只检查是否配置了三要素
          const hasAppId = !!config?.config?.appId;
          const hasAppSecret = !!config?.config?.appSecret;
          if (!apiKey || !hasAppId || !hasAppSecret) {
            return { success: false, message: "讯飞 TTS 需要填写 API Key、AppID 和 AppSecret" };
          }
          return { success: true, message: "讯飞 TTS 配置完整" };
        }
        // edge-tts 不需要 API Key
        return { success: true, message: "Edge-TTS 无需验证（免费服务）" };
      }

      case "video": {
        // 测试视频生成 API key 有效性
        if (provider === "glm" || provider === "zhipu") {
          const url = `${baseUrl || "https://open.bigmodel.cn/api/paas/v4"}/videos/generations`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: modelName,
              prompt: "test",
            }),
          });
          if (res.status === 401 || res.status === 403) {
            return { success: false, message: `API Key 无效 (${res.status})` };
          }
          return { success: true, message: "视频 API 连接成功" };
        }
        return { success: false, message: `不支持的视频提供商: ${provider}` };
      }

      default:
        return { success: false, message: `未知服务类型: ${serviceType}` };
    }
  } catch (err) {
    return {
      success: false,
      message: `连接失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { serviceType, provider, modelName, apiKey, baseUrl, config } = body;

    if (!serviceType || !provider || !modelName) {
      return NextResponse.json(
        { error: "缺少必填字段: serviceType, provider, modelName" },
        { status: 400 }
      );
    }

    // 如果没传 apiKey，从数据库获取（测试现有配置）
    let resolvedApiKey = apiKey;
    if (!resolvedApiKey && body.configId) {
      // 用户可能在测试已有的配置
      return NextResponse.json({
        error: "请提供 API Key 以进行测试",
      });
    }

    const result = await testConnection({
      serviceType,
      provider,
      modelName,
      apiKey: resolvedApiKey || "",
      baseUrl: baseUrl || "",
      config,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("测试配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "测试失败" }, { status: 500 });
  }
}
