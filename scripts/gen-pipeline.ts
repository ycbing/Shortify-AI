/**
 * 全流水线：Wan2.7 AI 视频生成 → 配音混入 → Concat → COS 上传
 * 
 * 用法: npx tsx --tsconfig=tsconfig.json scripts/gen-pipeline.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as path from "path";
import * as fs from "fs/promises";
import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";

const PROJECT_ROOT = process.cwd();
const uploadDir = path.resolve(PROJECT_ROOT, process.env.UPLOAD_DIR || "./uploads");
const apiKey = process.env.DASHSCOPE_API_KEY || "";

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function waitForTask(taskId: string, desc: string, pollInterval = 5000): Promise<any> {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const resp = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const s = await resp.json();
    const status = s.output?.task_status;
    if (status === "SUCCEEDED") {
      log(`✅ ${desc} 完成 (${((i+1)*pollInterval/1000).toFixed(0)}s)`);
      return s.output;
    }
    if (status === "FAILED") {
      throw new Error(`${desc} 失败: ${s.output?.message || JSON.stringify(s)}`);
    }
    if (i % 12 === 0) process.stdout.write(`\n   ⏳ ${desc} ${((i+1)*pollInterval/1000).toFixed(0)}s `);
    else process.stdout.write(".");
  }
  throw new Error(`${desc} 超时`);
}

async function generateImage(query: string): Promise<string> {
  log(`   生图: "${query.substring(0, 30)}..."`);
  const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model: "wanx-v1",
      input: { prompt: query },
      parameters: { size: "1280*720", n: 1 },
    }),
  });
  const r = await resp.json();
  if (!resp.ok) throw new Error(`生图失败: ${r.message || r.code}`);
  const tid = r.output?.task_id;
  if (!tid) throw new Error("无 task_id");
  
  const output = await waitForTask(tid, "生图");
  const url = output?.results?.[0]?.url || "";
  if (!url) throw new Error("无图片 URL");
  
  // 下载并转 base64
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function generateAiVideo(base64Image: string, prompt: string): Promise<string> {
  log(`    提交 Wan2.7...`);
  const body = {
    model: "wan2.7-i2v-2026-04-25",
    input: {
      media: [{ type: "first_frame", url: base64Image }],
      prompt: prompt,
    },
    parameters: { resolution: "720P", duration: 5 },
  };

  const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-DashScope-Async": "enable" },
    body: JSON.stringify(body),
  });
  const r = await resp.json();
  if (!resp.ok) throw new Error(`视频提交失败: ${r.message || r.code}`);
  const taskId = r.output?.task_id;
  if (!taskId) throw new Error("无 task_id");
  
  const output = await waitForTask(taskId, "Wan2.7 视频");
  return output?.video_url || "";
}

async function ttsEdge(text: string): Promise<Buffer> {
  const voice = "zh-CN-XiaoxiaoNeural";
  const escapedText = text.replace(/'/g, "'\\''");
  const outputPath = `/tmp/tts-${uuidv4().slice(0, 8)}.mp3`;
  
  try {
    execSync(`edge-tts --voice "${voice}" --text "${escapedText}" --write-media "${outputPath}"`, { timeout: 30000 });
    const buf = await fs.readFile(outputPath);
    await fs.unlink(outputPath).catch(() => {});
    return buf;
  } catch (err) {
    log(`⚠️ edge-tts CLI failed`);
    throw err;
  }
}

async function main() {
  const dramaId = uuidv4();
  log("🎬 Shortify AI — Wan2.7 全流水线");
  log(`VIDEO_PROVIDER=${process.env.VIDEO_PROVIDER}`);
  log(`WAN_VIDEO_MODEL=${process.env.WAN_VIDEO_MODEL}`);
  log(`Drama ID: ${dramaId}`);
  
  // === 场景定义：3个镜头的短剧 ===
  const shots = [
    { number: 1, text: "程序员深夜在办公室敲击键盘，表情专注", imgPrompt: "一个年轻中国程序员深夜在办公室加班，戴眼镜，神情专注地敲击键盘，电脑屏幕发出蓝色荧光，窗外是繁华的城市夜景，写实电影风格，8K", videoPrompt: "程序员专注地敲击键盘，电脑蓝光闪烁" },
    { number: 2, text: "他发现了屏幕上的异常代码，惊讶地睁大了眼睛", imgPrompt: "电脑屏幕上显示着神秘代码，绿色字符瀑布般滚动，程序员惊讶地睁大眼睛，蓝光照在他震惊的脸上，赛博朋克氛围", videoPrompt: "程序员盯着屏幕，表情从专注变为惊讶，屏幕绿光闪烁" },
    { number: 3, text: "代码仓库开始变形，现实与虚拟的边界模糊了", imgPrompt: "代码从屏幕中溢出化作光流，环绕在程序员周围，办公室空间扭曲，现实与虚拟融合，科幻视觉冲击", videoPrompt: "代码从屏幕中流出，化作光流环绕，空间扭曲" },
  ];

  // === Step 1: 生成分镜图 + AI 视频 ===
  log("\n1/4 生成分镜图 + Wan2.7 AI 视频...");
  const shotVideos: { number: number; videoBuf: Buffer; text: string; videoPath: string }[] = [];

  for (const shot of shots) {
    log(`\n  镜头 ${shot.number}/3: ${shot.text.substring(0, 30)}...`);
    
    // 生图 → base64
    const b64Image = await generateImage(shot.imgPrompt);
    
    // Wan2.7 图生视频
    const videoUrl = await generateAiVideo(b64Image, shot.videoPrompt);
    
    // 下载视频
    log("    下载视频...");
    const vResp = await fetch(videoUrl);
    if (!vResp.ok) throw new Error(`下载失败: ${vResp.status}`);
    const buf = Buffer.from(await vResp.arrayBuffer());
    
    const vDir = path.join(uploadDir, "videos", dramaId);
    await fs.mkdir(vDir, { recursive: true });
    const vPath = path.join(vDir, `shot-${shot.number}.mp4`);
    await fs.writeFile(vPath, buf);
    
    shotVideos.push({ number: shot.number, videoBuf: buf, text: shot.text, videoPath: vPath });
    log(`    ✅ ${(buf.length/1024/1024).toFixed(1)}MB`);
  }

  // === Step 2: TTS 配音 ===
  log("\n2/4 生成配音...");
  const shotAudioPaths: string[] = [];
  for (const sv of shotVideos) {
    const ttsText = sv.text;
    log(`  TTS 镜头${sv.number}: "${ttsText.substring(0, 30)}..."`);
    const audioBuf = await ttsEdge(ttsText);
    const aDir = path.join(uploadDir, "voiceovers", dramaId);
    await fs.mkdir(aDir, { recursive: true });
    const aPath = path.join(aDir, `shot-${sv.number}.mp3`);
    await fs.writeFile(aPath, audioBuf);
    shotAudioPaths.push(aPath);
    log(`    ✅ TTS (${(audioBuf.length/1024).toFixed(0)}KB)`);
  }

  // === Step 3: 混入配音到 AI 视频 ===
  log("\n3/4 混入配音到 AI 视频...");
  const mixedPaths: string[] = [];
  for (let i = 0; i < shotVideos.length; i++) {
    const sv = shotVideos[i];
    const audioPath = shotAudioPaths[i];
    
    // Get audio duration
    const { execSync } = await import("child_process");
    let audioDuration = 5;
    try {
      const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`).toString().trim();
      audioDuration = parseFloat(out) || 5;
    } catch {}
    
    const mixedPath = path.join(uploadDir, "videos", dramaId, `shot-${sv.number}-mixed.mp4`);
    const fadeDuration = Math.min(0.3, audioDuration * 0.1);
    const cmd = `ffmpeg -y -stream_loop -1 -i "${sv.videoPath}" -i "${audioPath}" -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, audioDuration - fadeDuration)}:d=${fadeDuration}[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]" -map "[v]" -map "[a]" -t ${audioDuration} -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart -y "${mixedPath}"`;
    
    execSync(cmd, { timeout: 120000 });
    mixedPaths.push(mixedPath);
    log(`  ✅ 镜头${sv.number} 配音混入完成`);
  }

  // === Step 4: Concat 所有 AI 视频片段 ===
  log("\n4/4 拼接最终视频...");
  const finalDir = path.join(uploadDir, "videos", dramaId);
  const finalPath = path.join(finalDir, "complete.mp4");
  
  // Try xfade concat first
  try {
    const listPath = path.join(finalDir, "concat.txt");
    const lines = mixedPaths.map(p => `file '${path.resolve(p)}'`).join("\n");
    await fs.writeFile(listPath, lines);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart "${finalPath}"`, { timeout: 120000 });
    await fs.unlink(listPath).catch(() => {});
  } catch {
    log("  stream copy 失败，尝试重新编码拼接...");
    const listPath = path.join(finalDir, "concat.txt");
    const lines = mixedPaths.map(p => `file '${path.resolve(p)}'`).join("\n");
    await fs.writeFile(listPath, lines);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -crf 18 -preset medium -c:a aac -movflags +faststart "${finalPath}"`, { timeout: 300000 });
    await fs.unlink(listPath).catch(() => {});
  }

  const finalStat = await fs.stat(finalPath);
  let finalDur = 0;
  try {
    finalDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalPath}"`).toString().trim()) || 0;
  } catch {}

  log(`\n${"=".repeat(60)}`);
  log(`  🎉 完整 AI 短剧视频生成完毕！`);
  log(`  时长: ${finalDur.toFixed(1)}秒`);
  log(`  大小: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB`);
  log(`  分辨率: 720P`);
  log(`  镜头数: ${shots.length} (每个均为 Wan2.7 AI 视频)`);
  log(`  ${"=".repeat(60)}`);

  // === Step 5: 上传 COS ===
  log("\n上传到 COS...");
  const { uploadFileToCos } = await import("@/lib/ai/cos-storage");
  const cosKey = `shortify-ai/videos/demo/wan2.7-full-drama-${uuidv4().slice(0, 8)}.mp4`;
  const cosUrl = await uploadFileToCos(finalPath, cosKey);
  
  if (cosUrl && cosUrl.startsWith("http")) {
    const encoded = encodeURIComponent(cosKey);
    log(`\n📺 观看链接:`);
    log(`   https://craftmind.cn/api/uploads/cos/${encoded}`);
    log(`\n每个镜头原始 AI 视频 (5秒):`);
    for (const sv of shotVideos) {
      const cosKeyShot = `shortify-ai/videos/demo/wan2.7-shot-${sv.number}.mp4`;
      const cUrl = await uploadFileToCos(sv.videoPath, cosKeyShot);
      if (cUrl && cUrl.startsWith("http")) {
        const enc = encodeURIComponent(cosKeyShot);
        log(`   镜头${sv.number}: https://craftmind.cn/api/uploads/cos/${enc}`);
      }
    }
  } else {
    log(`❌ COS 上传失败，本地文件: ${finalPath}`);
  }
}

main().catch(e => {
  console.error("\n❌ Fatal:", e);
  process.exit(1);
});
