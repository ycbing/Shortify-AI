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
