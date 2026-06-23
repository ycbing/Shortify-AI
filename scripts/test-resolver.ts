import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { resolveConfig } from "@/lib/ai/model-resolver";

async function main() {
  console.log("Testing model resolver...\n");

  for (const svc of ["llm", "image", "tts", "video"] as const) {
    try {
      const cfg = await resolveConfig(null, svc);
      const status = cfg.source === "global" ? "✅ DB" : cfg.source === "env" ? "✅ ENV" : "❓";
      console.log(`  ${svc.padEnd(8)} ${status} → ${cfg.provider} / ${cfg.modelName}`);
    } catch (e: any) {
      console.error(`  ${svc.padEnd(8)} ❌ ERROR: ${e.message?.substring(0, 100)}`);
    }
  }
}
main().catch(e => console.error(e));
