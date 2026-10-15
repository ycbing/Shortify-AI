/**
 * 参考图生图冒烟测试：验证 wan2.7 多图参考（角色一致性）链路
 *
 * 用法: npx tsx scripts/test-reference-image.ts
 *
 * 流程：先生成一张角色定妆照，再用它作为参考图生成场景图，
 * 人工核对两张图中角色面貌是否一致。
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { generateWan27ImagePro } from "@/lib/ai/wan-image-generator";

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

async function main() {
  log(`IMAGE_MODEL=${process.env.IMAGE_MODEL || "wan2.7-image-pro (default)"}`);
  log("Step 1: 生成角色定妆照...");

  const refUrl = await generateWan27ImagePro(
    "林小雨正面半身肖像，22岁女性，黑色长发扎马尾，大眼睛双眼皮，皮肤白皙，穿米白色高领毛衣，白色纯色背景，摄影棚均匀打光，高清摄影，面部五官清晰，自然表情，看向前方",
    { size: "1024*1024", thinkingMode: false }
  );
  log(`✅ 定妆照: ${refUrl}`);

  log("\nStep 2: 用定妆照作参考图生成横屏场景图...");
  log("⚠️  请人工核对场景图中的角色与定妆照是否同脸");

  const sceneUrl = await generateWan27ImagePro(
    "她在深夜的城市天台上眺望远方，风吹起发丝，霓虹灯光映在脸上，电影感画面，宽屏16:9构图",
    {
      size: "1920*1080",
      referenceImages: [{ url: refUrl, label: "林小雨" }],
    }
  );
  log(`✅ 场景图: ${sceneUrl}`);

  log("\n📋 请打开上面两个 URL 对比角色面貌一致性");
}

main().catch((err) => {
  console.error("❌ 失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
