// 分镜批量标注：LLM 为存量镜头补齐 emotion（情绪基调）与 sfx（环境音效标签）
// 用途：老剧本没有这两个字段，跑一次标注即可享受情感配音与音效，无需重新生成剧本
import { chatCompletionJSON } from "@/lib/ai/glm-client";
import { parseSfxTags } from "@/lib/ai/sfx-library";
import type { Shot } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("shot-annotator");

const SFX_TAG_LIST = "rain(雨声)/wind(风声)/thunder(雷声)/fire(火焰)/water(水流)/heartbeat(心跳)/clock(钟表滴答)/tension(紧张低频)/traffic(车流)";

export type AnnotateMode = "fill" | "overwrite";

interface ShotAnnotation {
  shotNumber: number;
  emotion?: string;
  sfx?: string;
}

/** 给 LLM 的紧凑镜头输入（省 token：不带图片/视频 URL 等无关字段） */
function compactShot(shot: Shot) {
  return {
    shotNumber: shot.shotNumber,
    type: shot.type || "narration",
    character: shot.character,
    line: shot.line,
    subtitle: shot.subtitle,
    visual: shot.visual?.slice(0, 200),
  };
}

/**
 * 为一批镜头标注 emotion / sfx，返回合并后的新 shots 数组（不修改入参）
 * - fill 模式：只补齐缺失字段，已有标注（或用户手改）不覆盖
 * - overwrite 模式：全部重标
 * sfx 经别名归一化后存储（如 "雨" → "rain"）
 */
export async function annotateShots(
  shots: Shot[],
  options?: {
    mode?: AnnotateMode;
    genre?: string | null;
  }
): Promise<Shot[]> {
  const mode = options?.mode || "fill";
  if (shots.length === 0) return shots;

  const systemPrompt = `你是短剧分镜标注助手。给定一组镜头，为每个镜头标注：
1. "emotion"：该镜头的情绪基调，8 字以内（如：平静/紧张/开心/悲伤/愤怒/惊讶/恐惧/温柔/兴奋/绝望），需与台词内容和画面相符
2. "sfx"：环境音效标签，0~2 个英文逗号分隔，只能从这些标签中选：${SFX_TAG_LIST}。只选画面或剧情中真实存在、能增强氛围的；没有合适的输出空字符串 ""

只输出 JSON：{"annotations":[{"shotNumber":1,"emotion":"紧张","sfx":"rain"}]}
必须覆盖输入的每一个 shotNumber，不要遗漏。`;

  const userPrompt = `请标注以下 ${shots.length} 个镜头${options?.genre ? `（题材：${options.genre}）` : ""}：
${JSON.stringify(shots.map(compactShot))}`;

  const result = await chatCompletionJSON<{ annotations: ShotAnnotation[] }>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.3 }
  );

  const annotations = Array.isArray(result?.annotations) ? result.annotations : [];
  const byNumber = new Map<number, ShotAnnotation>(
    annotations.map((a) => [Number(a.shotNumber), a])
  );

  let emotionSet = 0;
  let sfxSet = 0;
  const merged = shots.map((shot) => {
    const a = byNumber.get(shot.shotNumber);
    if (!a) return shot; // LLM 漏标 → 保持原样
    const next: Shot = { ...shot };

    const wantsEmotion = mode === "overwrite" || !shot.emotion;
    const emotion = (a.emotion || "").trim().slice(0, 12);
    if (wantsEmotion && emotion) {
      next.emotion = emotion;
      emotionSet++;
    }

    const wantsSfx = mode === "overwrite" || !shot.sfx;
    const sfxTags = parseSfxTags(a.sfx || "");
    if (wantsSfx && sfxTags.length > 0) {
      next.sfx = sfxTags.join(",");
      sfxSet++;
    }

    return next;
  });

  log.info("Shots annotated", {
    total: shots.length,
    annotated: annotations.length,
    emotionSet,
    sfxSet,
    mode,
  });
  return merged;
}
