import { chatCompletionJSON } from "./glm-client";
import type { GeneratedScript, GeneratedEpisode, DramaGenreType, DramaStyleType } from "@/types/drama";

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

export async function generateScript(
  theme: string,
  genre: DramaGenreType,
  style: DramaStyleType,
  episodeCount: number
): Promise<GeneratedScript> {
  const systemPrompt = `你是一个专业的短剧编剧。你需要根据用户给出的主题、题材和画风，创作一部精彩的短剧剧本。

输出要求：
1. 每集时长 30-60 秒（旁白字数控制在 80-150 字）
2. 旁白要简洁有画面感，适合作为视频旁白朗读
3. 场景描述要详细，适合 AI 图片生成（包含人物外貌、场景细节、构图方式、色调氛围）
4. 剧情要有反转或悬念，每集结尾留钩子
5. 角色要有辨识度，固定角色外貌描述以保证一致性

你必须输出严格的 JSON 格式，包含以下结构：
{
  "title": "短剧标题",
  "characters": [
    { "name": "角色名", "appearance": "角色外貌描述" }
  ],
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "第一集标题",
      "narration": "旁白文本（用于 TTS 朗读）",
      "sceneDescription": "画面描述（包含角色外貌、场景、构图、色调，用于 AI 图片生成。画风：${STYLE_IMAGE_PROMPT[style]}）",
      "dialogues": [
        { "character": "角色名", "line": "台词" }
      ],
      "duration": 30
    }
  ]
}

注意：
- 共 ${episodeCount} 集
- 题材为${GENRE_MAP[genre]}
- 画风为${STYLE_MAP[style]}
- sceneDescription 中必须包含角色外貌描述以保证角色一致性
- sceneDescription 中必须包含"画风：${STYLE_IMAGE_PROMPT[style]}"的描述`;

  const userPrompt = `请创作一部短剧。
主题：${theme}
题材：${GENRE_MAP[genre]}
画风：${STYLE_MAP[style]}
集数：${episodeCount} 集

请确保剧情引人入胜，每集都有看点。`;

  return chatCompletionJSON<GeneratedScript>(
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
