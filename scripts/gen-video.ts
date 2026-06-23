/**
 * 直接生成 AI 视频（Wan2.7 i2v）并返回可访问链接
 * 
 * 用法: npx tsx --tsconfig=tsconfig.json scripts/gen-video.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function log(s: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
}

async function main() {
  const startTime = Date.now();
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) { console.log("❌ 无 API Key"); return; }

  log("🚀 Wan2.7 i2v 视频生成");
  log(`Model: wan2.7-i2v-2026-04-25`);

  // Step 1: 下载已有 COS 图片并通过本地 proxy 转 base64
  log("\n1/3 准备图片...");
  
  // 使用之前生成并通过 proxy 可访问的图片
  const imgProxyUrl = "http://localhost:8000/api/uploads/cos/c1fa6185-5486-4ae1-bc96-db10803c5a01/images/episode-1/shot-1.jpg";
  
  const imgResp = await fetch(imgProxyUrl);
  if (!imgResp.ok) {
    // fallback: 直接用另一张之前验证过的图
    log("图片1不可用，尝试其他...");
    // 使用本地已有文件
    const { execSync } = await import("child_process");
    const existing = execSync("find uploads/images -name '*.jpg' -type f 2>/dev/null | head -3").toString().trim().split("\n").filter(Boolean);
    if (existing.length === 0) { log("❌ 无可用的本地图片"); return; }
    log(`使用本地图片: ${existing[0]}`);
    const fs = await import("fs/promises");
    const buf = await fs.readFile(existing[0]);
    const b64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
    log(`✅ 图片 ${(buf.length/1024).toFixed(0)}KB -> base64`);

    await generateVideo(b64, apiKey, startTime);
  } else {
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const b64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
    log(`✅ 图片 ${(buf.length/1024).toFixed(0)}KB -> base64`);
    await generateVideo(b64, apiKey, startTime);
  }
}

async function generateVideo(base64Image: string, apiKey: string, startTime: number) {
  // Step 2: 提交 Wan2.7 视频任务
  log("\n2/3 提交 Wan2.7 视频任务...");
  
  const body = {
    model: "wan2.7-i2v-2026-04-25",
    input: {
      media: [{ type: "first_frame", url: base64Image }],
      prompt: "一个程序员深夜在办公室加班，神情专注，敲击键盘，电脑屏幕发出蓝光，窗外城市夜景，电影感",
    },
    parameters: { resolution: "720P", duration: 5 },
  };

  const submitResp = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(body),
    }
  );
  
  const result = await submitResp.json();
  if (!submitResp.ok) {
    log(`❌ 提交失败: HTTP ${submitResp.status} ${result.message || result.code || ""}`);
    if (result.code === "AccessDenied") log("  → Wan2.7 未开通权限，需要去阿里百炼开通");
    return;
  }

  const taskId = result.output?.task_id;
  if (!taskId) { log("❌ 无 task_id"); return; }

  log(`✅ 任务已提交: ${taskId}`);

  // Step 3: 轮询
  log("\n3/3 等待 AI 视频生成...");
  let videoUrl = "";

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const sr = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const s = await sr.json();
    const status = s.output?.task_status;
    
    if (status === "SUCCEEDED") {
      videoUrl = s.output?.video_url || "";
      if (videoUrl) break;
    }
    if (status === "FAILED") {
      log(`❌ 生成失败: ${s.output?.message || JSON.stringify(s)}`);
      return;
    }
    if (i % 12 === 0) process.stdout.write(`\n⏳ ${(i*5)}秒...`);
    else process.stdout.write(".");
  }

  if (!videoUrl) { log("\n❌ 超时"); return; }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  log(`\n✅ 生成成功! 耗时 ${elapsed}秒`);
  log(`\n🎬 视频链接: ${videoUrl}`);

  // 下载到本地供访问
  const path = await import("path");
  const fs = await import("fs/promises");
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const localDir = path.join(uploadDir, "videos", "demo");
  await fs.mkdir(localDir, { recursive: true });
  const localPath = path.join(localDir, "wan2.7-demo.mp4");

  const vResp = await fetch(videoUrl);
  if (vResp.ok) {
    const buf = Buffer.from(await vResp.arrayBuffer());
    await fs.writeFile(localPath, buf);
    log(`\n📁 本地文件: ${localPath}`);
    log(`   大小: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
    log(`   本地访问: http://localhost:8000/api/uploads/videos/demo/wan2.7-demo.mp4`);
  }
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
