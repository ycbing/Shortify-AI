/**
 * AI BGM 生成器
 * 
 * 通用接口，通过 resolveConfig 路由到不同音乐生成服务：
 * - suno → Suno API（用户自带 Key）
 * - fallback → ffmpeg 环境音增强（免费）
 * 
 * 后续可扩展：讯飞音乐、LibLib 音乐等
 */

import { createLogger } from "@/lib/logger";
import { resolveConfig } from "@/lib/ai/model-resolver";
import { generateBuiltInBgm, inferBgmPreset, type BgmPreset } from "./bgm-library";
import fs from "fs/promises";
import path from "path";

const log = createLogger("bgm-generator");

export interface BgmGenerationOptions {
  /** 剧情描述/提示词，用于 AI 音乐生成 */
  prompt?: string;
  /** 音乐风格标签 */
  style?: string;
  /** 音乐时长（秒），默认 60 */
  duration?: number;
  /** 题材（悬疑/爱情/喜剧等），用于推断风格 */
  genre?: string;
  /** 用户 ID，用于 resolveConfig */
  userId?: string;
}

interface BgmResult {
  /** 生成的 BGM 文件本地路径 */
  filePath: string;
  /** 使用的 provider */
  provider: string;
  /** BGM 时长（秒） */
  duration: number;
}

/**
 * 根据 shot 级别的 bgm 标签，推断整集的主 BGM 风格
 */
export function inferEpisodeBgmStyle(
  shots: Array<{ bgm?: string; type?: string; character?: string; line?: string; subtitle?: string }>,
  genre?: string | null
): { prompt: string; style: string; preset: BgmPreset } {
  // 统计每个镜头的 bgm 标签出现频率
  const bgmCounts: Record<string, number> = {};
  let narrativeText = "";

  for (const shot of shots) {
    if (shot.bgm) {
      bgmCounts[shot.bgm] = (bgmCounts[shot.bgm] || 0) + 1;
    }
    // 收集旁白/字幕文本用于构建 prompt
    if (shot.subtitle) narrativeText += shot.subtitle + " ";
    if (shot.type === "dialogue" && shot.line) narrativeText += shot.line + " ";
  }

  // 找出最频繁的 bgm 标签
  const topBgm = Object.entries(bgmCounts).sort((a, b) => b[1] - a[1])[0];
  const style = topBgm ? topBgm[0] : inferBgmPreset(genre || undefined);
  const preset = style as BgmPreset;

  // 截取前 100 字剧情文本作为 prompt
  const promptText = narrativeText.trim().substring(0, 100);

  return {
    prompt: promptText,
    style,
    preset,
  };
}

/**
 * 生成 BGM 音频文件
 * 优先使用 AI 音乐 API，降级到 ffmpeg 环境音
 */
export async function generateBgm(
  outputPath: string,
  options: BgmGenerationOptions = {}
): Promise<BgmResult> {
  const { prompt, style, duration = 60, genre, userId } = options;

  // 尝试从模型配置解析音乐服务
  let provider = "fallback";
  try {
    const config = await resolveConfig(userId || null, "video").catch(() => null);
    // 暂时复用 video provider 来判断是否有外部音乐服务
    // 后续可以加独立的 "music" 服务类型
    if (config?.provider === "suno") {
      provider = "suno";
    }
  } catch {
    // ignore
  }

  switch (provider) {
    case "suno":
      return generateBgmWithSuno(outputPath, { prompt, style, duration });
    case "fallback":
    default:
      return generateBgmWithFallback(outputPath, { style, duration, genre });
  }
}

// ==================== Suno 适配器 ====================

