import { chatCompletionJSON } from "./glm-client";
import type {
  GeneratedScriptV2,
  GeneratedEpisodeV2,
  Shot,
  Character,
  DramaGenreType,
  DramaStyleType,
} from "@/types/drama";
import { normalizeShotLanguage } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("script-gen");

export const GENRE_MAP: Record<DramaGenreType, string> = {
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
4. **角色对话优先**: 每集 shots 中 dialogue（角色对话）占比必须 ≥ 60%，旁白 narration 仅用于过渡和背景说明。对话要有冲突、悬念、情感张力，尽量用角色对话推进剧情，减少旁白解说
5. **角色外貌**: 描述要详细且一致（同一角色在所有镜头中描述一致）
6. **sceneDescription**: 要详细到可以直接生成图片，包含场景、光线、构图
7. **角色对话用引号**，旁白/字幕描述用括号
8. **每集结尾留钩子**，让观众想看下一集

## 画风
${STYLE_MAP[style]}：${STYLE_IMAGE_PROMPT[style]}

## 音色选择 (voiceId)
从以下音色池中选择，**每个角色必须使用不同的音色**（根据角色性别与年龄气质挑选，主角音色与配角明显区分）：
- 女声-温柔: longwan
- 女声-活力: longxiaochun
- 女声-清亮: longxiaoxia
- 女声-标准: loongbella
- 男声-阳光: longcheng
- 男声-沉稳: longhua
- 男声-书卷: longshu

## BGM 类型
suspense(悬疑), romantic(浪漫), tense(紧张), calm(平静), dramatic(戏剧性), happy(欢快)

## 镜头语言（每个 shot 必填，决定画面电影感，极其重要）
不要只写"画面里有什么"，必须像分镜师一样指定摄影机怎么拍。允许的取值（**只能填英文 key**）：

- shotSize（景别）: wide(远景) / full(全景) / medium(中景) / close(近景) / close_up(特写) / extreme_close_up(大特写)
- cameraAngle（机位）: eye_level(平视) / high_angle(俯视) / low_angle(仰视) / over_shoulder(过肩) / pov(主观) / aerial(航拍俯瞰) / dutch(倾斜)
- cameraMove（运镜）: static(固定) / push_in(推近) / pull_out(拉远) / pan_left(向左平移) / pan_right(向右平移) / tilt_up(向上摇) / tilt_down(向下摇) / follow(跟随)
- lighting（光线）: natural(自然光) / warm(暖光) / cool(冷光) / backlight(逆光) / neon(霓虹) / low_key(低调暗部)
- transition（与上一镜头之间的转场，第一个镜头填 cut）: cut(硬切) / fade(淡入淡出) / fadeblack(黑场) / fadewhite(白场) / dissolve(溶解) / slideleft(左滑) / slideright(右滑) / circleopen(圆形展开)

分镜规则：
1. **景别要有节奏变化**：同一集内不要出现连续 3 个以上相同景别。交代环境用 wide/full，推进剧情用 medium，情绪爆发用 close/close_up，关键细节用 extreme_close_up
2. **对话镜头用 close 或 close_up**，突出表情；两人对峙可用 over_shoulder
3. **cameraMove 服务情绪**：紧张/压迫用 push_in，失落/收尾用 pull_out，交代空间用 pan_left/pan_right，普通对话用 static。**不要每个镜头都运动**，一集中 push_in 这类强调运镜不超过 2-3 次
4. **lighting 服务氛围**：白天室内 natural/warm，悬疑冷峻 cool/low_key，反派或危险 low_key，都市夜景 neon，情绪转折 backlight
5. **transition 服务节奏**：同一场景内连续对话用 cut（硬切最自然），时间/空间跳跃用 fade 或 fadeblack，回忆/闪回用 dissolve，强调反差用 fadeblack
6. cameraAngle 用于表达权力关系：强势方 low_angle，弱势方 high_angle，眩晕不安 dutch

## JSON 输出格式

{
  "title": "短剧标题",
  "characters": [
    { "name": "角色名", "description": "角色简介", "voiceId": "longcheng", "appearance": "详细固定外貌描述（性别+年龄+发型+五官+体型+服装+配饰）" }
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
          "emotion": "紧张",
          "sfx": "rain",
          "bgm": "suspense",
          "shotSize": "wide",
          "cameraAngle": "high_angle",
          "cameraMove": "pan_right",
          "lighting": "low_key",
          "transition": "cut"
        },
        {
          "shotNumber": 2,
          "visual": "角色特写画面描述",
          "duration": 3,
          "type": "dialogue",
          "character": "角色名（必须与 characters 中的一致）",
          "line": "角色台词",
          "voiceId": "longcheng（使用该角色的 voiceId）",
          "emotion": "惊讶",
          "shotSize": "close_up",
          "cameraAngle": "eye_level",
          "cameraMove": "push_in",
          "lighting": "cool",
          "transition": "cut"
        },
        {
          "shotNumber": 3,
          "visual": "另一角色画面描述",
          "duration": 4,
          "type": "dialogue",
          "character": "另一角色名",
          "line": "角色台词",
          "voiceId": "longwan",
          "emotion": "温柔",
          "shotSize": "medium",
          "cameraAngle": "over_shoulder",
          "cameraMove": "static",
          "lighting": "warm",
          "transition": "fade"
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
- 每个 shot 必须有 "emotion" 字段（该镜头的情绪基调，8 字以内，从：平静/紧张/开心/悲伤/愤怒/惊讶/恐惧/温柔/兴奋/绝望 中选择或自拟），用于驱动语音合成的情感表达，需与台词内容和剧情相符
- 每个 shot 建议有 "sfx" 字段（该镜头的环境音效标签，0~2 个，用英文逗号分隔），可用标签：rain(雨声)/wind(风声)/thunder(雷声)/fire(火焰)/water(水流)/heartbeat(心跳)/clock(钟表)/tension(紧张低频)/traffic(车流)。只选画面中真实存在或能增强氛围的，没有合适的就省略
- 同一角色在所有镜头中的 voiceId 必须一致，appearance 描述也必须一致
- **每个 shot 必须包含 shotSize / cameraAngle / cameraMove / lighting / transition 五个字段**，取值只能来自上面「镜头语言」列出的英文 key。缺失任一字段视为不合格输出
- 每个 shot 的 shotSize、cameraMove、lighting 不应与前一个镜头完全相同（有意为之的固定镜头除外）；transition 只有在场景/时间/情绪真正切换时才用非 cut
- **不同角色的 voiceId 必须互不相同**（两个角色同音色会让观众混淆），角色超过 7 个时允许旁白类配角复用音色
- 每集至少 5-10 个 shots，总时长 30-60 秒
- **对话比例要求（极其重要）**: 每集的 shots 中，dialogue 类型必须占 60% 以上，narration 最多不超过 40%。用角色之间的对话推进剧情，避免大量旁白
- sceneDescription 中要包含完整的环境描述，画风：${STYLE_IMAGE_PROMPT[style]}
- **内容安全规则（重要）**：
  - visual 描述中避免使用暴力、血腥、恐怖、武器、犯罪、死亡等敏感词汇
  - 不要描述"尸体""血""刀""枪""爆炸""打斗""杀人"等场景
  - 用委婉表达替代："受伤"→"痛苦的表情"，"案发现场"→"调查现场"，"审讯"→"对话"
  - 场景优先选择安全正面场景：办公室、咖啡厅、公园、街道、家中、学校
  - 避免"警服""警徽""手铐"等执法元素，用"职业装""正装"替代
  - 悬疑类剧情通过表情、光影、氛围来营造紧张感，而非暴力画面

## 角色描述 JSON 格式示例
{ "name": "苏小暖", "description": "女主角，活泼开朗", "voiceId": "longwan", "appearance": "20岁女大学生，黑色长发扎马尾，大眼睛双眼皮，皮肤白皙，身材纤细，穿白色T恤和浅蓝色牛仔裤，戴银色项链", "referenceImageUrl": "" }

## 镜头级角色一致性规则（核心）
- 每个 shot 的 visual 描述中，如果出现了某个角色，必须将该角色的完整 appearance 描述嵌入到 visual 文本中
- 这确保了图像生成时，每个镜头对同一角色的描述完全一致
- 示例：如果角色"苏小暖"出现在 shot 中，visual 必须包含"苏小暖，20岁女大学生，黑色长发扎马尾，大眼睛双眼皮，皮肤白皙，身材纤细，穿白色T恤和浅蓝色牛仔裤，戴银色项链"这段固定描述
- 不同镜头中同一角色的外观描述必须**完全相同**，不能有任何变化`;

  const userPrompt = `请创作一部短剧。
主题：${theme}
题材：${GENRE_MAP[genre]}
画风：${STYLE_MAP[style]}
集数：${episodeCount} 集

请确保剧情引人入胜，每集都有冲突和悬念，角色对话自然有张力。`;

  const script = await chatCompletionJSON<GeneratedScriptV2>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.8 }
  );

  return normalizeScriptShotLanguage(script);
}

/**
 * LLM 输出的镜头语言字段无法保证是合法 key（可能给中文标签或近似词），
 * 落库前统一归一化；无法识别的字段直接丢弃，由合成器回退到默认运镜。
 */
export function normalizeScriptShotLanguage<T extends GeneratedScriptV2>(
  script: T
): T {
  if (!script || !Array.isArray(script.episodes)) return script;
  return {
    ...script,
    episodes: script.episodes.map((episode) => ({
      ...episode,
      shots: Array.isArray(episode.shots)
        ? episode.shots.map((shot) => ({
            ...shot,
            ...normalizeShotLanguage(shot),
          }))
        : episode.shots,
    })),
  };
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
