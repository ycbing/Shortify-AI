import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { Pool } from "pg";

const execAsync = promisify(exec);

const DRAMA = "a7f86b03-5313-4891-a7e6-6037f4482e1b";
const UPLOAD_DIR = path.resolve("./uploads");

type KenBurnsEffect = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "zoom-in-left" | "zoom-in-right" | "zoom-out-left" | "zoom-out-right";

function pickKenBurnsEffect(shotNumber: number): KenBurnsEffect {
  const effects: KenBurnsEffect[] = [
    "zoom-in", "pan-right", "zoom-out", "pan-left",
    "zoom-in-right", "zoom-out-left", "pan-down",
    "zoom-in-left", "pan-up", "zoom-out-right",
  ];
  return effects[(shotNumber - 1) % effects.length];
}

function buildKenBurnsFilter(effect: KenBurnsEffect, totalFrames: number): string {
  const scale = "scale=1920:1080";
  switch (effect) {
    case "zoom-in":
      return `${scale},zoompan=z='min(zoom+0.002,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "zoom-out":
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "pan-left":
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw-iw/zoom-(on*(iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "pan-right":
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='(on*(iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "pan-up":
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih-ih/zoom-(on*(ih-ih/zoom)/${totalFrames})':s=1920x1080`;
    case "pan-down":
      return `${scale},zoompan=z='min(zoom+0.001,1.3)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='(on*(ih-ih/zoom)/${totalFrames})':s=1920x1080`;
    case "zoom-in-left":
      return `${scale},zoompan=z='min(zoom+0.002,1.4)':d=${totalFrames}:x='iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "zoom-in-right":
      return `${scale},zoompan=z='min(zoom+0.002,1.4)':d=${totalFrames}:x='2*iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "zoom-out-left":
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    case "zoom-out-right":
      return `${scale},zoompan=z='if(eq(on,1),1.4,max(zoom-0.002,1.0))':d=${totalFrames}:x='2*iw/3-(iw/zoom/3)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    default:
      return `${scale},zoompan=z='min(zoom+0.002,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
  }
}

async function main() {
  const pool = new Pool({ host: "localhost", port: 5432, user: "storycraft", password: "YOUR_DB_PASSWORD", database: "shortify_ai" });
  const { rows: episodes } = await pool.query("SELECT * FROM episodes WHERE drama_id = $1 ORDER BY episode_number", [DRAMA]);

  for (const ep of episodes) {
    const epNum = ep.episode_number;
    const shots = ep.shot_data;
    if (!shots || !Array.isArray(shots)) continue;

    const tempDir = path.join(UPLOAD_DIR, "videos", DRAMA, `episode-${epNum}-temp`);
    await fs.mkdir(tempDir, { recursive: true });

    const shotPaths: string[] = [];

    for (const shot of shots) {
      const audioPath = path.join(UPLOAD_DIR, "voiceovers", DRAMA, `episode-${epNum}`, `shot-${shot.shotNumber}.mp3`);
      const imgPath = path.join(UPLOAD_DIR, "images", DRAMA, `episode-${epNum}`, `shot-${shot.shotNumber}.jpg`);
      const imgPathPng = imgPath.replace(".jpg", ".png");

      let imageFile = imgPath;
      try { await fs.access(imgPath); } catch { imageFile = imgPathPng; }

      let audioDuration = shot.duration || 5;
      try {
        const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
        audioDuration = parseFloat(stdout.trim()) || audioDuration;
      } catch { /* ffprobe failed, using default duration */ }

      const totalFrames = Math.max(1, Math.ceil(audioDuration * 25));
      const effect = pickKenBurnsEffect(shot.shotNumber);
      const kenBurns = buildKenBurnsFilter(effect, totalFrames);
      const fadeDuration = Math.min(0.5, audioDuration * 0.15);

      const outputPath = path.join(tempDir, `shot-${shot.shotNumber}.mp4`);
      const filterComplex = `[0:v]${kenBurns},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${audioDuration - fadeDuration}:d=${fadeDuration}[v];[1:a]anull[a]`;
      const cmd = `ffmpeg -loop 1 -i "${imageFile}" -i "${audioPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -t ${audioDuration} -pix_fmt yuv420p -shortest -y "${outputPath}"`;

      process.stdout.write(`EP${epNum} Shot${shot.shotNumber} [${effect}]: `);
      try {
        await execAsync(cmd, { timeout: 120000 });
        shotPaths.push(outputPath);
        console.log("OK");
      } catch (e) {
        console.error("FAIL");
      }
    }

    // Concat
    const concatList = path.join(tempDir, "concat-list.txt");
    const concatContent = shotPaths.map(p => `file '${p}'`).join("\n");
    await fs.writeFile(concatList, concatContent);

    const rawPath = path.join(UPLOAD_DIR, "videos", DRAMA, `episode-${epNum}-raw.mp4`);
    const finalPath = path.join(UPLOAD_DIR, "videos", DRAMA, `episode-${epNum}.mp4`);
    const srtPath = path.join(UPLOAD_DIR, "subtitles", DRAMA, `episode-${epNum}.srt`);

    console.log(`  Concatenating ${shotPaths.length} shots...`);
    await execAsync(`ffmpeg -f concat -safe 0 -i "${concatList}" -c:v libx264 -c:a aac -movflags +faststart -y "${rawPath}"`, { timeout: 300000 });

    // Burn subtitles
    const escapedSrt = srtPath.replace(/'/g, "'\\''");
    try {
      await fs.access(srtPath);
      await execAsync(`ffmpeg -i "${rawPath}" -vf "subtitles='${escapedSrt}'" -c:v libx264 -c:a aac -movflags +faststart -y "${finalPath}"`, { timeout: 300000 });
      await fs.unlink(rawPath);
    } catch {
      await fs.rename(rawPath, finalPath);
    }

    // Cleanup temp
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    // Upload to COS
    // (skip for now, already uploaded)
    
    const stat = await fs.stat(finalPath);
    console.log(`  => EP${epNum} done: ${(stat.size / 1024 / 1024).toFixed(1)}MB\n`);
  }

  await pool.end();
  console.log("All done!");
}

main().catch(e => { console.error(e); process.exit(1); });
