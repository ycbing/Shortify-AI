import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

export interface ComposeOptions {
  imagePath: string;
  audioPath: string;
  outputPath: string;
  subtitlePath?: string;
  resolution?: "1280x720" | "1920x1080";
  fadeDuration?: number; // seconds
}

export async function composeVideo(options: ComposeOptions): Promise<string> {
  const {
    imagePath,
    audioPath,
    outputPath,
    subtitlePath,
    resolution = "1280x720",
    fadeDuration = 0.5,
  } = options;

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  // Build ffmpeg command
  const filters = [
    `scale=${resolution}:force_original_aspect_ratio=decrease`,
    `pad=${resolution}:(ow-iw)/2:(oh-ih)/2:color=black`,
  ];

  let filterComplex = `[0:v]${filters.join(",")}[v];[v]fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audioPath})-${fadeDuration}:d=${fadeDuration}[outv]`;

  const inputs = [`-loop 1 -i "${imagePath}"`, `-i "${audioPath}"`];
  const outputOptions = ["-map [outv]", "-map 1:a", "-c:v libx264", "-c:a aac", "-shortest", "-y"];

  if (subtitlePath) {
    inputs.push(`-i "${subtitlePath}"`);
    outputOptions.unshift(
      `-vf "subtitles='${subtitlePath}'"`,
      "-map 0:v",
      "-map 1:a"
    );
    // Simplified version without fade for subtitle compatibility
    const cmd = `ffmpeg ${inputs.join(" ")} -vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:color=black,subtitles='${subtitlePath}'" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
  } else {
    // Get audio duration for fade out
    const { stdout: durationStr } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    const audioDuration = parseFloat(durationStr.trim()) || 30;

    const vfFilter = `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${audioDuration - fadeDuration}:d=${fadeDuration}`;

    const cmd = `ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "${vfFilter}" -c:v libx264 -c:a aac -shortest -y "${outputPath}"`;
    await execAsync(cmd, { timeout: 120000 });
  }

  return outputPath;
}

export async function mergeVideos(
  videoPaths: string[],
  outputPath: string,
  transitionDuration: number = 0.5
): Promise<string> {
  if (videoPaths.length === 0) {
    throw new Error("No video paths provided");
  }

  if (videoPaths.length === 1) {
    return videoPaths[0];
  }

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  // Create concat file
  const concatListPath = path.join(dir, "concat-list.txt");
  const concatContent = videoPaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(concatListPath, concatContent);

  const cmd = `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${outputPath}"`;
  await execAsync(cmd, { timeout: 300000 });

  // Clean up concat file
  await fs.unlink(concatListPath).catch(() => {});

  return outputPath;
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return Math.ceil(parseFloat(stdout.trim()) || 0);
}
