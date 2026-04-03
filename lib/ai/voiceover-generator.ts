import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import type { Shot, ShotAudio } from "@/types/drama";
import { NARRATION_VOICE } from "@/types/drama";

const execAsync = promisify(exec);

export interface VoiceoverResult {
  filePath: string;
  durationSeconds: number;
  text: string;
}

// ============ Legacy: single-voice narration ============

export async function generateVoiceover(
  text: string,
  outputPath: string,
  voice: string = "zh-CN-XiaoxiaoNeural",
  rate: string = "+0%",
  pitch: string = "+0Hz"
): Promise<VoiceoverResult> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, " ");
  const cmd = `edge-tts --voice "${voice}" --rate="${rate}" --pitch="${pitch}" --text "${escapedText}" --write-media "${outputPath}"`;

  try {
    await execAsync(cmd, { timeout: 60000 });
  } catch (error) {
    throw new Error(
      `Voiceover generation failed. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const duration = await getAudioDuration(outputPath, text.length);

  return {
    filePath: outputPath,
    durationSeconds: duration,
    text,
  };
}

// ============ V2: multi-voice shot-based voiceover ============

/**
 * Generate independent audio for each shot.
 * Dialogue shots use the character's voiceId; narration shots use NARRATION_VOICE.
 */
export async function generateShotVoiceovers(
  shots: Shot[],
  dramaId: string,
  episodeNumber: number
): Promise<ShotAudio[]> {
  const results: ShotAudio[] = [];

  for (const shot of shots) {
    const outputDir = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      "voiceovers",
      dramaId,
      `episode-${episodeNumber}`
    );
    const outputPath = path.join(outputDir, `shot-${shot.shotNumber}.mp3`);

    // Determine text and voice
    let text: string;
    let voiceId: string;
    let type: "dialogue" | "narration";

    if (shot.type === "dialogue" && shot.line) {
      text = shot.line;
      voiceId = shot.voiceId || NARRATION_VOICE;
      type = "dialogue";
    } else {
      text = shot.subtitle || "";
      voiceId = NARRATION_VOICE;
      type = "narration";
    }

    if (!text.trim()) {
      // No text for this shot — create a silent audio of the specified duration
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });
      await createSilentAudio(outputPath, shot.duration || 3);
      results.push({
        shotNumber: shot.shotNumber,
        audioUrl: outputPath,
        duration: shot.duration || 3,
        type,
        character: shot.character,
      });
      continue;
    }

    try {
      const result = await generateVoiceover(text, outputPath, voiceId);
      results.push({
        shotNumber: shot.shotNumber,
        audioUrl: result.filePath,
        duration: result.durationSeconds,
        type,
        character: shot.character,
      });
    } catch (err) {
      console.error(
        `Failed to generate voiceover for shot ${shot.shotNumber}:`,
        err
      );
      // Fallback: silent audio
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });
      await createSilentAudio(outputPath, shot.duration || 3);
      results.push({
        shotNumber: shot.shotNumber,
        audioUrl: outputPath,
        duration: shot.duration || 3,
        type,
        character: shot.character,
      });
    }
  }

  return results;
}

// ============ Helpers ============

async function getAudioDuration(
  filePath: string,
  textLength: number
): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return Math.ceil(parseFloat(stdout.trim()) * 10) / 10 || 3;
  } catch {
    return Math.max(3, Math.ceil(textLength / 4));
  }
}

async function createSilentAudio(
  outputPath: string,
  durationSec: number
): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });
  await execAsync(
    `ffmpeg -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000 -t ${durationSec} -q:a 9 -acodec libmp3lame "${outputPath}" -y`,
    { timeout: 10000 }
  );
}
