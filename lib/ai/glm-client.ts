// GLM API Client (智谱) - 支持模型配置解析
import { withRetry, withTimeout } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";
import { resolveConfig } from "@/lib/ai/model-resolver";

const log = createLogger("glm-client");

// 环境变量回退
const ENV_GLM_BASE_URL = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const ENV_GLM_API_KEY = process.env.GLM_API_KEY || "";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GLMResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" };
    userId?: string; // 用于解析用户自定义配置
  }
): Promise<GLMResponse> {
  // 尝试从模型配置解析
  const modelConfig = await resolveConfig(options?.userId || null, "llm").catch(() => null);

  const baseUrl = modelConfig?.baseUrl || ENV_GLM_BASE_URL;
  const apiKey = modelConfig?.apiKey || ENV_GLM_API_KEY;
  const model = options?.model || modelConfig?.modelName || process.env.GLM_MODEL || "qwen-plus";

  if (!apiKey) {
    throw new Error("GLM API Key 未配置：请在设置中配置模型服务或设置 GLM_API_KEY 环境变量");
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 16384,
  };

  if (options?.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await withRetry(
    () =>
      fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }),
    {
      maxRetries: 3,
      baseDelayMs: 2000,
      noRetryOn: ["余额不足", "insufficient"],
      onRetry: (attempt, err, delayMs) => {
        log.warn(`Chat completion retry ${attempt} after ${Math.round(delayMs)}ms`, {
          model,
          source: modelConfig?.source || "env",
          error: err.message,
        });
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GLM API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function chatCompletionJSON<T>(
  messages: ChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
  }
): Promise<T> {
  const response = await withTimeout(
    () =>
      chatCompletion(messages, {
        ...options,
        responseFormat: { type: "json_object" },
      }),
    120_000, // 2 minute timeout for LLM calls
    "GLM chat completion"
  );

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as T;
}
