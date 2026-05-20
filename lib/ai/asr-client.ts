import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "@/lib/logger";

const log = createLogger("asr-client");

const execAsync = promisify(exec);

const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const GLM_API_KEY = process.env.GLM_API_KEY || "";

/**
 * 智谱 GLM-ASR-2512 语音转文本
 * 限制：文件 ≤25MB，音频时长 ≤30秒
 */
export async function transcribeAudio(
  audioFilePath: string,
  options?: {
    hotwords?: string[]; // 热词，提升特定词汇识别率
    prompt?: string; // 上下文提示（之前的转录结果）
  }
): Promise<{
  text: string;
  model: string;
  id: string;
}> {
  if (!GLM_API_KEY) {
    throw new Error("GLM_API_KEY is not configured");
  }

  // Read file as buffer
  const fileBuffer = await fs.readFile(audioFilePath);
  const fileSizeMB = fileBuffer.length / (1024 * 1024);
  if (fileSizeMB > 25) {
    throw new Error(`Audio file too large: ${fileSizeMB.toFixed(1)}MB (max 25MB)`);
  }

  // Check duration
  const duration = await getAudioDuration(audioFilePath);
  if (duration > 30) {
    throw new Error(`Audio too long: ${duration}s (max 30s). Need to split first.`);
  }

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), path.basename(audioFilePath));
  formData.append("model", "glm-asr-2512");
  formData.append("stream", "false");

  if (options?.hotwords && options.hotwords.length > 0) {
    formData.append("hotwords", JSON.stringify(options.hotwords));
  }
  if (options?.prompt) {
    formData.append("prompt", options.prompt);
  }

  const response = await fetch(`${GLM_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ASR API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return {
    text: result.text || "",
    model: result.model || "glm-asr-2512",
    id: result.id || "",
  };
}

/**
 * 对长音频进行分段转录（每段 ≤30秒）
 * 用 ffmpeg 按静音分段，保持自然的句子边界
 */
export async function transcribeLongAudio(
  audioFilePath: string,
  options?: {
    hotwords?: string[];
    onSegment?: (index: number, text: string, startMs: number, endMs: number) => void;
  }
): Promise<{
  segments: { text: string; startMs: number; endMs: number }[];
  fullText: string;
}> {
  // Use ffmpeg to detect silence and split into segments
  const segments = await detectSilenceSegments(audioFilePath);
  if (segments.length === 0) {
    // No silence found, just transcribe the whole thing if ≤30s
    const duration = await getAudioDuration(audioFilePath);
    const result = await transcribeAudio(audioFilePath, options);
    return {
      segments: [{ text: result.text, startMs: 0, endMs: Math.round(duration * 1000) }],
      fullText: result.text,
    };
  }

  // Extract segments and transcribe each
  const results: { text: string; startMs: number; endMs: number }[] = [];
  const fullTexts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const tempPath = `/tmp/asr-seg-${Date.now()}-${i}.mp3`;

    try {
      await extractAudioSegment(audioFilePath, tempPath, seg.startMs / 1000, seg.durationMs / 1000);
      const segDuration = await getAudioDuration(tempPath);

      if (segDuration > 30) {
        // Segment still too long, split in half
        const mid = seg.startMs + seg.durationMs / 2;
        for (const [s, e] of [[seg.startMs, mid], [mid, seg.startMs + seg.durationMs]]) {
          const halfPath = `/tmp/asr-half-${Date.now()}-${results.length}.mp3`;
          try {
            await extractAudioSegment(audioFilePath, halfPath, s / 1000, (e - s) / 1000);
            const halfResult = await transcribeAudio(halfPath, {
              ...options,
              prompt: results.map(r => r.text).join(""),
            });
            results.push({ text: halfResult.text, startMs: s, endMs: e });
            fullTexts.push(halfResult.text);
            options?.onSegment?.(results.length, halfResult.text, s, e);
          } finally {
            await fs.unlink(halfPath).catch(() => {});
          }
        }
      } else {
        const result = await transcribeAudio(tempPath, {
          ...options,
          prompt: results.map(r => r.text).join(""),
        });
        results.push({ text: result.text, startMs: seg.startMs, endMs: seg.startMs + seg.durationMs });
        fullTexts.push(result.text);
        options?.onSegment?.(results.length, result.text, seg.startMs, seg.startMs + seg.durationMs);
      }
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  return {
    segments: results,
    fullText: fullTexts.join(""),
  };
}

/**
 * Check if GLM ASR is configured
 */
export function isAsrConfigured(): boolean {
  return !!GLM_API_KEY;
}

// ============ Helpers ============

interface SilenceSegment {
  startMs: number;
  durationMs: number;
}

/**
 * Detect silence segments in audio using ffmpeg silencedetect
 */
async function detectSilenceSegments(audioFilePath: string): Promise<SilenceSegment[]> {
  try {
    const { stdout } = await execAsync(
      `ffmpeg -i "${audioFilePath}" -af silencedetect=noise=-30dB:d=0.4 -f null - 2>&1 | grep "silence_"`,
      { timeout: 30000 }
    );

    // Parse ffmpeg silencedetect output
    // silence_start: 1.5
    // silence_end: 2.1 | silence_duration: 0.6
    const starts: number[] = [];
    const ends: number[] = [];
    const durations: number[] = [];

    const lines = stdout.split("\n");
    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      const durMatch = line.match(/silence_duration:\s*([\d.]+)/);

      if (startMatch) starts.push(parseFloat(startMatch[1]) * 1000);
      if (endMatch) ends.push(parseFloat(endMatch[1]) * 1000);
      if (durMatch) durations.push(parseFloat(durMatch[1]) * 1000);
    }

    // Build non-silence segments from silence boundaries
    const totalDuration = await getAudioDuration(audioFilePath) * 1000;
    const segments: SilenceSegment[] = [];

    // Segment from start to first silence
    let segStart = 0;
    for (let i = 0; i < starts.length; i++) {
      const segEnd = starts[i];
      const segDuration = segEnd - segStart;
      if (segDuration >= 300) { // Minimum 300ms to be worth transcribing
        segments.push({ startMs: segStart, durationMs: segDuration });
      }
      segStart = ends[i] || starts[i] + (durations[i] || 0);
    }

    // Last segment after final silence
    if (segStart < totalDuration) {
      const segDuration = totalDuration - segStart;
      if (segDuration >= 300) {
        segments.push({ startMs: segStart, durationMs: segDuration });
      }
    }

    return segments;
  } catch (error) {
    log.warn("Silence detection failed", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Extract a segment of audio to a temp file
 */
async function extractAudioSegment(
  inputPath: string,
  outputPath: string,
  startTimeSec: number,
  durationSec: number
): Promise<void> {
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -ss ${startTimeSec} -t ${durationSec} -acodec libmp3lame -q:a 4 "${outputPath}"`,
    { timeout: 15000 }
  );
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}
