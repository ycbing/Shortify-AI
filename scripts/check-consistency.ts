/**
 * 角色一致性检查：对比角色参考图与各分镜图，输出跨镜头"换脸"评分
 *
 * 用法: npx tsx scripts/check-consistency.ts <dramaId>
 *
 * 原理：取每个角色的参考图（referenceImageUrl）与其出现的各镜头分镜图，
 * 交给视觉模型（GLM-4V 系列）做同一人物判定，汇总通过率。
 * 阈值默认 0.6，可用 CONSISTENCY_THRESHOLD 环境变量覆盖。
 * 有任一角色通过率低于阈值时以退出码 1 结束，可用于 CI 门禁。
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs/promises";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const GLM_API_KEY = process.env.GLM_API_KEY || "";
const VISION_MODEL = process.env.GLM_VISION_MODEL || "glm-4v-plus";
const THRESHOLD = Number(process.env.CONSISTENCY_THRESHOLD || "0.6");
const MAX_SHOTS_PER_CHAR = Number(process.env.MAX_SHOTS_PER_CHAR || "6");

function log(s: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

interface Character {
  name: string;
  referenceImageUrl?: string;
}
interface Shot {
  shotNumber: number;
  character?: string;
  imageUrl?: string;
}
interface Verdict {
  same_person: boolean;
  confidence: number; // 0-1
  reason: string;
}

/** 优先读本地缓存文件，其次用远程 URL，统一转成 data URL / URL 供视觉模型读取 */
async function resolveImageSource(
  localPath: string,
  remoteUrl?: string
): Promise<string | null> {
  try {
    const buf = await fs.readFile(localPath);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    // 本地不存在，尝试远程
  }
  if (remoteUrl && /^https?:\/\//.test(remoteUrl)) {
    try {
      const resp = await fetch(remoteUrl);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      }
    } catch {
      // 下载失败
    }
  }
  return null;
}

async function compareFaces(
  refDataUrl: string,
  shotDataUrl: string,
  characterName: string
): Promise<Verdict | null> {
  const body = {
    model: VISION_MODEL,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: refDataUrl } },
          { type: "image_url", image_url: { url: shotDataUrl } },
          {
            type: "text",
            text:
              `第一张图是角色"${characterName}"的参考图，第二张图是同一角色的分镜图。` +
              `请判断两张图中是否为同一人物（对比脸型、五官、发型；服装允许不同）。` +
              `只输出 JSON：{"same_person": true/false, "confidence": 0到1的小数, "reason": "一句话理由"}`,
          },
        ],
      },
    ],
  };

  const resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    log(`  ⚠️ 视觉模型调用失败: ${resp.status}`);
    return null;
  }
  const result = await resp.json();
  const text: string = result.choices?.[0]?.message?.content || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as Verdict;
  } catch {
    return null;
  }
}

async function main() {
  const dramaId = process.argv[2];
  if (!dramaId) {
    console.error("用法: npx tsx scripts/check-consistency.ts <dramaId>");
    process.exit(2);
  }
  if (!GLM_API_KEY) {
    console.error("缺少 GLM_API_KEY");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const drama = (
    await pool.query("SELECT characters FROM dramas WHERE id=$1", [dramaId])
  ).rows[0];
  if (!drama) {
    console.error(`短剧不存在: ${dramaId}`);
    process.exit(2);
  }
  const eps = (
    await pool.query(
      "SELECT episode_number, shot_data FROM episodes WHERE drama_id=$1 ORDER BY episode_number",
      [dramaId]
    )
  ).rows;

  const characters: Character[] = Array.isArray(drama.characters)
    ? drama.characters
    : JSON.parse(drama.characters || "[]");

  // 汇总每个角色出现的镜头（跨集）
  const charShots = new Map<string, { episode: number; shot: Shot }[]>();
  for (const ep of eps) {
    const shots: Shot[] =
      typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data || [];
    for (const shot of shots) {
      if (!shot.character) continue;
      const list = charShots.get(shot.character) || [];
      list.push({ episode: ep.episode_number, shot });
      charShots.set(shot.character, list);
    }
  }

  let overallPass = true;
  const report: { character: string; rate: number; total: number }[] = [];

  for (const character of characters) {
    const name = character.name;
    const shots = (charShots.get(name) || []).filter((s) => s.shot.imageUrl);
    log(`\n🎭 角色 ${name}：出现于 ${shots.length} 个有图镜头`);

    if (!character.referenceImageUrl) {
      log("  ⚠️ 无参考图（referenceImageUrl 为空），跳过");
      report.push({ character: name, rate: NaN, total: 0 });
      overallPass = false;
      continue;
    }
    if (shots.length === 0) {
      log("  ⚠️ 无带图镜头，跳过");
      report.push({ character: name, rate: NaN, total: 0 });
      continue;
    }

    const refSource = await resolveImageSource(
      path.join(UPLOAD_DIR, "images", dramaId, "characters", `${name}.jpg`),
      character.referenceImageUrl
    );
    if (!refSource) {
      log("  ❌ 参考图不可读（本地与远程均失败）");
      report.push({ character: name, rate: NaN, total: 0 });
      overallPass = false;
      continue;
    }

    // 均匀抽样，避免长剧只看前几集
    const step = Math.max(1, Math.ceil(shots.length / MAX_SHOTS_PER_CHAR));
    const sampled = shots.filter((_, i) => i % step === 0).slice(0, MAX_SHOTS_PER_CHAR);

    let same = 0;
    let judged = 0;
    for (const { episode, shot } of sampled) {
      const shotSource = await resolveImageSource(
        path.join(UPLOAD_DIR, "images", dramaId, `episode-${episode}`, `shot-${shot.shotNumber}.jpg`),
        shot.imageUrl
      );
      if (!shotSource) {
        log(`  ⏭️  E${episode}-镜头${shot.shotNumber}: 图片不可读，跳过`);
        continue;
      }

      const verdict = await compareFaces(refSource, shotSource, name);
      await sleep(500); // 简单限速
      if (!verdict) continue;
      judged++;
      const ok = verdict.same_person && verdict.confidence >= 0.5;
      if (ok) same++;
      log(
        `  ${ok ? "✅" : "❌"} E${episode}-镜头${shot.shotNumber}: ` +
          `${verdict.same_person ? "同一人" : "不同人"} (置信度 ${verdict.confidence}) ${verdict.reason || ""}`
      );
    }

    if (judged === 0) {
      log("  ⚠️ 没有可判定的镜头");
      report.push({ character: name, rate: NaN, total: 0 });
      overallPass = false;
      continue;
    }

    const rate = same / judged;
    report.push({ character: name, rate, total: judged });
    if (rate < THRESHOLD) {
      overallPass = false;
      log(`  📉 一致性 ${(rate * 100).toFixed(0)}%（${same}/${judged}），低于阈值 ${THRESHOLD}`);
    } else {
      log(`  📈 一致性 ${(rate * 100).toFixed(0)}%（${same}/${judged}）`);
    }
  }

  await pool.end();

  log("\n" + "=".repeat(50));
  log("📋 一致性报告");
  for (const r of report) {
    const rateStr = Number.isNaN(r.rate) ? "N/A" : `${(r.rate * 100).toFixed(0)}%`;
    log(`  ${r.character}: ${rateStr} (${r.total} 镜头)`);
  }
  log(`\n${overallPass ? "✅ 全部通过" : "❌ 存在低于阈值或不完整的角色"}`);
  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(2);
});
