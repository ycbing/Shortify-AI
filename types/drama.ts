export interface DramaStatus {
  draft: "草稿";
  generating: "生成中";
  script_ready: "剧本就绪";
  storyboard_ready: "分镜就绪";
  voiceover_ready: "配音就绪";
  completed: "已完成";
  error: "生成失败";
}

export type DramaStatusType = keyof DramaStatus;

export interface DramaGenre {
  mystery: "悬疑";
  romance: "爱情";
  comedy: "喜剧";
  scifi: "科幻";
  horror: "恐怖";
}

export type DramaGenreType = keyof DramaGenre;

export interface DramaStyle {
  realistic: "写实";
  anime: "动漫";
  ink: "水墨";
  cyberpunk: "赛博朋克";
}

export type DramaStyleType = keyof DramaStyle;

// ============ Shot-based (v2) types ============

export interface Character {
  name: string;
  description: string;
  voiceId: string;
  /** Fixed appearance description for consistent image generation (e.g. "20岁女大学生，黑色长发扎马尾，穿白色T恤") */
  appearance?: string;
  /** Personality traits (optional, for richer character portrayal) */
  personality?: string;
  /** Reference image URL for consistent character appearance across shots */
  referenceImageUrl?: string;
}

export interface Shot {
  shotNumber: number;
  visual: string;
  duration: number;
  type?: "dialogue" | "narration";
  character?: string;
  line?: string;
  voiceId?: string;
  subtitle?: string;
  /** 该镜头情绪基调（如 平静/紧张/开心/悲伤/惊讶），驱动 TTS 情感指令 */
  emotion?: string;
  /** 音效标签（如 "rain" / "rain,door"），分号或逗号分隔，取第一个可解析项混入镜头配音 */
  sfx?: string;
  bgm?: string;
  /** 分镜图 URL（COS/本地），storyboard 生成后写回 */
  imageUrl?: string;
  aiVideoUrl?: string; // CogVideoX generated video local path

  // ============ 镜头语言（camera language） ============
  /** 景别：决定画面取景范围，写入生图提示词 */
  shotSize?: ShotSize;
  /** 机位/拍摄角度：决定视点关系，写入生图提示词 */
  cameraAngle?: CameraAngle;
  /** 运镜：静态图由合成器映射为 Ken Burns 运动；AI 视频写入生成提示词 */
  cameraMove?: CameraMove;
  /** 光线/氛围：写入生图提示词 */
  lighting?: LightingType;
  /**
   * 转场：本镜头与**上一镜头**之间的转场方式；第一个镜头的该字段被忽略。
   * `cut` 表示硬切；其余映射到 ffmpeg xfade。
   */
  transition?: ShotTransition;
}

export interface ShotAudio {
  shotNumber: number;
  audioUrl: string;
  duration: number;
  type: "dialogue" | "narration";
  character?: string;
}

// ============ New script format (v2) ============

export interface GeneratedScriptV2 {
  title: string;
  characters: Character[];
  episodes: GeneratedEpisodeV2[];
}

export interface GeneratedEpisodeV2 {
  episodeNumber: number;
  title: string;
  sceneDescription: string;
  shots: Shot[];
}

// ============ Legacy format (v1) ============

export interface GeneratedScript {
  title: string;
  episodes: GeneratedEpisode[];
}

export interface GeneratedEpisode {
  episodeNumber: number;
  title: string;
  narration: string;
  sceneDescription: string;
  dialogues: Dialogue[];
  duration: number;
}

export interface Dialogue {
  character: string;
  line: string;
}

// ============ Unified input ============

export interface CreateDramaInput {
  theme: string;
  genre: DramaGenreType;
  style: DramaStyleType;
  episodeCount: number;
}

export interface DramaWithEpisodes {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  style: string | null;
  status: string;
  coverUrl: string | null;
  shareCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  episodes: {
    id: string;
    episodeNumber: number;
    title: string | null;
    imageUrl: string | null;
    voiceoverUrl: string | null;
    videoUrl: string | null;
    duration: number | null;
  }[];
}

// ============ Helpers ============

/** Type guard: check if script is v2 (shot-based) format */
export function isScriptV2(
  script: GeneratedScript | GeneratedScriptV2
): script is GeneratedScriptV2 {
  return "characters" in script && Array.isArray((script as GeneratedScriptV2).characters);
}

/** Voice IDs available for selection */
export const VOICE_OPTIONS = {
  // CosyVoice 音色（默认优先，7 个独立音色保证多角色不同声）
  "女声-温柔": "longwan",
  "女声-活力": "longxiaochun",
  "女声-清亮": "longxiaoxia",
  "女声-标准": "loongbella",
  "男声-阳光": "longcheng",
  "男声-沉稳": "longhua",
  "男声-书卷": "longshu",
  // 旧版 Edge-TTS 音色（保留兼容已有作品）
  "男声-年轻(旧)": "zh-CN-YunxiNeural",
  "男声-中年(旧)": "zh-CN-YunjianNeural",
  "女声-年轻(旧)": "zh-CN-XiaoxiaoNeural",
  "女声-中年(旧)": "zh-CN-XiaomengNeural",
  "旁白(旧)": "zh-CN-YunyangNeural",
} as const;

