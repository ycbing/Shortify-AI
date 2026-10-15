// CosyVoice TTS - 阿里百炼语音合成（HTTP 非流式）
// 文档: https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api
// 注意: CosyVoice 仅在百炼华北2（北京）地域可用；复用 DASHSCOPE_API_KEY
import { createLogger } from "@/lib/logger";
import { DASHSCOPE_BASE_URL, COSYVOICE_MODEL } from "@/lib/ai/cosyvoice-constants";

const log = createLogger("cosyvoice-tts");

const TTS_URL = `${DASHSCOPE_BASE_URL}/api/v1/services/audio/tts/SpeechSynthesizer`;

/** 默认音色（龙婉，温柔女声） */
const DEFAULT_VOICE = "longwan";

/**
 * 语义角色 → CosyVoice 系统音色映射。
 * 键为现有 Edge-TTS voiceId（types/drama.ts VOICE_OPTIONS），保证老数据无缝切换。
 * 复刻音色（cosyvoice-v2-xxx）不受此映射影响，直接透传。
 */
const COSYVOICE_VOICE_MAP: Record<string, string> = {
  "zh-CN-YunxiNeural": "longcheng", // 男声-年轻 → 龙橙（阳光男声）
  "zh-CN-YunjianNeural": "longhua", // 男声-中年 → 龙华（纪录片男声）
  "zh-CN-XiaoxiaoNeural": "longwan", // 女声-年轻 → 龙婉（温柔女声）
  "zh-CN-XiaomengNeural": "longxiaochun", // 女声-中年 → 龙小淳
  "zh-CN-YunyangNeural": "longshu", // 旁白 → 龙书（阅读男声）
};

export interface CosyVoiceOptions {
  /** 音色：系统音色或声音复刻生成的音色 ID */
  voice?: string;
  /** 自然语言指令，控制情感/方言/角色等，如 "用紧张的语气" */
  instruction?: string;
  /** 音频格式，默认 mp3 */
  format?: "mp3" | "wav";
  /** 模型名，默认 COSYVOICE_MODEL 环境变量或 cosyvoice-v2 */
  model?: string;
}

export function isCosyVoiceConfigured(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

/** 将现有 voiceId（Edge 体系）转换为 CosyVoice 音色；CosyVoice 音色原样透传 */
export function toCosyVoiceVoice(voiceId?: string): string {
  if (!voiceId) return DEFAULT_VOICE;
  // 已是 CosyVoice 体系音色（系统音色 long*/loong* 或复刻音色 cosyvoice-*）
  if (/^(long|loong|cosyvoice-)/.test(voiceId)) return voiceId;
  return COSYVOICE_VOICE_MAP[voiceId] || DEFAULT_VOICE;
}

/** CosyVoice 音色 → Edge 音色反向映射（降级到讯飞/Edge-TTS 时使用） */
const EDGE_VOICE_REVERSE_MAP: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(COSYVOICE_VOICE_MAP).map(([edge, cosy]) => [cosy, edge])
  ),
  // 新音色池中无 legacy 对应的女声，统一降级为 Edge 女声-年轻
  longxiaochun: "zh-CN-XiaoxiaoNeural",
  longxiaoxia: "zh-CN-XiaoxiaoNeural",
  loongbella: "zh-CN-XiaoxiaoNeural",
};

const NARRATION_FALLBACK = "zh-CN-YunyangNeural";

export function toEdgeVoice(voiceId?: string): string {
  if (!voiceId) return NARRATION_FALLBACK;
  if (voiceId.startsWith("zh-CN-")) return voiceId; // 已是 Edge 音色
  if (voiceId.startsWith("cosyvoice-")) return "zh-CN-XiaoxiaoNeural"; // 复刻音色无对应 Edge 音色，降级女声
  return EDGE_VOICE_REVERSE_MAP[voiceId] || NARRATION_FALLBACK;
}

/** 情感标签 → 自然语言指令（如 "紧张" → "用紧张的语气"） */
export function buildEmotionInstruction(emotion?: string): string | undefined {
  if (!emotion) return undefined;
  const e = emotion.trim().slice(0, 12);
  if (!e) return undefined;
  return `用${e}的语气`;
}

interface CosyVoiceResponse {
  output?: {
    audio?: {
      url?: string;
      data?: string; // base64
    };
    message?: string;
  };
  request_id?: string;
}

/**
 * CosyVoice 语音合成（非流式）：返回音频 URL 或 base64，写入本地文件
 */
export async function cosyVoiceTts(
  text: string,
  outputPath: string,
  options?: CosyVoiceOptions
): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");
  if (!text.trim()) throw new Error("CosyVoice TTS: text is empty");

  const body = {
    model: options?.model || COSYVOICE_MODEL,
    input: {
      text: text.slice(0, 2000), // 非流式有长度限制，超长文本由上游分镜保证
      voice: options?.voice || DEFAULT_VOICE,
      format: options?.format || "mp3",
      ...(options?.instruction ? { instruction: options.instruction } : {}),
    },
  };

  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CosyVoice TTS error: ${response.status} - ${error.substring(0, 200)}`);
  }

  const result: CosyVoiceResponse = await response.json();
  const audioUrl = result.output?.audio?.url;
  const audioData = result.output?.audio?.data;

  let buffer: Buffer | null = null;
  if (audioUrl) {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) {
      throw new Error(`CosyVoice audio download failed: ${audioResp.status}`);
    }
    buffer = Buffer.from(await audioResp.arrayBuffer());
  } else if (audioData) {
    buffer = Buffer.from(audioData, "base64");
  } else {
    throw new Error(
      `CosyVoice TTS: no audio in response: ${JSON.stringify(result).substring(0, 200)}`
    );
  }

  if (!buffer || buffer.length < 512) {
    throw new Error(`CosyVoice TTS: audio too small (${buffer?.length ?? 0} bytes)`);
  }

  const { writeFile, mkdir } = await import("fs/promises");
  const path = await import("path");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);

  log.info("CosyVoice TTS done", {
    model: body.model,
    voice: body.input.voice,
    instruction: options?.instruction || "-",
    bytes: buffer.length,
  });
}
