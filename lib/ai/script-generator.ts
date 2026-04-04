import { chatCompletionJSON } from "./glm-client";
import type {
  GeneratedScriptV2,
  GeneratedEpisodeV2,
  Shot,
  Character,
  DramaGenreType,
  DramaStyleType,
} from "@/types/drama";

const GENRE_MAP: Record<DramaGenreType, string> = {
  mystery: "悬疑",
  romance: "爱情",
  comedy: "喜剧",
  scifi: "科幻",
  horror: "恐怖",
};

const STYLE_MAP: Record<DramaStyleType, string> = {
  realistic: "写实",
  anime: "动漫",
  ink: "水墨",
  cyberpunk: "赛博朋克",
};

const STYLE_IMAGE_PROMPT: Record<DramaStyleType, string> = {
  realistic: "写实摄影风格，高清照片质感，自然光线，真实场景",
  anime: "日式动漫风格，色彩鲜艳，线条清晰，精美插画",
  ink: "中国传统水墨画风格，意境深远，留白构图，墨色渲染",
  cyberpunk: "赛博朋克风格，霓虹灯光，未来科技感，暗色调配高饱和色彩",
};

/**
 * Generate script in v2 shot-based format with character dialogues
 */
export async function generateScript(
  theme: string,
  genre: DramaGenreType,
  style: DramaStyleType,
  episodeCount: number
): Promise<GeneratedScriptV2> {
  const systemPrompt = `你是一个专业的短剧编剧。你需要根据用户给出的主题、题材和画风，创作一部精彩的短剧剧本。

## 输出要求

1. **集数**: 共 ${episodeCount} 集
2. **每集时长**: 30-60 秒（由 shots 累计时长决定）
3. **shots**: 每集由多个镜头(shots)组成，每个 shot 3-8 秒
4. **角色对话**: 必须有角色对话（不只是旁白），对话要有冲突、悬念、情感张力
5. **角色外貌**: 描述要详细且一致（同一角色在所有镜头中描述一致）
6. **sceneDescription**: 要详细到可以直接生成图片，包含场景、光线、构图
7. **角色对话用引号**，旁白/字幕描述用括号
8. **每集结尾留钩子**，让观众想看下一集

## 画风
${STYLE_MAP[style]}：${STYLE_IMAGE_PROMPT[style]}

## 音色选择 (voiceId)
- 男声-年轻: zh-CN-YunxiNeural
- 男声-中年: zh-CN-YunjianNeural
- 女声-年轻: zh-CN-XiaoxiaoNeural
- 女声-中年: zh-CN-XiaomengNeural
- 旁白: zh-CN-YunyangNeural

## BGM 类型
suspense(悬疑), romantic(浪漫), tense(紧张), calm(平静), dramatic(戏剧性), happy(欢快)

## JSON 输出格式

{
  "title": "短剧标题",
  "characters": [
    { "name": "角色名", "description": "角色简介", "voiceId": "zh-CN-YunxiNeural", "appearance": "详细固定外貌描述（性别+年龄+发型+五官+体型+服装+配饰）" }
  ],
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "第一集标题",
      "sceneDescription": "完整的场景描述（包含角色外貌+场景+光线+构图+画风：${STYLE_IMAGE_PROMPT[style]}），用于生成图片",
      "shots": [
        {
          "shotNumber": 1,
          "visual": "镜头画面描述（包含角色动作、表情、场景细节），用于生成该镜头的图片/视频",
          "duration": 5,
          "type": "narration",
          "subtitle": "旁白或字幕文本",
          "bgm": "suspense"
        },
        {
          "shotNumber": 2,
          "visual": "角色特写画面描述",
          "duration": 3,
          "type": "dialogue",
          "character": "角色名（必须与 characters 中的一致）",
          "line": "角色台词",
          "voiceId": "zh-CN-YunxiNeural（使用该角色的 voiceId）"
        },
        {
          "shotNumber": 3,
          "visual": "另一角色画面描述",
          "duration": 4,
          "type": "dialogue",
          "character": "另一角色名",
          "line": "角色台词",
          "voiceId": "zh-CN-XiaoxiaoNeural"
        }
      ]
    }
  ]
}

## 重要规则
- characters 数组中的角色描述必须包含详细外貌（年龄、发型、五官、穿着、体型）
- **角色外貌一致性规则（极其重要）**：
  1. 每个 character 必须包含 "appearance" 字段，格式为一段固定外貌描述
  2. appearance 包括：性别、年龄、发型（颜色+长度+样式）、脸型特征、体型、服装（颜色+款式）、标志性配饰
  3. 不同角色必须有至少 3 个明显不同特征（如不同发色、不同服装颜色、不同配饰）
  4. 服装颜色示例：角色A 白色T恤+蓝色牛仔裤，角色B 红色连衣裙+白色运动鞋，角色C 黑色西装+银色手表
  5. appearance 示例："20岁女大学生，黑色长发扎马尾，大眼睛双眼皮，皮肤白皙，身材纤细，穿白色T恤和浅蓝色牛仔裤，戴银色项链"
- 每个 shot 的 visual 描述中，必须引用对应角色的 appearance 外貌描述，以保证图片生成的一致性
- dialogue 类型的 shot 必须有 character（角色名）、line（台词）、voiceId（音色）
- narration 类型的 shot 必须有 subtitle（字幕文本），不需要 voiceId
- 同一角色在所有镜头中的 voiceId 必须一致，appearance 描述也必须一致
- 每集至少 5-10 个 shots，总时长 30-60 秒
- sceneDescription 中要包含完整的环境描述，画风：${STYLE_IMAGE_PROMPT[style]}

## 角色描述 JSON 格式示例
{ "name": "苏小暖", "description": "女主角，活泼开朗", "voiceId": "zh-CN-XiaoxiaoNeural", "appearance": "20岁女大学生，黑色长发扎马尾，大眼睛双眼皮，皮肤白皙，身材纤细，穿白色T恤和浅蓝色牛仔裤，戴银色项链" }`;

  const userPrompt = `请创作一部短剧。
主题：${theme}
题材：${GENRE_MAP[genre]}
画风：${STYLE_MAP[style]}
集数：${episodeCount} 集

请确保剧情引人入胜，每集都有冲突和悬念，角色对话自然有张力。`;

  return chatCompletionJSON<GeneratedScriptV2>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.8 }
  );
}

export function getStyleImagePrompt(style: DramaStyleType): string {
  return STYLE_IMAGE_PROMPT[style];
}

/**
 * Extract narration text from v2 shots (for backward compatibility)
 */
export function extractNarrationFromShots(shots: Shot[]): string {
  return shots
    .map((shot) => {
      if (shot.type === "dialogue" && shot.line) {
        return `${shot.character}：${shot.line}`;
      }
      return shot.subtitle || "";
    })
    .filter(Boolean)
    .join("。");
}

/**
 * Extract scene description from v2 shots (first shot visual + sceneDescription)
 */
export function extractSceneFromEpisode(
  episode: GeneratedEpisodeV2
): string {
  return episode.sceneDescription;
}

/**
 * Assign consistent character voiceIds to all dialogue shots
 */
export function ensureConsistentVoiceIds(
  characters: Character[],
  shots: Shot[]
): Shot[] {
  const voiceMap = new Map<string, string>();
  for (const c of characters) {
    voiceMap.set(c.name, c.voiceId);
  }

  return shots.map((shot) => {
    if (shot.type === "dialogue" && shot.character && !shot.voiceId) {
      return {
        ...shot,
        voiceId: voiceMap.get(shot.character) || "zh-CN-YunxiNeural",
      };
    }
    return shot;
  });
}
