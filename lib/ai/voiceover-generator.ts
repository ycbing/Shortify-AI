import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

export interface VoiceoverResult {
  filePath: string;
  durationSeconds: number;
  text: string;
}

export async function generateVoiceover(
  text: string,
  outputPath: string,
  voice: string = "zh-CN-XiaoxiaoNeural",
  rate: string = "+0%",
  pitch: string = "+0Hz"
): Promise<VoiceoverResult> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  // Use edge-tts CLI (install: pip install edge-tts)
  const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, " ");
  const cmd = `edge-tts --voice "${voice}" --rate="${rate}" --pitch="${pitch}" --text "${escapedText}" --write-media "${outputPath}"`;

  try {
    await execAsync(cmd, { timeout: 60000 });
  } catch (error) {
    throw new Error(
      `Voiceover generation failed (edge-tts CLI not available). Install with: pip install edge-tts. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Get duration using ffprobe
  const duration = await getAudioDuration(outputPath, text.length);

  return {
    filePath: outputPath,
    durationSeconds: duration,
    text,
  };
}

async function getAudioDuration(filePath: string, textLength: number): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return Math.ceil(parseFloat(stdout.trim()) || 30);
  } catch {
    // Estimate based on text length (Chinese ~4 chars/second)
    return Math.max(30, Math.ceil(textLength / 4));
  }
}
