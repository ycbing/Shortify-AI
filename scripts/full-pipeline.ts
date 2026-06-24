/**
 * 全自动流水线：配音 + AI 图生视频 + 混音拼接 + COS 上传
 * 处理所有 5 集
 * 
 * 用法: nohup npx tsx --tsconfig=tsconfig.json scripts/full-pipeline.ts > pipeline.log 2>&1 &
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs/promises";
import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { uploadFileToCos } from "@/lib/ai/cos-storage";

const DRAMA_ID = "ca5472e9-f9ea-4c61-9d29-9e7cbc69aaf0";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const apiKey = process.env.DASHSCOPE_API_KEY || "";

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const STYLES = ["zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural", "zh-CN-XiaomengNeural", "zh-CN-YunxiNeural"];
const styleNames = ["叙述/温柔", "沉稳男声", "活泼女声", "阳光男声"];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const drama = (await pool.query("SELECT style, aspect_ratio FROM dramas WHERE id=$1", [DRAMA_ID])).rows[0];
  const eps = (await pool.query("SELECT id, episode_number, shot_data FROM episodes WHERE drama_id=$1 ORDER BY episode_number", [DRAMA_ID])).rows;

  for (const ep of eps) {
    const shots = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;
    if (!Array.isArray(shots) || shots.length === 0) continue;

    log(`\n${"=".repeat(60)}`);
    log(`🎬 第 ${ep.episode_number} 集 (${shots.length} 镜头)`);

    const workDir = path.join(UPLOAD_DIR, "output", DRAMA_ID, `ep-${ep.episode_number}`);
    await fs.mkdir(workDir, { recursive: true });

    const mixedVideos: string[] = [];

    for (let si = 0; si < shots.length; si++) {
      const shot = shots[si];
      log(`\n  镜头 ${shot.shotNumber}/${shots.length}: 配音 + AI 视频`);

      // === 1. TTS ===
      const subtitle = shot.subtitle || shot.narration || `${shot.character || "旁白"}说台词`;
      const voiceIdx = ["旁白", "叙述"].includes(shot.character || "") ? 0 : 1;
      const voice = STYLES[voiceIdx] || STYLES[1];
      const ttsPath = path.join(workDir, `shot-${shot.shotNumber}-tts.mp3`);
      
      try {
        execSync(`edge-tts --voice "${voice}" --text "${subtitle.replace(/"/g, '\\"').substring(0, 200)}" --write-media "${ttsPath}"`, { timeout: 30000, stdio: "pipe" });
        log(`    ✅ TTS (${voice})`);
      } catch {
        // Fallback: generate a silent 3s audio
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 3 -c:a libmp3lame "${ttsPath}" 2>/dev/null`, { timeout: 10000 });
        log(`    ⚠️ TTS fallback (silent)`);
      }

      // Get audio duration
      let audioDur = 3;
      try {
        audioDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${ttsPath}"`).toString().trim()) || 3;
      } catch {}

      // === 2. Download image & convert to base64 ===
      const imageUrl = shot.imageUrl || "";
      let shotImagePath = "";
      if (!imageUrl) {
        const subtitle = shot.subtitle || shot.narration || `${shot.character || ""}说台词`;
        log(`    ⚠️ 无图片，生成文字占位`);
        const placeholderPath = path.join(workDir, `shot-${shot.shotNumber}-placeholder.mp4`);
        // 本地生成带文字的渐变占位画面（仿电影感深色背景），零成本
        const textParts = [
          `镜头 ${shot.shotNumber}/${shots.length}`,
          // 取台词前30字
          subtitle.length > 28 ? subtitle.substring(0, 28) + "..." : subtitle,
        ];
        // 分两行显示
        execSync(`ffmpeg -y -f lavfi -i "color=c=#1a1a2e:s=1920x1080:d=${audioDur}:r=24" ` +
          `-vf "drawtext=text='${textParts[0]}':fontsize=36:fontcolor=#888888:x=(w-text_w)/2:y=(h-text_h)/2-40:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf, ` +
          `drawtext=text='${textParts[1]}':fontsize=28:fontcolor=#cccccc:x=(w-text_w)/2:y=(h-text_h)/2+20:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" ` +
          `-c:v libx264 -crf 23 -pix_fmt yuv420p -preset fast -movflags +faststart "${placeholderPath}" 2>/dev/null`);
        mixedVideos.push(placeholderPath);
        continue;
      }

      let base64Image = "";
      try {
        // Try proxy URL for COS images
        let fetchUrl = imageUrl;
        if (imageUrl.includes("cos.ap-shanghai")) {
          const cosKey = imageUrl.split(".myqcloud.com/")[1];
          fetchUrl = `http://localhost:8000/api/uploads/cos/${encodeURIComponent(cosKey)}`;
        }
        const imgResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          base64Image = `data:image/jpeg;base64,${buf.toString("base64")}`;
          // 同时保存本地图片用于 fallback
          shotImagePath = path.join(workDir, `shot-${shot.shotNumber}-image.jpg`);
          await fs.writeFile(shotImagePath, buf);
          log(`    ✅ 图片 base64 (${(buf.length/1024).toFixed(0)}KB)`);
        }
      } catch {}

      // === 3. Wan2.7 图生视频 ===
      const videoModel = process.env.WAN_VIDEO_MODEL || "wan2.7-i2v-2026-04-25";
      const isT2V = videoModel.includes("t2v");
      const skipAiVideo = videoModel === "none" || videoModel.startsWith("none#") || videoModel.startsWith("off");
      let aiVideoUrl = "";
      if (skipAiVideo) {
        log(`    🔇 AI 视频已关闭，走 Ken Burns 静图`);
      } else if (isT2V || base64Image) {
        try {
          const videoPrompt = (subtitle || "Cinematic scene").substring(0, 100);
          const videoPromptFull = isT2V
            ? `${videoPrompt}。宽屏16:9构图，电影感画面。`.substring(0, 200)
            : videoPrompt;
          const body = {
            model: videoModel,
            input: isT2V
              ? { prompt: videoPromptFull }
              : { media: [{ type: "first_frame", url: base64Image }], prompt: videoPrompt },
            parameters: { resolution: "1080P", duration: 5 },
          };

          const submitResp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-DashScope-Async": "enable" },
            body: JSON.stringify(body),
          });
          const submitResult = await submitResp.json();
          if (submitResp.ok && submitResult.output?.task_id) {
            const taskId = submitResult.output.task_id;
            log(`    提交视频 (${videoModel}): ${taskId}`);

            // Poll
            for (let i = 0; i < 120; i++) {
              await sleep(5000);
              const sr = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              const s = await sr.json();
              const status = s.output?.task_status;
              if (status === "SUCCEEDED") {
                aiVideoUrl = s.output?.video_url || "";
                break;
              }
              if (status === "FAILED") { log(`    ❌ 视频失败: ${s.output?.message || ""}`); break; }
              if (i % 12 === 0) process.stdout.write(`     ⏳ ${(i*5)}s`);
              else process.stdout.write(".");
            }
            if (aiVideoUrl) log(`\n    ✅ AI 视频生成成功`);
          }
        } catch (err: any) {
          log(`    ❌ 视频错误: ${err.message.substring(0, 80)}`);
        }
      }

      // === 4. Mix audio into video ===
      const mixedPath = path.join(workDir, `shot-${shot.shotNumber}-mixed.mp4`);

      if (aiVideoUrl) {
        // Download AI video
        const aiPath = path.join(workDir, `shot-${shot.shotNumber}-ai.mp4`);
        try {
          const vResp = await fetch(aiVideoUrl);
          if (vResp.ok) {
            const buf = Buffer.from(await vResp.arrayBuffer());
            await fs.writeFile(aiPath, buf);
            log(`    📥 已下载 AI 视频 (${(buf.length/1024/1024).toFixed(1)}MB)`);

            // Determine video duration
            let videoDur = audioDur;
            try {
              const vDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${aiPath}"`).toString().trim()) || 5;
              videoDur = Math.max(audioDur, vDur);
            } catch {}

            // Loop video to match audio duration, then mix audio
            const dur = Math.max(audioDur, 5);
            const cmd = `ffmpeg -y -stream_loop -1 -i "${aiPath}" -i "${ttsPath}" -filter_complex \
              "[0:v]setpts=PTS/${(dur/5).toFixed(2)},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=0.3,fade=t=out:st=${(dur-0.3).toFixed(1)}:d=0.3,format=yuv420p[v];\
              [1:a]adelay=1|1,volume=1.5[a]" \
              -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -crf 20 -preset fast -c:a aac -b:a 128k -shortest -movflags +faststart -y "${mixedPath}"`;
            execSync(cmd, { timeout: 120000 });
            log(`    ✅ 混音完成`);
          }
        } catch (err: any) {
          log(`    ⚠️ 混合失败: ${err.message.substring(0, 60)}, 生成静态占位`);
          execSync(`ffmpeg -y -f lavfi -i "color=c=black:s=1920x1080:d=${audioDur}:r=24" -i "${ttsPath}" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -shortest "${mixedPath}" 2>/dev/null`);
        }
      } else {
        // No AI video — use static image with simple scale+pad+fade (reliable, never black)
        const dur = Math.max(audioDur, 4);
        if (shotImagePath) {
          try {
            const fps = 24;
            const totalFrames = Math.round(dur * fps);
            const zoomCmd = `ffmpeg -y -loop 1 -i "${shotImagePath}" -i "${ttsPath}" -filter_complex \
              "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,zoompan=z='min(zoom+0.002,1.8)':d=${totalFrames}:s=1920x1080:fps=${fps},fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur-0.4).toFixed(1)}:d=0.4,format=yuv420p[v];\
              [1:a]adelay=1|1[a]" \
              -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -crf 20 -preset fast -c:a aac -shortest -y "${mixedPath}"`;
            execSync(zoomCmd, { timeout: 120000 });
            log(`    ✅ Ken Burns 静图 (zoompan)`);
          } catch {
            execSync(`ffmpeg -y -loop 1 -i "${shotImagePath}" -i "${ttsPath}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,fade=t=in:st=0:d=0.3" -c:v libx264 -crf 20 -preset fast -c:a aac -shortest -t ${dur} -y "${mixedPath}" 2>/dev/null`);
            log(`    ⚠️ 静态图 (zoompan失败，简单缩放)`);
          }
        } else {
          // 无图片且 AI 视频失败：生成文字占位
          const subtitle = shot.subtitle || shot.narration || `${shot.character || ""}说台词`;
          const textParts = [
            `镜头 ${shot.shotNumber}`,
            subtitle.length > 28 ? subtitle.substring(0, 28) + "..." : subtitle,
          ];
          execSync(`ffmpeg -y -f lavfi -i "color=c=#1a1a2e:s=1920x1080:d=${dur}:r=24" ` +
            `-vf "drawtext=text='${textParts[0]}':fontsize=36:fontcolor=#888888:x=(w-text_w)/2:y=(h-text_h)/2-40:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf, ` +
            `drawtext=text='${textParts[1]}':fontsize=28:fontcolor=#cccccc:x=(w-text_w)/2:y=(h-text_h)/2+20:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" ` +
            `-i "${ttsPath}" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -shortest -preset fast -movflags +faststart -y "${mixedPath}" 2>/dev/null`);
          log(`    ⚠️ 文字占位 (无图片)`);
        }
      }

      mixedVideos.push(mixedPath);
    }

    // === 5. Concat all shots ===
    log(`\n  拼接 ${mixedVideos.length} 个镜头...`);
    const listPath = path.join(workDir, "concat.txt");
    const lines = mixedVideos.map(p => `file '${path.resolve(p)}'`).join("\n");
    await fs.writeFile(listPath, lines);

    const finalPath = path.join(workDir, "final.mp4");
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart "${finalPath}"`, { timeout: 120000 });
    } catch {
      log("  concat 失败，重新编码拼接...");
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -crf 20 -preset medium -c:a aac -movflags +faststart "${finalPath}"`, { timeout: 300000 });
    }

    const finalStat = await fs.stat(finalPath).catch(() => null);
    let finalDur = 0;
    try {
      finalDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalPath}"`).toString().trim()) || 0;
    } catch {}

    log(`\n  📺 第${ep.episode_number}集完成: ${finalDur.toFixed(1)}秒, ${finalStat ? (finalStat.size/1024/1024).toFixed(1) : "?"}MB`);

    // === 6. Upload to COS ===
    if (finalStat) {
      const cosKey = `${DRAMA_ID}/videos/episode-${ep.episode_number}.mp4`;
      const cosUrl = await uploadFileToCos(finalPath, cosKey);
      await pool.query("UPDATE episodes SET video_url=$1 WHERE id=$2", [cosUrl || finalPath, ep.id]);
      log(`  ☁️ COS: ${cosUrl?.substring(0, 80) || finalPath}`);
    }

    // Clean up temp files
    await fs.unlink(listPath).catch(() => {});
  }

  // === Update drama status ===
  await pool.query("UPDATE dramas SET status='completed', updated_at=NOW() WHERE id=$1", [DRAMA_ID]);
  log(`\n${"=".repeat(60)}`);
  log(`🎉 全部完成！`);
  log(`   查看: https://craftmind.cn/view/${DRAMA_ID}`);

  // Print all video URLs
  log(`\n📺 各集视频:`);
  for (const ep of eps) {
    const epData = (await pool.query("SELECT video_url FROM episodes WHERE id=$1", [ep.id])).rows[0];
    if (epData?.video_url) {
      const cosKey = `${DRAMA_ID}/videos/episode-${ep.episode_number}.mp4`;
      log(`  第${ep.episode_number}集: https://craftmind.cn/api/uploads/cos/${encodeURIComponent(cosKey)}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
