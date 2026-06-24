/**
 * Shortify AI 全流程测试 — 带 AI 视频生成 (Wan2.7)
 * 
 * 用法: npx tsx --tsconfig=tsconfig.json scripts/run-full.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs/promises";
import * as path from "path";

const PROJECT_ROOT = process.cwd();
const uploadDir = path.resolve(PROJECT_ROOT, process.env.UPLOAD_DIR || "./uploads");

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function downloadFile(url: string, savePath: string): Promise<string> {
  await fs.mkdir(path.dirname(savePath), { recursive: true });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(savePath, buf);
  return savePath;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Shortify AI — 全流程测试 (含AI视频)");
  console.log("  VIDEO_PROVIDER:", process.env.VIDEO_PROVIDER || "cogvideo");
  console.log("  WAN_VIDEO_MODEL:", process.env.WAN_VIDEO_MODEL || "default");
  console.log("=".repeat(60));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

  // 1. 用户
  // Pick the user with most credits (test users)
  const user = (await pool.query("SELECT id, name, email, credits FROM users ORDER BY credits DESC LIMIT 1")).rows[0];
  if (!user) { log("❌ 无用户"); await pool.end(); return; }
  log(`✅ ${user.name} (积分: ${user.credits})`);

  // 2. 创建短剧
  const dramaId = uuidv4();
  const theme = "一个程序员在深夜加班时发现了一个神秘的代码仓库，每次合并PR都会改变现实";
  const title = "代码黑洞";

  await pool.query(
    `INSERT INTO dramas (id,user_id,title,description,theme,genre,style,episode_count,status,aspect_ratio,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'科幻','写实',2,'draft','landscape',NOW(),NOW())`,
    [dramaId, user.id, title, theme, theme]
  );
  log(`✅ "${title}" (${dramaId.slice(0, 8)}...)`);

  const episodeIds: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const eid = uuidv4(); episodeIds.push(eid);
    await pool.query(
      `INSERT INTO episodes (id,drama_id,episode_number,title,created_at) VALUES ($1,$2,$3,$4,NOW())`,
      [eid, dramaId, i, i === 1 ? "神秘的PR" : "现实的重构"]
    );
  }
  log("✅ 2集");

  // Imports
  const { generateImage } = await import("@/lib/ai/image-generator");
  const { generateScript } = await import("@/lib/ai/script-generator");
  const { deductCredits } = await import("@/lib/credits");
  const { uploadFileToCos, imageCosKey, videoCosKey } = await import("@/lib/ai/cos-storage");
  const { generateShotVoiceovers } = await import("@/lib/ai/voiceover-generator");
  const { generateSubtitles } = await import("@/lib/ai/subtitle-generator");
  const { generateVideo, downloadVideo } = await import("@/lib/ai/video-generator");
  const { composeEpisodeFromShots } = await import("@/lib/ai/video-composer");

  // ===== Step 1: Script =====
  log("\n─ Step 1: AI 剧本生成");
  let scriptEpisodes: any[] = [];
  try {
    const script = await generateScript({
      theme, genre: "科幻", style: "写实", episodeCount: 2, aspectRatio: "landscape",
    });
    scriptEpisodes = script.episodes || [];
    log(`✅ ${scriptEpisodes.length} 集`);

    for (const ep of scriptEpisodes) {
      const idx = ep.episodeNumber - 1;
      if (idx < 0 || idx >= episodeIds.length) continue;
      const narration = (ep.shots || []).map((s: any) => s.narration || s.dialog || "").join(" ");
      await pool.query(
        `UPDATE episodes SET script_content=$1, narration_text=$2, shot_data=$3::jsonb WHERE id=$4`,
        [JSON.stringify(ep), narration, JSON.stringify(ep.shots || []), episodeIds[idx]]
      );
      log(`  第${ep.episodeNumber}集: ${ep.shots?.length || 0} 镜头`);
    }
    await pool.query(`UPDATE dramas SET status='script_ready',updated_at=NOW() WHERE id=$1`, [dramaId]);
    await deductCredits(user.id, "script");
  } catch (err: any) {
    log(`❌ ${err.message}`);
    await pool.end(); return;
  }

  // ===== Step 2: Images (每集2张) =====
  log("\n─ Step 2: AI 分镜图片");
  for (const epId of episodeIds) {
    const ep = (await pool.query(`SELECT * FROM episodes WHERE id=$1`, [epId])).rows[0];
    if (!ep?.shot_data) continue;
    const shots: any[] = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;
    const imgCount = Math.min(shots.length, 2);

    for (let si = 0; si < imgCount; si++) {
      const shot = shots[si];
      const prompt = shot.imagePrompt || `${shot.setting || ""}, ${shot.action || ""}, cinematic sci-fi`;
      log(`  第${ep.episode_number}集-镜头${shot.shotNumber || si+1}: 生图...`);

      try {
        const url = await generateImage(prompt, "realistic");
        const localDir = path.join(uploadDir, "images", dramaId, `episode-${ep.episode_number}`);
        const localPath = path.join(localDir, `shot-${shot.shotNumber || si+1}.jpg`);
        await downloadFile(url, localPath);
        const cosKey = imageCosKey(dramaId, ep.episode_number, shot.shotNumber || si+1);
        const cosUrl = await uploadFileToCos(localPath, cosKey);
        shots[si] = { ...shots[si], imageUrl: cosUrl || localPath };
        log(`    ✅ 图片已上传`);
        await sleep(3000);
      } catch (err: any) { log(`    ❌ ${err.message}`); }
    }

    await pool.query(`UPDATE episodes SET image_url=$1, shot_data=$2::jsonb WHERE id=$3`,
      [shots[0]?.imageUrl || null, JSON.stringify(shots), epId]);
    await deductCredits(user.id, "storyboard");
  }
  await pool.query(`UPDATE dramas SET status='storyboard_ready',updated_at=NOW() WHERE id=$1`, [dramaId]);
  log("✅ 分镜完成");

  // ===== Step 3: Voiceover =====
  log("\n─ Step 3: AI 配音");
  const episodeShotAudios = new Map<string, any[]>();

  for (const epId of episodeIds) {
    const ep = (await pool.query(`SELECT * FROM episodes WHERE id=$1`, [epId])).rows[0];
    if (!ep?.shot_data) continue;
    const shots: any[] = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;

    log(`  第${ep.episode_number}集: ${shots.length} 镜...`);
    try {
      const audios = await generateShotVoiceovers(shots, dramaId, ep.episode_number);
      episodeShotAudios.set(epId, audios);
      log(`    ✅ ${audios.length} 镜配音完成`);

      for (const sa of audios) {
        const shot = shots.find((s: any) => s.shotNumber === sa.shotNumber);
        if (shot) shot.audioUrl = sa.audioUrl;
      }
      await pool.query(`UPDATE episodes SET shot_data=$1::jsonb WHERE id=$2`, [JSON.stringify(shots), epId]);
    } catch (err: any) { log(`    ❌ ${err.message}`); }
    await deductCredits(user.id, "voiceover");
  }
  await pool.query(`UPDATE dramas SET status='voiceover_ready',updated_at=NOW() WHERE id=$1`, [dramaId]);
  log("✅ 配音完成");

  // ===== Step 4: AI Video Generation (Wan2.7) =====
  log("\n─ Step 4: AI 视频生成 (Wan2.7)");
  log("   ⚠️ 每镜头约40-60秒，请耐心等待...");

  for (const epId of episodeIds) {
    const ep = (await pool.query(`SELECT * FROM episodes WHERE id=$1`, [epId])).rows[0];
    if (!ep?.shot_data) continue;
    const shots: any[] = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;

    // 只对前2个有图的镜头生成 AI 视频（节省时间）
    const shotsWithImages = shots.filter((s: any) => s.imageUrl).slice(0, 2);
    log(`  第${ep.episode_number}集: 生成 ${shotsWithImages.length} 个 AI 视频片段...`);

    for (const shot of shotsWithImages) {
      const shotPrompt = shot.narration || shot.dialog || shot.subtitle || (shot as any).description || "a cinematic scene";
      log(`    镜头${shot.shotNumber}: AI 视频生成中...`);

      // Wan2.7 需要可公开访问的图片URL -> 走本地 proxy 下载并转 base64
      let imageForAiVideo = shot.imageUrl!;
      try {
        const proxyUrl = `http://localhost:8000/api/uploads/cos/${encodeURIComponent(shot.imageUrl!.replace('https://craftmind-1307905190.cos.ap-shanghai.myqcloud.com/', ''))}`;
        const imgResp = await fetch(proxyUrl);
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          imageForAiVideo = `data:image/jpeg;base64,${buf.toString('base64')}`;
          log(`      ✅ 图片已转 base64 (${(buf.length/1024).toFixed(0)}KB)`);
        }
      } catch {}

      try {
        const result = await generateVideo(
          `Cinematic shot from short drama: ${(shot.narration || shot.dialog || shot.subtitle || "a cinematic scene").substring(0, 100)}`,
          imageForAiVideo,
          "realistic",
          { quality: "speed", size: "1920x1080", userId: user.id }
        );

        log(`      ✅ AI 视频生成完成`);
        
        // 下载到本地
        const videoDir = path.join(uploadDir, "ai-videos", dramaId, `episode-${ep.episode_number}`);
        await fs.mkdir(videoDir, { recursive: true });
        const localPath = path.join(videoDir, `shot-${shot.shotNumber}.mp4`);
        await downloadFile(result.videoUrl, localPath);
        
        // 上传 COS
        const cosKey = `shortify-ai/dramas/${dramaId}/episode-${ep.episode_number}/ai-video-${shot.shotNumber}.mp4`;
        const cosUrl = await uploadFileToCos(localPath, cosKey);
        
        shot.aiVideoUrl = cosUrl || localPath;
        log(`      ✅ 视频已上传 COS`);
      } catch (err: any) {
        log(`      ❌ ${err.message}`);
        // Fallback: use image as static (Ken Burns will handle it)
      }

      // 避免限流
      await sleep(2000);
    }

    await pool.query(`UPDATE episodes SET shot_data=$1::jsonb WHERE id=$2`, [JSON.stringify(shots), epId]);
  }
  log("✅ AI 视频生成完成");

  // ===== Step 5: Subtitles =====
  log("\n─ Step 5: SRT 字幕");
  for (const epId of episodeIds) {
    const ep = (await pool.query(`SELECT * FROM episodes WHERE id=$1`, [epId])).rows[0];
    const shotAudios = episodeShotAudios.get(epId);
    if (!ep?.shot_data || !shotAudios) continue;
    const shots: any[] = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;

    try {
      const srt = await generateSubtitles(shots, shotAudios, dramaId, ep.episode_number);
      const srtPath = path.join(uploadDir, "subtitles", dramaId, `episode-${ep.episode_number}.srt`);
      await fs.mkdir(path.dirname(srtPath), { recursive: true });
      await fs.writeFile(srtPath, srt, "utf-8");
      const cosKey = `shortify-ai/dramas/${dramaId}/episode-${ep.episode_number}/subtitles.srt`;
      await uploadFileToCos(srtPath, cosKey);
      log(`  第${ep.episode_number}集: ✅ ${srt.length} 字符`);
    } catch (err: any) { log(`  第${ep.episode_number}集: ❌ ${err.message}`); }
  }

  // ===== Step 6: Compose Final Video =====
  log("\n─ Step 6: 视频合成 (AI视频+配音)");
  for (const epId of episodeIds) {
    const ep = (await pool.query(`SELECT * FROM episodes WHERE id=$1`, [epId])).rows[0];
    const shotAudios = episodeShotAudios.get(epId);
    if (!ep?.shot_data || !shotAudios || shotAudios.length === 0) {
      log(`  ⏭ 第${ep?.episode_number}集: 无配音，跳过`);
      continue;
    }

    const shots: any[] = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;
    log(`  第${ep.episode_number}集: 合成 (${shots.length} 镜头)...`);

    try {
      const videoPath = await composeEpisodeFromShots(shots, shotAudios, dramaId, ep.episode_number, {
        fadeDuration: 0.3,
        aspectRatio: "landscape",
      });

      const buf = await fs.readFile(videoPath);
      const cosKey = videoCosKey(dramaId, ep.episode_number);
      const cosUrl = await uploadFileToCos(videoPath, cosKey);
      await pool.query(`UPDATE episodes SET video_url=$1 WHERE id=$2`, [cosUrl || videoPath, epId]);
      log(`  ✅ ${(buf.length / 1024 / 1024).toFixed(1)}MB, 上传 COS`);
    } catch (err: any) {
      log(`  ❌ ${err.message}`);
    }
    await deductCredits(user.id, "compose");
  }

  await pool.query(`UPDATE dramas SET status='completed',updated_at=NOW() WHERE id=$1`, [dramaId]);

  log("\n" + "=".repeat(60));
  log("  🎉 全流程生成完成！");
  log("=".repeat(60));
  log(`  drama ID: ${dramaId}`);
  log(`  查看: http://localhost:8000/view/${dramaId}`);

  await pool.end();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
