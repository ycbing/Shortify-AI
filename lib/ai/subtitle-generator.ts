import path from "path";
import fs from "fs/promises";
import type { Shot, ShotAudio } from "@/types/drama";
import { transcribeAudio, isAsrConfigured } from "@/lib/ai/asr-client";

// ============ Mode: generateSubtitles (基于文本+时长的传统模式) ============

/**
 * Generate SRT subtitle file from shots and their audio durations.
 * 使用 ffprobe 获取的实际音频时长来计算精确时间轴。
 */
export async function generateSubtitles(
  shots: Shot[],
  shotAudios: ShotAudio[],
  dramaId: string,
  episodeNumber: number
): Promise<string> {
  const outputDir = path.join(
    process.env.UPLOAD_DIR || "./uploads",
    "subtitles",
    dramaId
  );
  const outputPath = path.join(outputDir, `episode-${episodeNumber}.srt`);

  await fs.mkdir(outputDir, { recursive: true });

  // Build a map from shotNumber to audio info
  const audioMap = new Map<number, ShotAudio>();
  for (const audio of shotAudios) {
    audioMap.set(audio.shotNumber, audio);
  }

  // Calculate timing
  let currentTimeMs = 0;
  const srtEntries: string[] = [];

  for (const shot of shots) {
    const audio = audioMap.get(shot.shotNumber);
    const durationMs = audio ? Math.round(audio.duration * 1000) : (shot.duration || 5) * 1000;

    const startTime = formatSrtTime(currentTimeMs);
    const endTime = formatSrtTime(currentTimeMs + durationMs);

    // Determine subtitle text
    let text: string;
    if (shot.type === "dialogue" && shot.character && shot.line) {
      text = shot.character + "：" + shot.line;
    } else if (shot.subtitle) {
      text = shot.subtitle;
    } else if (shot.line) {
      text = shot.character ? shot.character + "：" + shot.line : shot.line;
    } else {
      text = "";
    }

    if (text.trim()) {
      // Long text → split into multiple subtitle lines for better readability
      const lines = splitSubtitleText(text, durationMs);
      for (const line of lines) {
        const entryNum = srtEntries.length + 1;
        srtEntries.push(`${entryNum}\n${line.start} --> ${line.end}\n${line.text}`);
      }
    }

    currentTimeMs += durationMs;
  }

  const srtContent = srtEntries.join("\n\n") + "\n";
  await fs.writeFile(outputPath, srtContent, "utf-8");

  return outputPath;
}

// ============ Mode: generateSubtitlesWithASR (ASR 精排模式) ============

export interface ASRSubtitleResult {
  subtitlePath: string;
  qualityReport: {
    totalShots: number;
    matched: number;     // ASR 文本与原始文本匹配
    mismatched: number;  // 有差异（可能 TTS 漏字/错字）
    details: {
      shotNumber: number;
      originalText: string;
      asrText: string;
      match: boolean;
      diff: string; // 简要描述差异
    }[];
  };
}

/**
 * ASR 精排字幕生成模式：
 * 1. 从每个 shot 的配音音频进行 ASR 识别
 * 2. 将 ASR 识别文本与原始台词对比（质量检测）
 * 3. 基于 ASR 识别的文本生成更准确的字幕
 * 4. 使用原始文本（因为 ASR 可能误识别专有名词），但标注质量
 */
