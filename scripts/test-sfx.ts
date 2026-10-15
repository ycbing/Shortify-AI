/**
 * SFX 音效库冒烟测试：合成全部内置预设 + 混音验证
 *
 * 用法: npx tsx scripts/test-sfx.ts
 * 产物在 uploads/test/sfx/ 下：
 *   - 各标签预设 mp3（试听判断合成效果）
 *   - mixed-*.mp3（正弦"配音" + 音效混音结果，验证混音链路）
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { resolveSfxFile, mixSfxIntoVoiceover, parseSfxTags } from "@/lib/ai/sfx-library";

const execAsync = promisify(exec);
const outDir = path.resolve("./uploads", "test", "sfx");

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  // 1. 全部预设合成（清空缓存强制重新生成）
  await fs.rm(path.resolve("./uploads", "sfx-cache"), { recursive: true, force: true });
  const tags = ["rain", "wind", "thunder", "fire", "water", "heartbeat", "clock", "tension", "traffic"];
  for (const tag of tags) {
    const file = await resolveSfxFile([tag]);
    if (file) {
      // 拷贝到测试目录便于集中试听
      await fs.copyFile(file, path.join(outDir, `preset-${tag}.mp3`));
      log(`✅ 预设 ${tag}: ${file}`);
    } else {
      log(`❌ 预设 ${tag} 合成失败`);
    }
  }

  // 2. 中文别名归一化
  log(`别名解析: "雨,door" → [${parseSfxTags("雨,door").join(", ")}]（应为 rain, door）`);

  // 3. 混音链路：生成 5 秒正弦波当"配音"，混入雨声
  const voicePath = path.join(outDir, "fake-voice.mp3");
  await execAsync(`ffmpeg -y -f lavfi -i "sine=f=440:d=5" -c:a libmp3lame "${voicePath}"`);
  const ok = await mixSfxIntoVoiceover(voicePath, ["rain"]);
  log(ok ? `✅ 混音完成: ${voicePath}（应为 440Hz 正弦垫雨声，音量约 0.2）` : "❌ 混音失败");

  // 4. 时长校验（混音不应改变时长）
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`
  );
  log(`混音后时长: ${parseFloat(stdout).toFixed(2)}s（应约 5s）`);

  log(`\n📋 请试听 ${outDir}/ 下的预设文件`);
}

main().catch((err) => {
  console.error("❌ 失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
