// 声音复刻（Voice Cloning / Enrollment）- 阿里百炼
// 文档: https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide
// 10~20 秒样本音频（公网可访问 URL）→ 专属音色 ID（cosyvoice-v2-xxx）
// 复刻音色可直接传给 cosyVoiceTts 的 voice 参数（toCosyVoiceVoice 会透传）
import { createHash } from "crypto";
import { createLogger } from "@/lib/logger";
import { DASHSCOPE_BASE_URL, COSYVOICE_MODEL } from "@/lib/ai/cosyvoice-constants";

const log = createLogger("cosyvoice-clone");

const ENROLLMENT_URL = `${DASHSCOPE_BASE_URL}/api/v1/uploads/voice_enrollment`;

export function isVoiceCloneSupported(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

interface EnrollmentResponse {
  output?: {
    voice_id?: string;
    message?: string;
  };
  request_id?: string;
}

/**
 * 注册复刻音色，返回音色 ID（可直接用作 TTS voice）
 * @param sampleUrl 样本音频公网 URL（10~20 秒，16bit/单声道效果最佳）
 * @param prefix 音色前缀，仅限小写字母/数字（≤10 字符），如 "d3f2a1b"
 */
export async function enrollVoice(
  sampleUrl: string,
  prefix: string
): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");

  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "shortify";

  const response = await fetch(ENROLLMENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "voice-enrollment",
      input: {
        action: "create",
        target_model: COSYVOICE_MODEL,
        prefix: safePrefix,
        url: sampleUrl,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voice enrollment error: ${response.status} - ${error.substring(0, 200)}`);
  }

  const result: EnrollmentResponse = await response.json();
  const voiceId = result.output?.voice_id;
  if (!voiceId) {
    throw new Error(
      `Voice enrollment: no voice_id: ${JSON.stringify(result).substring(0, 200)}`
    );
  }

  log.info("Voice enrolled", { prefix: safePrefix, voiceId });
  return voiceId;
}

/**
 * 生成符合接口要求的 prefix（小写字母数字，≤10 字符）
 * 同一 dramaId+角色名的 prefix 稳定，便于追踪与去重
 */
export function voiceEnrollPrefix(dramaId: string, characterName: string): string {
  const hash = createHash("md5").update(`${dramaId}:${characterName}`).digest("hex");
  return `d${hash.slice(0, 8)}`;
}
