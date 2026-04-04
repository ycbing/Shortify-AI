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
  bgm?: string;
  aiVideoUrl?: string; // CogVideoX generated video local path
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
  createdAt: Date;
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
  "男声-年轻": "zh-CN-YunxiNeural",
  "男声-中年": "zh-CN-YunjianNeural",
  "女声-年轻": "zh-CN-XiaoxiaoNeural",
  "女声-中年": "zh-CN-XiaomengNeural",
  "旁白": "zh-CN-YunyangNeural",
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