async function generateBgmWithSuno(
  outputPath: string,
  options: { prompt?: string; style?: string; duration?: number }
): Promise<BgmResult> {
  const config = await resolveConfig(null, "video").catch(() => null);
  const apiKey = config?.apiKey || process.env.SUNO_API_KEY || "";
  const baseUrl = (config?.baseUrl || process.env.SUNO_BASE_URL || "https://api.suno.ai").replace(/\/$/, "");

  if (!apiKey) {
    log.warn("Suno API key not configured, falling back to built-in BGM");
    return generateBgmWithFallback(outputPath, options);
  }

  // 构建音乐生成 prompt
  const styleMap: Record<string, string> = {
    suspense: "suspenseful, dark, tense, cinematic background music, instrumental",
    romantic: "romantic, gentle, emotional, soft piano, string instruments, love theme",
    comedy: "upbeat, cheerful, playful, lighthearted, quirky, fun background music",
    scifi: "futuristic, electronic, ambient, synth pads, space atmosphere",
    horror: "dark, eerie, atmospheric, ominous, dissonant, suspenseful",
    dramatic: "epic, cinematic, orchestral, powerful, intense",
    calm: "peaceful, serene, ambient, gentle, relaxing",
    happy: "uplifting, joyful, bright, optimistic, warm",
    default: "cinematic background music, instrumental, versatile",
  };

  const musicStyle = styleMap[options.style || "default"] || styleMap.default;
  const fullPrompt = `${musicStyle}${options.prompt ? `, inspired by: ${options.prompt}` : ""}`;

  // Suno v1 API: POST /api/open/v1/generate
  log.info("Generating BGM with Suno", { style: options.style, promptLength: fullPrompt.length });

  const submitBody: Record<string, unknown> = {
    prompt: fullPrompt,
    make_instrumental: true,
    duration: Math.min(options.duration || 60, 120), // Suno max ~4 min
  };

  const submitRes = await fetch(`${baseUrl}/api/open/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(submitBody),
  });

  if (!submitRes.ok) {
    const errorText = await submitRes.text();
    log.warn(`Suno submit failed (${submitRes.status}), falling back: ${errorText}`);
    return generateBgmWithFallback(outputPath, options);
  }

  const submitData = await submitRes.json();
  // Suno 返回格式可能是 { id: "xxx" } 或 { songs: [...] }
  const taskId = submitData.id || submitData.task_id;

  if (!taskId) {
    // 可能直接返回音频 URL
    if (submitData.audio_url || submitData.audioUrl) {
      const audioUrl = submitData.audio_url || submitData.audioUrl;
      return downloadBgm(audioUrl, outputPath, "suno", options.duration || 60);
    }
    log.warn("Suno returned no task ID or audio URL, falling back");
    return generateBgmWithFallback(outputPath, options);
  }

  // 轮询等待完成
  const audioUrl = await pollSunoTask(taskId, baseUrl, apiKey);
  return downloadBgm(audioUrl, outputPath, "suno", options.duration || 60);
}

async function pollSunoTask(taskId: string, baseUrl: string, apiKey: string): Promise<string> {
  const maxPolls = 60; // 5 分钟（每次 5 秒）
  const pollInterval = 5000;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetch(`${baseUrl}/api/open/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) continue;

    const data = await res.json();
    const status = data.status || data.task_status;

    if (status === "completed" || status === "COMPLETED" || status === "success") {
      // 音频 URL 可能在不同字段
      const url = data.audio_url || data.audioUrl || data.output?.audio_url || "";
      if (url) return url;
    }

    if (status === "failed" || status === "FAILED") {
      throw new Error(`Suno generation failed: ${data.error || data.message || "Unknown error"}`);
    }
  }

  throw new Error("Suno generation timed out");
}

// ==================== Fallback：ffmpeg 环境音增强 ====================

async function generateBgmWithFallback(
  outputPath: string,
  options: { style?: string; duration?: number; genre?: string }
): Promise<BgmResult> {
  const preset = (options.style || inferBgmPreset(options.genre || undefined)) as BgmPreset;
  const duration = options.duration || 60;

  log.info("Generating built-in BGM with ffmpeg", { preset, duration });

  // 确保输出目录存在
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await generateBuiltInBgm(preset, outputPath);

  return {
    filePath: outputPath,
    provider: "fallback",
    duration,
  };
}

// ==================== 通用下载 ====================

async function downloadBgm(
  url: string,
  outputPath: string,
  provider: string,
  expectedDuration: number
): Promise<BgmResult> {
  log.info("Downloading BGM", { provider, url: url.substring(0, 60) });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download BGM: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);

  return {
    filePath: outputPath,
    provider,
    duration: expectedDuration,
  };
}
