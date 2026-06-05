// @ts-nocheck
/**
 * Universal ASR entry point.
 * Priority: Xunfei (Chinese best) → GLM (fallback)
 * Groq removed (not accessible in China).
 */
import { isAsrConfigured as isGlmAsrConfigured, transcribeAudio as glmTranscribeAudio } from "@/lib/ai/asr-client";
import { isXunfeiAsrConfigured, transcribeWithXunfei } from "@/lib/ai/xunfei-asr";
import { createLogger } from "@/lib/logger";

const log = createLogger("universal-asr");

/**
 * Universal ASR: try Xunfei first, then GLM.
 * Main entry point for ASR in the application.
 */
export async function transcribeAudioUniversal(
  audioFilePath: string,
  options?: {
    language?: string;
    hotwords?: string[];
    prompt?: string;
    wordTimestamps?: boolean;
  }
): Promise<{
  text: string;
  segments: {
    id: number;
    start: number;
    end: number;
    text: string;
    words?: { word: string; start: number; end: number; probability: number }[];
  }[];
  words?: { word: string; start: number; end: number; probability: number }[];
  duration?: number;
  model: string;
  provider: "xunfei" | "glm";
}> {
  // Priority 1: Xunfei (best Chinese, domestic, already configured)
  if (isXunfeiAsrConfigured()) {
    try {
      const xunfeiLang = options?.language === "en" ? "en_us" : "zh_cn";
      const result = await transcribeWithXunfei(audioFilePath, {
        language: xunfeiLang,
      });
      return {
        text: result.text,
        segments: result.segments.map((seg, i) => ({
          id: i,
          start: seg.startMs / 1000,
          end: seg.endMs / 1000,
          text: seg.text,
        })),
        duration: result.duration,
        model: "xunfei-iat",
        provider: "xunfei",
      };
    } catch (err) {
      log.warn("Xunfei ASR failed, trying next provider", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Priority 2: GLM ASR (fallback)
  if (isGlmAsrConfigured()) {
    const result = await glmTranscribeAudio(audioFilePath, {
      hotwords: options?.hotwords,
      prompt: options?.prompt,
    });
    return {
      text: result.text,
      segments: [],
      model: result.model,
      provider: "glm",
    };
  }

  throw new Error(
    "No ASR service configured. Set XUNFEI_APPID/KEY/SECRET or GLM_API_KEY."
  );
}

/**
 * Check if any ASR is available
 */
export function isAnyAsrConfigured(): boolean {
  return isXunfeiAsrConfigured() || isGlmAsrConfigured();
}
