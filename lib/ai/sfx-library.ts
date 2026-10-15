// SFX 音效库：LLM 打标签 → 解析音效文件 → 混入镜头配音
// 三级来源：① 用户自备库 uploads/sfx-library/{tag}.*（优先）
//          ② 内置 ffmpeg 合成预设（环境氛围类，缓存于 uploads/sfx-cache/）
//          ③ 解析失败 → 静默跳过
// 音效作为一层垫在配音下方，后续 Ken Burns 合成与 AI 视频混音自动继承，无需改动合成器
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { createLogger } from "@/lib/logger";

const log = createLogger("sfx-library");

const execAsync = promisify(exec);

const SFX_VOLUME = Number(process.env.SFX_VOLUME || "0.2");
const PRESET_DURATION_SEC = 30; // 预设音效生成时长，混音时按配音时长循环裁剪

/** 内置合成预设：环境氛围类音效（ffmpeg 滤镜合成，无版权问题） */
const SFX_PRESETS: Record<string, { label: string; filter: string }> = {
  rain: {
    label: "雨声",
    filter: `anoisesrc=d=${PRESET_DURATION_SEC}:c=pink:a=0.6,highpass=f=400,lowpass=f=7000,volume=0.8`,
  },
  wind: {
    label: "风声",
    filter: `anoisesrc=d=${PRESET_DURATION_SEC}:c=brown:a=0.7,lowpass=f=600,tremolo=f=0.3:d=0.7`,
  },
  thunder: {
    label: "雷声",
    filter: `anoisesrc=d=${PRESET_DURATION_SEC}:c=brown:a=0.9,lowpass=f=200,tremolo=f=0.25:d=0.9,volume=0.9`,
  },
  fire: {
    label: "火焰",
    filter: `anoisesrc=d=${PRESET_DURATION_SEC}:c=pink:a=0.5,highpass=f=1200,lowpass=f=6000,tremolo=f=8:d=0.8`,
  },
  water: {
    label: "水流",
    filter: `anoisesrc=d=${PRESET_DURATION_SEC}:c=pink:a=0.55,bandpass=f=2000:w=1500,tremolo=f=4:d=0.5`,
  },
  heartbeat: {
    label: "心跳",
    filter: `sine=f=52:d=${PRESET_DURATION_SEC},tremolo=f=1.1:d=0.95,volume=0.9`,
  },
  clock: {
    label: "钟表滴答",
    filter: `sine=f=900:d=${PRESET_DURATION_SEC},tremolo=f=2:d=1,volume=0.5`,
  },
  tension: {
    label: "紧张低频",
    filter: `sine=f=45:d=${PRESET_DURATION_SEC},volume=0.7`,
  },
  traffic: {
    label: "街道车流",
    filter: `anoisesrc=d=${PRESET_DURATION_SEC}:c=brown:a=0.6,lowpass=f=350,tremolo=f=0.5:d=0.4`,
  },
};

/** 标签别名归一化（LLM 可能输出近义词） */
const TAG_ALIASES: Record<string, string> = {
  rainy: "rain", 雨: "rain", 下雨: "rain",
  风: "wind", 刮风: "wind", 大风: "wind",
  雷: "thunder", 打雷: "thunder", 雷雨: "thunder",
  火焰: "fire", 燃烧: "fire", 篝火: "fire",
  水: "water", 河流: "water", 溪水: "water", 水声: "water",
  心跳: "heartbeat", 心声: "heartbeat",
  时钟: "clock", 滴答: "clock", 秒针: "clock",
  紧张: "tension", 低频: "tension", 压迫: "tension", 悬疑: "tension",
  车流: "traffic", 街道: "traffic", 城市: "traffic", 马路: "traffic",
};

const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || "./uploads");

/** 解析标签串 → 归一化标签数组（最多取 3 个） */
export function parseSfxTags(sfx?: string): string[] {
  if (!sfx) return [];
  return sfx
    .split(/[,，;；、\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => TAG_ALIASES[t] || t)
    .slice(0, 3);
}

/** 内置预设合成（带缓存），返回文件路径；失败返回 null */
async function synthesizePreset(tag: string): Promise<string | null> {
  const preset = SFX_PRESETS[tag];
  if (!preset) return null;

  const cacheDir = path.join(uploadDir(), "sfx-cache");
  const cachePath = path.join(cacheDir, `${tag}.mp3`);
  try {
    await fs.access(cachePath);
    return cachePath; // 已缓存
  } catch {
    // 首次生成
  }

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await execAsync(
      `ffmpeg -y -f lavfi -i "${preset.filter}" -c:a libmp3lame -q:a 5 "${cachePath}"`,
      { timeout: 30000 }
    );
    log.info("SFX preset synthesized", { tag, label: preset.label });
    return cachePath;
  } catch (err) {
    log.warn("SFX preset synthesis failed", {
      tag,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 解析标签 → 实际音效文件：
 * ① 用户库 uploads/sfx-library/{tag}.{mp3,wav,ogg,m4a}
 * ② 内置合成预设
 * 都没有则返回 null（调用方静默跳过）
 */
export async function resolveSfxFile(tags: string[]): Promise<string | null> {
  const userLibDir = path.join(uploadDir(), "sfx-library");
  for (const tag of tags) {
    // 用户自备库优先（同名 tag 任意音频格式）
    for (const ext of [".mp3", ".wav", ".ogg", ".m4a"]) {
      try {
        const p = path.join(userLibDir, `${tag}${ext}`);
        await fs.access(p);
        return p;
      } catch {
        // not found
      }
    }
    // 内置合成
    const synthesized = await synthesizePreset(tag);
    if (synthesized) return synthesized;
  }
  return null;
}

async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
  );
  return parseFloat(stdout.trim()) || 0;
}

/**
 * 将音效垫到配音下方（循环铺满配音时长，头尾淡入淡出），覆盖原配音文件。
 * 失败时保留原配音（宁可没音效也不能没台词）。
 */
export async function mixSfxIntoVoiceover(
  voiceoverPath: string,
  sfxTags: string[]
): Promise<boolean> {
  if (!sfxTags.length) return false;
  try {
    const sfxFile = await resolveSfxFile(sfxTags);
    if (!sfxFile) {
      log.info("No resolvable sfx file, skipping", { tags: sfxTags });
      return false;
    }

    const duration = await getAudioDuration(voiceoverPath);
    if (duration <= 0) return false;

    const fade = Math.min(0.5, duration * 0.15);
    const tmpPath = voiceoverPath.replace(/\.mp3$/, ".sfx-tmp.mp3");
    // 配音 -stream_loop 循环音效；amix 权重：配音 1.0 / 音效 SFX_VOLUME
    const cmd =
      `ffmpeg -y -i "${voiceoverPath}" -stream_loop -1 -i "${sfxFile}" ` +
      `-filter_complex "[1:a]volume=${SFX_VOLUME},afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(0, duration - fade).toFixed(2)}:d=${fade}[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0,apad=whole_dur=${duration.toFixed(2)}[out]" ` +
      `-map "[out]" -t ${duration.toFixed(2)} -c:a libmp3lame -q:a 4 "${tmpPath}"`;
    await execAsync(cmd, { timeout: 60000 });

    await fs.unlink(voiceoverPath).catch(() => {});
    await fs.rename(tmpPath, voiceoverPath);
    log.info("SFX mixed into voiceover", { tags: sfxTags, duration });
    return true;
  } catch (err) {
    log.warn("SFX mix failed, keeping plain voiceover", {
      tags: sfxTags,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