export async function generateSubtitlesWithASR(
  shots: Shot[],
  shotAudios: ShotAudio[],
  dramaId: string,
  episodeNumber: number
): Promise<ASRSubtitleResult> {
  const outputDir = path.join(
    process.env.UPLOAD_DIR || "./uploads",
    "subtitles",
    dramaId
  );
  const outputPath = path.join(outputDir, `episode-${episodeNumber}.srt`);

  await fs.mkdir(outputDir, { recursive: true });

  if (!isAsrConfigured()) {
    throw new Error("ASR not configured. Set GLM_API_KEY in environment.");
  }

  // Build audio map
  const audioMap = new Map<number, ShotAudio>();
  for (const audio of shotAudios) {
    audioMap.set(audio.shotNumber, audio);
  }

  // Collect character names as hotwords for better recognition
  const characterNames = [...new Set(
    shots.filter(s => s.character).map(s => s.character!)
  )];

  let currentTimeMs = 0;
  const srtEntries: string[] = [];
  const qualityDetails: ASRSubtitleResult["qualityReport"]["details"] = [];
  let matched = 0;
  let mismatched = 0;

  for (const shot of shots) {
    const audio = audioMap.get(shot.shotNumber);
    const durationMs = audio ? Math.round(audio.duration * 1000) : (shot.duration || 5) * 1000;

    // Original text for this shot
    let originalText: string;
    if (shot.type === "dialogue" && shot.line) {
      originalText = shot.character ? shot.character + "：" + shot.line : shot.line;
    } else if (shot.subtitle) {
      originalText = shot.subtitle;
    } else if (shot.line) {
      originalText = shot.character ? shot.character + "：" + shot.line : shot.line;
    } else {
      originalText = "";
    }

    // Try ASR recognition if audio file exists
    let asrText = "";
    if (audio?.audioUrl) {
      try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        try {
          await fs.access(audio.audioUrl);
          const result = await transcribeAudio(audio.audioUrl, {
            hotwords: characterNames,
          });
          asrText = result.text.trim();
        } catch {
          // Audio file doesn't exist, skip ASR
        }
      } catch {
        // ASR failed, continue with original text
      }
    }

    // Quality check: compare ASR text with original
    if (asrText && originalText) {
      const normalizedOriginal = originalText.replace(/[，。！？、：；""''（）《》\s]/g, "");
      const normalizedAsr = asrText.replace(/[，。！？、：；""''（）《》\s]/g, "");
      const isMatch = normalizedOriginal === normalizedAsr || 
        normalizedAsr.includes(normalizedOriginal) ||
        normalizedOriginal.includes(normalizedAsr);
      
      let diff = "";
      if (!isMatch) {
        // Simple diff: find characters in original but not in ASR (potential omissions)
        const missing = [...normalizedOriginal].filter(c => !normalizedAsr.includes(c));
        const extra = [...normalizedAsr].filter(c => !normalizedOriginal.includes(c));
        if (missing.length > 0) diff += `缺少: ${missing.join("")}`;
        if (extra.length > 0) diff += `${diff ? " | " : ""}多余: ${extra.join("")}`;
        mismatched++;
      } else {
        matched++;
      }

      qualityDetails.push({
        shotNumber: shot.shotNumber,
        originalText,
        asrText,
        match: isMatch,
        diff,
      });
    } else {
      // ASR unavailable — don't count as matched (quality check not performed)
      qualityDetails.push({
        shotNumber: shot.shotNumber,
        originalText,
        asrText: "(ASR未执行)",
        match: false,
        diff: "ASR未执行，跳过质量检查",
      });
    }

    // Generate subtitle entry using original text (more accurate for names/terms)
    // but split long text into multiple lines based on duration
    if (originalText.trim()) {
      const lines = splitSubtitleText(originalText, durationMs);
      for (const line of lines) {
        const entryNum = srtEntries.length + 1;
        srtEntries.push(`${entryNum}\n${line.start} --> ${line.end}\n${line.text}`);
      }
    }

    currentTimeMs += durationMs;
  }

  const srtContent = srtEntries.join("\n\n") + "\n";
  await fs.writeFile(outputPath, srtContent, "utf-8");

  return {
    subtitlePath: outputPath,
    qualityReport: {
      totalShots: shots.length,
      matched,
      mismatched,
      details: qualityDetails,
    },
  };
}

// ============ Helpers ============

interface SubtitleLine {
  start: string;
  end: string;
  text: string;
}

/**
 * Split long subtitle text into multiple lines based on duration.
 * Rule: max ~15 chars per subtitle, max ~4 seconds per subtitle.
 */
function splitSubtitleText(text: string, durationMs: number): SubtitleLine[] {
  const maxCharsPerLine = 20;
  const maxMsPerLine = 5000;
  const minMsPerLine = 1500;

  const cleaned = text.replace(/（[^）]+）/g, "").trim();

  if (cleaned.length <= maxCharsPerLine && durationMs <= maxMsPerLine) {
    return [{ start: formatSrtTime(0), end: formatSrtTime(durationMs), text: cleaned }];
  }

  const lines: SubtitleLine[] = [];
  const chars = [...cleaned];
  let pos = 0;
  let timePos = 0;

  while (pos < chars.length && timePos < durationMs - 200) {
    const remaining = chars.length - pos;
    const remainingTime = durationMs - timePos;

    if (remaining <= maxCharsPerLine || remainingTime <= maxMsPerLine) {
      lines.push({
        start: formatSrtTime(timePos),
        end: formatSrtTime(durationMs),
        text: chars.slice(pos).join(""),
      });
      break;
    }

    // At most half the remaining chars, at most maxCharsPerLine
    const charsForThisLine = Math.min(maxCharsPerLine, Math.ceil(remaining / 2));

    // Break at punctuation when possible
    let breakPos = pos + charsForThisLine;
    const searchEnd = Math.min(pos + charsForThisLine + 5, chars.length);
    for (let i = searchEnd - 1; i >= pos + Math.max(4, charsForThisLine - 8); i--) {
      if ("，。！？、；：".includes(chars[i])) {
        breakPos = i + 1;
        break;
      }
    }

    const segChars = breakPos - pos;
    const lineDuration = Math.round(
      Math.min(maxMsPerLine, Math.max(minMsPerLine, durationMs * segChars / chars.length))
    );

    const endMs = Math.min(timePos + lineDuration, durationMs);

    lines.push({
      start: formatSrtTime(timePos),
      end: formatSrtTime(endMs),
      text: chars.slice(pos, breakPos).join(""),
    });

    timePos = endMs;
    pos = breakPos;
  }

  // Ensure last line reaches exact duration
  if (lines.length > 0) {
    lines[lines.length - 1].end = formatSrtTime(durationMs);
  }

  return lines;
}

/**
 * Format milliseconds to SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(millis).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
