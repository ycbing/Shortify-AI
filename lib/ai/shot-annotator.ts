// 分镜批量标注：LLM 为存量镜头补齐 emotion（情绪基调）、sfx（环境音效标签）与镜头语言
// 用途：老剧本没有这些字段，跑一次标注即可享受情感配音/音效/电影感运镜，无需重新生成剧本
import { chatCompletionJSON } from "@/lib/ai/glm-client";
import { parseSfxTags } from "@/lib/ai/sfx-library";
import type { Shot } from "@/types/drama";
import { normalizeShotLanguage } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("shot-annotator");

const SFX_TAG_LIST = "rain(雨声)/wind(风声)/thunder(雷声)/fire(火焰)/water(水流)/heartbeat(心跳)/clock(钟表滴答)/tension(紧张低频)/traffic(车流)";

export type AnnotateMode = "fill" | "overwrite";

interface ShotAnnotation {
  shotNumber: number;
  emotion?: string;
  sfx?: string;
  shotSize?: string;
  cameraAngle?: string;
  cameraMove?: string;
  lighting?: string;
  transition?: string;
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
    // 带上已有镜头语言，便于 LLM 保持景别/运镜的节奏变化
    shotSize: shot.shotSize,
    cameraMove: shot.cameraMove,
  };
}

/**
 * 为一批镜头标注 emotion / sfx / 镜头语言，返回合并后的新 shots 数组（不修改入参）
 * - fill 模式：只补齐缺失字段，已有标注（或用户手改）不覆盖
 * - overwrite 模式：全部重标
 * sfx 经别名归一化后存储（如 "雨" → "rain"）；镜头语言经归一化后仅保留合法 key
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
3. 镜头语言（只用以下英文 key）：
   - "shotSize" 景别: wide / full / medium / close / close_up / extreme_close_up
   - "cameraAngle" 机位: eye_level / high_angle / low_angle / over_shoulder / pov / aerial / dutch
   - "cameraMove" 运镜: static / push_in / pull_out / pan_left / pan_right / tilt_up / tilt_down / follow
   - "lighting" 光线: natural / warm / cool / backlight / neon / low_key
   - "transition" 转场（与上一镜头之间，第一个镜头填 cut）: cut / fade / fadeblack / fadewhite / dissolve / slideleft / slideright / circleopen

镜头语言规则：
- 对话镜头用 close 或 close_up，交代环境用 wide/full，情绪爆发用 close_up/extreme_close_up
- 相邻镜头景别不要连续 3 个相同；普通对话用 static，紧张强调才用 push_in（整集不超过 2~3 次）
- 同一场景内连续对话用 cut；时间/空间跳跃或场景切换用 fade/fadeblack；闪回用 dissolve

只输出 JSON：{"annotations":[{"shotNumber":1,"emotion":"紧张","sfx":"rain","shotSize":"close_up","cameraAngle":"eye_level","cameraMove":"push_in","lighting":"cool","transition":"cut"}]}
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
  let languageSet = 0;
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

    // 镜头语言：逐字段判定是否允许写入（fill 模式不覆盖已有值）
    const normalized = normalizeShotLanguage(a);
    for (const [field, value] of Object.entries(normalized)) {
      const key = field as keyof Shot;
      if (mode === "overwrite" || !shot[key]) {
        Object.assign(next, { [field]: value });
        languageSet++;
      }
    }

    return next;
  });

  log.info("Shots annotated", {
    total: shots.length,
    annotated: annotations.length,
    emotionSet,
    sfxSet,
    languageSet,
    mode,
  });
  return merged;
}