export const NARRATION_VOICE = "zh-CN-YunyangNeural";

export type VoiceId = (typeof VOICE_OPTIONS)[keyof typeof VOICE_OPTIONS];

/** BGM type options */
export type BgmType =
  | "suspense"
  | "romantic"
  | "tense"
  | "calm"
  | "dramatic"
  | "happy";

export const BGM_LABELS: Record<BgmType, string> = {
  suspense: "悬疑",
  romantic: "浪漫",
  tense: "紧张",
  calm: "平静",
  dramatic: "戏剧性",
  happy: "欢快",
};

// ============ 镜头语言选项 ============
// 全部使用英文 key 作为稳定标识（LLM 产出 / JSON 存储 / 合成器映射），中文仅用于 UI 与提示词。

/** 景别 */
export const SHOT_SIZE_OPTIONS = {
  wide: "远景",
  full: "全景",
  medium: "中景",
  close: "近景",
  close_up: "特写",
  extreme_close_up: "大特写",
} as const;
export type ShotSize = keyof typeof SHOT_SIZE_OPTIONS;

/** 机位 / 拍摄角度 */
export const CAMERA_ANGLE_OPTIONS = {
  eye_level: "平视",
  high_angle: "俯视",
  low_angle: "仰视",
  over_shoulder: "过肩",
  pov: "主观视角",
  aerial: "航拍俯瞰",
  dutch: "倾斜",
} as const;
export type CameraAngle = keyof typeof CAMERA_ANGLE_OPTIONS;

/** 运镜 */
export const CAMERA_MOVE_OPTIONS = {
  static: "固定机位",
  push_in: "推近",
  pull_out: "拉远",
  pan_left: "向左平移",
  pan_right: "向右平移",
  tilt_up: "向上摇",
  tilt_down: "向下摇",
  follow: "跟随",
} as const;
export type CameraMove = keyof typeof CAMERA_MOVE_OPTIONS;

/** 光线 / 氛围 */
export const LIGHTING_OPTIONS = {
  natural: "自然光",
  warm: "暖光",
  cool: "冷光",
  backlight: "逆光",
  neon: "霓虹",
  low_key: "低调暗部",
} as const;
export type LightingType = keyof typeof LIGHTING_OPTIONS;

/**
 * 转场（本镜头与上一镜头之间）。
 * 除 `cut` 外的 key 与 `lib/ai/video-composer.ts` 的 xfade transition 名一一对应。
 */
export const SHOT_TRANSITION_OPTIONS = {
  cut: "硬切",
  fade: "淡入淡出",
  fadeblack: "黑场过渡",
  fadewhite: "白场过渡",
  dissolve: "溶解",
  slideleft: "左滑",
  slideright: "右滑",
  circleopen: "圆形展开",
} as const;
export type ShotTransition = keyof typeof SHOT_TRANSITION_OPTIONS;

/** 从「key → 中文标签」映射取标签，非法值返回 undefined */
export function labelOf(
  map: Record<string, string>,
  key?: string | null
): string | undefined {
  if (!key) return undefined;
  return map[key];
}

/**
 * 容错归一化：LLM 可能输出中文标签、大小写变体、空格/连字符写法或近似词，
 * 统一解析为规范英文 key。无法识别时返回 undefined（调用方丢弃该字段）。
 */
function normalizeOptionKey<T extends Record<string, string>>(
  map: T,
  raw: unknown
): Extract<keyof T, string> | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;

  const lower = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, lower)) {
    return lower as Extract<keyof T, string>;
  }

  // 中文标签匹配：标签长的优先，避免「大特写」被「特写」抢先命中
  const byLabelDesc = Object.entries(map).sort(
    (a, b) => b[1].length - a[1].length
  );
  for (const [key, label] of byLabelDesc) {
    if (value === label || value.includes(label)) {
      return key as Extract<keyof T, string>;
    }
  }

  // 英文写法归一：去掉空格/连字符/下划线后比对（push in → push_in, close-up → close_up）
  const squashed = lower.replace(/[\s\-_]/g, "");
  for (const key of Object.keys(map)) {
    if (key.replace(/_/g, "").toLowerCase() === squashed) {
      return key as Extract<keyof T, string>;
    }
  }
  return undefined;
}

