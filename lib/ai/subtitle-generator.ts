import path from "path";
import fs from "fs/promises";
import type { Shot, ShotAudio } from "@/types/drama";

/**
 * Generate SRT subtitle file from shots and their audio durations.
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
      text = `${shot.character}: ${shot.line}`;
    } else if (shot.subtitle) {
      text = shot.subtitle;
    } else if (shot.line) {
      text = shot.character ? `${shot.character}: ${shot.line}` : shot.line;
    } else {
      text = "";
    }

    if (text.trim()) {
      const entryNum = srtEntries.length + 1;
      // SRT requires newlines to be escaped
      const escapedText = text.replace(/\n/g, " ");
      srtEntries.push(`${entryNum}\n${startTime} --> ${endTime}\n${escapedText}`);
    }

    currentTimeMs += durationMs;
  }

  const srtContent = srtEntries.join("\n\n") + "\n";
  await fs.writeFile(outputPath, srtContent, "utf-8");

  return outputPath;
}

/**
 * Format milliseconds to SRT timestamp: HH:MM:SS,mmm
 */
function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(millis).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
