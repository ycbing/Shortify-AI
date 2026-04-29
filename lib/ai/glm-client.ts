// GLM API Client (智谱)
import { withRetry, withTimeout } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";

const log = createLogger("glm-client");
const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const GLM_API_KEY = process.env.GLM_API_KEY || "";

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
  }
): Promise<GLMResponse> {
  const model = options?.model || "glm-4-flash";

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
  };

  if (options?.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await withRetry(
    () =>
      fetch(`${GLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GLM_API_KEY}`,
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
