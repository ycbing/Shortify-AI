/**
 * 声音复刻冒烟测试：本地样本 → COS → Voice Enrollment → 用复刻音色合成一句话
 *
 * 用法: npx tsx scripts/test-voice-clone.ts <样本音频路径>
 * 样本要求: 10~20 秒清晰人声（mp3/wav），试听 uploads/test/clone-voice.mp3 对比效果
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import path from "path";
import fs from "fs/promises";
import { enrollVoice, voiceEnrollPrefix } from "@/lib/ai/cosyvoice-clone";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { cosyVoiceTts } from "@/lib/ai/cosyvoice-tts";

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function main() {
  const samplePath = process.argv[2];
  if (!samplePath) {
    console.error("用法: npx tsx scripts/test-voice-clone.ts <样本音频路径>");
    process.exit(2);
  }
  const buffer = await fs.readFile(samplePath);
  log(`样本: ${samplePath} (${(buffer.length / 1024).toFixed(0)}KB)`);

  log("\nStep 1: 上传样本到 COS...");
  const cosKey = `voice-samples/test/sample-${Date.now()}.mp3`;
  const sampleUrl = await uploadFileToCos(samplePath, cosKey);
  log(`✅ ${sampleUrl.substring(0, 80)}...`);

  log("\nStep 2: 注册复刻音色...");
  const voiceId = await enrollVoice(sampleUrl, voiceEnrollPrefix("test-drama", "冒烟测试"));
  log(`✅ 复刻音色: ${voiceId}`);

  log("\nStep 3: 用复刻音色合成一句话...");
  const outPath = path.resolve("./uploads", "test", "clone-voice.mp3");
  await cosyVoiceTts("这是我的专属音色生成的第一句话，和原声音像不像？", outPath, {
    voice: voiceId,
    instruction: "用开心的语气",
  });
  log(`✅ ${outPath}（请试听对比原样本）`);
}

main().catch((err) => {
  console.error("❌ 失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
