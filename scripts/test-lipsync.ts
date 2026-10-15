/**
 * 可灵对口型冒烟测试：提交 公网视频 + 公网音频 → 轮询 → 输出结果 URL
 *
 * 用法: npx tsx scripts/test-lipsync.ts <videoUrl> <audioUrl>
 * 视频/音频需公网可访问（可用 COS 签名 URL）；要求 KLING_ACCESS_KEY/SECRET_KEY
 * 及 KLING_LIPSYNC=true（仅本脚本验证 API 连通性，不检查开关）。
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { submitLipSyncWithRetry, waitForLipSync, isKlingConfigured } from "@/lib/ai/kling-client";

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function main() {
  const [, , videoUrl, audioUrl] = process.argv;
  if (!videoUrl || !audioUrl) {
    console.error("用法: npx tsx scripts/test-lipsync.ts <videoUrl> <audioUrl>");
    process.exit(2);
  }
  if (!isKlingConfigured()) {
    console.error("❌ 缺少 KLING_ACCESS_KEY / KLING_SECRET_KEY");
    process.exit(1);
  }

  log("提交对口型任务...");
  const taskId = await submitLipSyncWithRetry(videoUrl, audioUrl);
  log(`✅ 任务已提交: ${taskId}`);

  log("轮询中（最长 10 分钟）...");
  const resultUrl = await waitForLipSync(taskId, { pollMs: 8000 });
  log(`✅ 对口型完成: ${resultUrl}`);
  log("请下载对比：人物口型是否与音频台词匹配");
}

main().catch((err) => {
  console.error("❌ 失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
