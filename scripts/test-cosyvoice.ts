/**
 * CosyVoice 情感配音冒烟测试
 *
 * 用法: npx tsx scripts/test-cosyvoice.ts
 *
 * 验证：1) HTTP API 连通性与 endpoint 正确性 2) 情感指令生效 3) 音色映射
 * 输出两个 mp3（同一段台词，带/不带情感指令），人工试听对比。
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  cosyVoiceTts,
  isCosyVoiceConfigured,
  toCosyVoiceVoice,
} from "@/lib/ai/cosyvoice-tts";

const execAsync = promisify(exec);

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function main() {
  log(`COSYVOICE_MODEL=${process.env.COSYVOICE_MODEL || "cosyvoice-v2 (default)"}`);
  if (!isCosyVoiceConfigured()) {
    console.error("❌ DASHSCOPE_API_KEY 未配置");
    process.exit(1);
  }

  const text = "你竟然骗了我整整三年！我今天才明白，从一开始就是个局。";
  const outDir = path.resolve("./uploads", "test");
  const flat = path.join(outDir, "cosyvoice-flat.mp3");
  const angry = path.join(outDir, "cosyvoice-angry.mp3");

  log("\nStep 1: 无情感指令（基线）...");
  await cosyVoiceTts(text, flat, {
    voice: toCosyVoiceVoice("zh-CN-XiaoxiaoNeural"),
  });
  log(`✅ ${flat}`);

  log("\nStep 2: 愤怒情感指令...");
  await cosyVoiceTts(text, angry, {
    voice: toCosyVoiceVoice("zh-CN-XiaoxiaoNeural"),
    instruction: "用愤怒的语气",
  });
  log(`✅ ${angry}`);

  for (const f of [flat, angry]) {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${f}"`
    );
    log(`   ${path.basename(f)}: ${parseFloat(stdout).toFixed(1)}s`);
  }

  log("\n📋 请试听两个文件，对比愤怒版是否情感明显");
}

main().catch((err) => {
  console.error("❌ 失败:", err instanceof Error ? err.message : err);
  console.error("（若为 404，请检查 COSYVOICE endpoint 路径是否与服务区域匹配）");
  process.exit(1);
});
