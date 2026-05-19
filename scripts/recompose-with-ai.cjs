#!/usr/bin/env node
/**
 * Re-compose episode videos using AI-generated shot clips
 * Replaces static Ken Burns clips with AI video clips where available
 */

const { Pool } = require("pg");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const DRAMA_ID = "e0655c7b-2fd6-4a68-ab06-45234d974dff";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const DB_CONFIG = { host: "172.17.0.1", port: 5432, database: "shortify_ai", user: "storycraft", password: "YOUR_DB_PASSWORD" };

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.trim());
    });
  });
}

function main() {
  const pool = new Pool(DB_CONFIG);

  (async () => {
    try {
      const epRes = await pool.query(
        `SELECT id, episode_number, shot_data FROM episodes WHERE drama_id = $1 ORDER BY episode_number`,
        [DRAMA_ID]
      );

      const videoPaths = [];

      for (const ep of epRes.rows) {
        const shots = ep.shot_data || [];
        const epNum = ep.episode_number;
        const videoDir = path.join(UPLOAD_DIR, "videos", DRAMA_ID);
        const tempDir = path.join(videoDir, `ep${epNum}-ai-temp`);
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(videoDir, { recursive: true });

        const shotVideoPaths = [];

        for (const shot of shots) {
          const shotNum = shot.shotNumber;
          const audioPath = path.join(UPLOAD_DIR, "voiceovers", DRAMA_ID, `episode-${epNum}`, `shot-${shotNum}.mp3`);
          const outputPath = path.join(tempDir, `shot-${shotNum}.mp4`);

          // Check if AI video exists
          const aiVideoPath = path.join(videoDir, `episode-${epNum}`, `ai-shot-${shotNum}.mp4`);
          const hasAiVideo = fs.existsSync(aiVideoPath) && fs.statSync(aiVideoPath).size > 10000;

          let audioDur = shot.duration || 5;
          try {
            const stdout = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
            audioDur = parseFloat(stdout) || audioDur;
          } catch {}

          const fadeDur = Math.min(0.3, audioDur * 0.1);

          if (hasAiVideo) {
            // Use AI video: loop to match audio + add audio
            log(`  EP${epNum} Shot${shotNum}: AI video + audio ${audioDur.toFixed(1)}s`);
            const cmd = `ffmpeg -y -stream_loop -1 -i "${aiVideoPath}" -i "${audioPath}" -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${Math.max(0, audioDur - fadeDur)}:d=${fadeDur}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]" -map "[v]" -map "[a]" -t ${audioDur} -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -y "${outputPath}"`;
            await execAsync(cmd, { timeout: 120000 });
          } else {
            // Fallback: image + Ken Burns
            const imagePath = path.join(UPLOAD_DIR, "images", DRAMA_ID, `episode-${epNum}`, `shot-${shotNum}.jpg`);
            const effects = ["zoom-in", "pan-right", "zoom-out", "pan-left", "zoom-in-right", "zoom-out-left", "pan-down", "zoom-in-left", "pan-up", "zoom-out-right"];
            const effect = effects[(shotNum - 1) % effects.length];
            const totalFrames = Math.max(1, Math.ceil(audioDur * 30));
            const tw = 1920, th = 1080, uw = Math.round(tw * 1.1), uh = Math.round(th * 1.1);

            if (fs.existsSync(imagePath)) {
              log(`  EP${epNum} Shot${shotNum}: Ken Burns ${effect} ${audioDur.toFixed(1)}s (no AI video)`);
              let zoomFilter;
              switch (effect) {
                case "zoom-in": zoomFilter = `scale=${uw}:${uh}:flags=lanczos,zoompan=z='min(zoom+0.0008,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${tw}x${th}:fps=30`; break;
                case "zoom-out": zoomFilter = `scale=${uw}:${uh}:flags=lanczos,zoompan=z='if(eq(on,1),1.12,max(zoom-0.0008,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${tw}x${th}:fps=30`; break;
                case "pan-right": zoomFilter = `scale=${uw}:${uh}:flags=lanczos,zoompan=z='1.08':x='on*((iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${tw}x${th}:fps=30`; break;
                case "pan-left": zoomFilter = `scale=${uw}:${uh}:flags=lanczos,zoompan=z='1.08':x='(iw-iw/zoom)-on*((iw-iw/zoom)/${totalFrames})':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${tw}x${th}:fps=30`; break;
                default: zoomFilter = `scale=${uw}:${uh}:flags=lanczos,zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${tw}x${th}:fps=30`;
              }
              const filterComplex = `[0:v]${zoomFilter},fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${Math.max(0, audioDur - fadeDur)}:d=${fadeDur}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]`;
              const cmd = `ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset fast -t ${audioDur} -pix_fmt yuv420p -shortest -y "${outputPath}"`;
              await execAsync(cmd, { timeout: 180000 });
            } else {
              log(`  EP${epNum} Shot${shotNum}: black frame ${audioDur.toFixed(1)}s`);
              await execAsync(`ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=${audioDur} -i "${audioPath}" -c:v libx264 -crf 18 -preset fast -c:a aac -b:a 128k -shortest -y "${outputPath}"`, { timeout: 60000 });
            }
          }

          shotVideoPaths.push(outputPath);
        }

        // Concat
        const rawPath = path.join(videoDir, `episode-${epNum}-raw.mp4`);
        const finalPath = path.join(videoDir, `episode-${epNum}.mp4`);
        const subtitlePath = path.join(UPLOAD_DIR, "subtitles", DRAMA_ID, `episode-${epNum}`, "subtitles.srt");

        if (shotVideoPaths.length === 1) {
          fs.copyFileSync(shotVideoPaths[0], rawPath);
        } else {
          const concatList = shotVideoPaths.map(p => `file '${p}'`).join("\n");
          const listPath = path.join(tempDir, "concat.txt");
          fs.writeFileSync(listPath, concatList);
          log(`  EP${epNum}: concatenating ${shotVideoPaths.length} shots...`);
          await execAsync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c:v libx264 -crf 18 -preset fast -c:a aac -b:a 128k -movflags +faststart -y "${rawPath}"`, { timeout: 300000 });
        }

        // Burn subtitles
        if (fs.existsSync(subtitlePath)) {
          const escapedSub = subtitlePath.replace(/'/g, "'\\''");
          log(`  EP${epNum}: burning subtitles...`);
          await execAsync(`ffmpeg -i "${rawPath}" -vf "subtitles='${escapedSub}'" -c:v libx264 -crf 18 -preset fast -c:a copy -movflags +faststart -y "${finalPath}"`, { timeout: 300000 });
          try { fs.unlinkSync(rawPath); } catch {}
        } else {
          fs.renameSync(rawPath, finalPath);
        }

        fs.rmSync(tempDir, { recursive: true, force: true });
        const size = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(1);
        log(`  EP${epNum}: done (${size}MB)`);
        videoPaths.push(finalPath);
      }

      // Merge all episodes
      log("\n=== Merging episodes ===");
      const mergedPath = path.join(UPLOAD_DIR, "videos", DRAMA_ID, "complete.mp4");
      if (videoPaths.length > 1) {
        const concatList = videoPaths.map(p => `file '${p}'`).join("\n");
        const listPath = path.join(UPLOAD_DIR, "videos", DRAMA_ID, "merge-list.txt");
        fs.writeFileSync(listPath, concatList);
        await execAsync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart -y "${mergedPath}"`, { timeout: 300000 });
        try { fs.unlinkSync(listPath); } catch {}
        log(`Complete video: ${(fs.statSync(mergedPath).size / 1024 / 1024).toFixed(1)}MB`);
      }

      log("\n=== ALL DONE ===");
    } catch (err) {
      log(`FATAL: ${err.message}`);
      console.error(err);
    } finally {
      await pool.end();
    }
  })();
}

main();
