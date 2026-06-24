import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Re-read env after dotenv
const envKey = process.env.DASHSCOPE_API_KEY || "";
console.log(`DASHSCOPE_API_KEY from env: ${envKey.substring(0,10)}...`);

import { generateWan27ImagePro } from "@/lib/ai/wan-image-generator";

async function main() {
  log(`IMAGE_MODEL=${process.env.IMAGE_MODEL}`);
  
  try {
    const url = await generateWan27ImagePro("一个年轻的程序员在深夜的办公室里敲击键盘，专注的神情，电脑屏幕发出蓝色荧光，窗外城市夜景", {
      size: "1K",
      thinkingMode: false,
    });
    log(`\n✅ 图片生成成功:`);
    log(url);
    
    const resp = await fetch(url);
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      log(`大小: ${(buf.length/1024).toFixed(0)}KB`);
    } else {
      log(`下载失败: ${resp.status}`);
    }
  } catch (err) {
    log(`\n❌ 失败: ${(err as Error).message}`);
  }
}
function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }
main().catch(e => console.error(e));