/** 常见近似词补充（归一化兜底，覆盖 LLM 的习惯叫法） */
const OPTION_ALIASES: Record<string, string> = {
  大远景: "wide",
  中近景: "close",
  近景镜头: "close",
  特写镜头: "close_up",
  大特写镜头: "extreme_close_up",
  俯拍: "high_angle",
  仰拍: "low_angle",
  平角: "eye_level",
  正对镜头: "eye_level",
  航拍: "aerial",
  鸟瞰: "aerial",
  斜角: "dutch",
  推镜头: "push_in",
  拉镜头: "pull_out",
  摇镜: "pan_right",
  静止: "static",
  固定: "static",
  硬转: "cut",
  直接切换: "cut",
  叠化: "dissolve",
  淡出淡入: "fade",
};

function resolveOptionKey<T extends Record<string, string>>(
  map: T,
  raw: unknown
): Extract<keyof T, string> | undefined {
  const direct = normalizeOptionKey(map, raw);
  if (direct) return direct;
  if (typeof raw === "string") {
    const alias = OPTION_ALIASES[raw.trim()];
    if (alias && Object.prototype.hasOwnProperty.call(map, alias)) {
      return alias as Extract<keyof T, string>;
    }
  }
  return undefined;
}

const SHOT_LANGUAGE_FIELDS = [
  ["shotSize", SHOT_SIZE_OPTIONS],
  ["cameraAngle", CAMERA_ANGLE_OPTIONS],
  ["cameraMove", CAMERA_MOVE_OPTIONS],
  ["lighting", LIGHTING_OPTIONS],
  ["transition", SHOT_TRANSITION_OPTIONS],
] as const;

/**
 * 把任意来源（LLM / 用户输入 / 历史数据）的镜头语言字段归一化为合法 key。
 * 非法值被丢弃而不是原样存储，避免污染合成器映射。
 */
export function normalizeShotLanguage<
  T extends Partial<Record<(typeof SHOT_LANGUAGE_FIELDS)[number][0], unknown>>,
>(input: T): Partial<Record<(typeof SHOT_LANGUAGE_FIELDS)[number][0], string>> {
  const out: Record<string, string> = {};
  for (const [field, map] of SHOT_LANGUAGE_FIELDS) {
    const resolved = resolveOptionKey(
      map as Record<string, string>,
      (input as Record<string, unknown>)[field]
    );
    if (resolved) out[field] = resolved;
  }
  return out as Partial<Record<(typeof SHOT_LANGUAGE_FIELDS)[number][0], string>>;
}

/**
 * 空字符串表示「清除该标注」的字段。
 * 编辑弹窗把未设置的镜头语言以 "" 提交，直接落库会留下无意义的空串
 * （且会污染合成器映射），因此这些字段的空串要删除键而不是写入。
 */
export const CLEARABLE_SHOT_FIELDS = [
  "emotion",
  "sfx",
  "shotSize",
  "cameraAngle",
  "cameraMove",
  "lighting",
  "transition",
] as const;

/**
 * 归一化整个 shotData 数组（用于绕过 zod 的旧写入路径，
 * 例如剧本页的 PUT /api/dramas/[dramaId]）：
 * 镜头语言只保留合法 key，非法值与空串一律删除（回退到默认运镜与默认转场）。
 */
export function normalizeShotData<T>(shots: T): T {
  if (!Array.isArray(shots)) return shots;
  return shots.map((shot) => {
    if (!shot || typeof shot !== "object") return shot;
    const source = shot as Record<string, unknown>;
    const normalized = normalizeShotLanguage(source);
    const next: Record<string, unknown> = { ...source };

    for (const [field] of SHOT_LANGUAGE_FIELDS) {
      const value = normalized[field];
      if (value) next[field] = value;
      else delete next[field];
    }
    for (const field of CLEARABLE_SHOT_FIELDS) {
      if (next[field] === "") delete next[field];
    }
    return next;
  }) as T;
}

/** 把（已白名单化的）更新合并进镜头；可清除字段的空串删除键，undefined 跳过 */
export function applyShotUpdates(
  shot: Shot,
  updates: Record<string, unknown>
): Shot {
  const next: Shot = { ...shot };
  const target = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === "" && (CLEARABLE_SHOT_FIELDS as readonly string[]).includes(key)) {
      delete target[key];
      continue;
    }
    target[key] = value;
  }
  return next;
}

/** 紧凑描述一个镜头的镜头语言，用于 UI 徽标（如 "近景 · 推近"） */
export function describeShotLanguage(shot: {
  shotSize?: string;
  cameraAngle?: string;
  cameraMove?: string;
  lighting?: string;
  transition?: string;
}): string[] {
  return [
    labelOf(SHOT_SIZE_OPTIONS, shot.shotSize),
    labelOf(CAMERA_ANGLE_OPTIONS, shot.cameraAngle),
    labelOf(CAMERA_MOVE_OPTIONS, shot.cameraMove),
    labelOf(LIGHTING_OPTIONS, shot.lighting),
    labelOf(SHOT_TRANSITION_OPTIONS, shot.transition),
  ].filter((v): v is string => Boolean(v));
}
