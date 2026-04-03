/**
 * BGM 风格预设和工具函数
 *
 * 当前不包含实际音乐文件，仅提供风格标签、音量建议和 ffmpeg 音频生成能力。
 * 后续可扩展为真正的音乐库。
 */

/** BGM 风格类型 */
export type BgmPreset = "suspense" | "romantic" | "comedy" | "scifi" | "horror" | "default";

/** BGM 风格标签（中文） */
export const BGM_PRESET_LABELS: Record<BgmPreset, string> = {
  suspense: "悬疑",
  romantic: "浪漫",
  comedy: "喜剧",
  scifi: "科幻",
  horror: "恐怖",
  default: "默认",
};

/** 各风格对应的推荐音量（0-1，占主音量的比例） */
export const BGM_VOLUME_MAP: Record<BgmPreset, number> = {
  suspense: 0.12,
  romantic: 0.18,
  comedy: 0.20,
  scifi: 0.15,
  horror: 0.10,
  default: 0.15,
};

/** 各风格对应的 ffmpeg 生成参数（简单环境音/音效） */
export const BGM_FFMPEG_PROFILES: Record<BgmPreset, { filter: string; description: string }> = {
  suspense: {
    filter: "sine=frequency=180:duration=60,lowpass=f=300,volume=0.3",
    description: "低沉正弦波环境音",
  },
  romantic: {
    filter: "sine=frequency=440:duration=60,lowpass=f=800,volume=0.2",
    description: "柔和正弦波音色",
  },
  comedy: {
    filter: "sine=frequency=523:duration=60,volume=0.15",
    description: "轻快正弦波音色",
  },
  scifi: {
    filter: "sine=frequency=120:duration=60,tremolo=f=8:d=0.5,volume=0.25",
    description: "电子颤音环境音",
  },
  horror: {
    filter: "sine=frequency=80:duration=60,tremolo=f=3:d=0.8,lowpass=f=200,volume=0.3",
    description: "极低频颤音环境音",
  },
  default: {
    filter: "anoisesrc=d=60:c=white:r=44100:a=0.05,lowpass=f=500,volume=0.3",
    description: "白噪音（低通滤波）",
  },
};

/**
 * 使用 ffmpeg 生成简单的背景音文件（非用户上传时的 fallback）。
 * 返回生成的文件路径。
 */
export async function generateBuiltInBgm(
  preset: BgmPreset,
  outputPath: string,
): Promise<string> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const profile = BGM_FFMPEG_PROFILES[preset];
  const cmd = `ffmpeg -f lavfi -i "${profile.filter}" -c:a libmp3lame -q:a 4 -y "${outputPath}"`;
  await execAsync(cmd, { timeout: 30000 });

  return outputPath;
}

/**
 * 根据剧集题材自动推断推荐的 BGM 风格。
 */
export function inferBgmPreset(genre?: string | null): BgmPreset {
  const map: Record<string, BgmPreset> = {
    "悬疑": "suspense",
    "爱情": "romantic",
    "喜剧": "comedy",
    "科幻": "scifi",
    "恐怖": "horror",
  };
  return (genre && map[genre]) || "default";
}
