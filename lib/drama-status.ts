import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import type { DramaWithEpisodes } from "@/types/drama";

type DramaEpisodeLite = Pick<
  DramaWithEpisodes["episodes"][number],
  "imageUrl" | "voiceoverUrl" | "videoUrl"
>;

export const DRAMA_STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "草稿", variant: "outline" },
  generating: { label: "生成中", variant: "default" },
  script_ready: { label: "剧本就绪", variant: "secondary" },
  storyboard_ready: { label: "分镜就绪", variant: "secondary" },
  voiceover_ready: { label: "配音就绪", variant: "secondary" },
  completed: { label: "已完成", variant: "default" },
  error: { label: "生成失败", variant: "destructive" },
};

export const DRAMA_PROGRESS_STEPS = [
  { key: "script", label: "剧本" },
  { key: "storyboard", label: "分镜" },
  { key: "voiceover", label: "配音" },
  { key: "video", label: "视频" },
] as const;

export function inferDramaStatusFromEpisodes(
  episodesList: DramaEpisodeLite[] | undefined,
  fallbackStatus = "draft"
) {
  if (!episodesList || episodesList.length === 0) {
    return fallbackStatus;
  }

  if (episodesList.some((episode) => episode.videoUrl)) {
    return "completed";
  }

  if (episodesList.some((episode) => episode.voiceoverUrl)) {
    return "voiceover_ready";
  }

  if (episodesList.some((episode) => episode.imageUrl)) {
    return "storyboard_ready";
  }

  return "script_ready";
}

export function getCompletedDramaSteps(
  status: string,
  episodesList: DramaWithEpisodes["episodes"]
) {
  const completed = new Set<string>();
  if (!episodesList || episodesList.length === 0 || status === "draft") {
    return completed;
  }

  completed.add("script");

  if (episodesList.some((episode) => episode.imageUrl)) {
    completed.add("storyboard");
  }

  if (episodesList.some((episode) => episode.voiceoverUrl)) {
    completed.add("voiceover");
  }

  if (episodesList.some((episode) => episode.videoUrl)) {
    completed.add("video");
  }

  return completed;
}

export async function inferDramaStatus(dramaId: string) {
  const [summary] = await db
    .select({
      episodeCount: sql<number>`count(*)::int`,
      imageCount: sql<number>`count(*) filter (where ${episodes.imageUrl} is not null)::int`,
      voiceoverCount: sql<number>`count(*) filter (where ${episodes.voiceoverUrl} is not null)::int`,
      videoCount: sql<number>`count(*) filter (where ${episodes.videoUrl} is not null)::int`,
    })
    .from(episodes)
    .where(eq(episodes.dramaId, dramaId));

  if (!summary || summary.episodeCount === 0) {
    return "draft";
  }

  return inferDramaStatusFromEpisodes(
    [
      {
        imageUrl: summary.imageCount > 0 ? "present" : null,
        voiceoverUrl: summary.voiceoverCount > 0 ? "present" : null,
        videoUrl: summary.videoCount > 0 ? "present" : null,
      },
    ],
    "draft"
  );
}

export async function updateDramaStatus(dramaId: string, status: string) {
  await db
    .update(dramas)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(dramas.id, dramaId));
}

export function getDramaEditorPath(
  dramaId: string,
  episodesList: DramaEpisodeLite[] | undefined,
  fallbackStatus = "draft"
) {
  const inferredStatus = inferDramaStatusFromEpisodes(episodesList, fallbackStatus);

  if (inferredStatus === "draft") {
    return `/create/script?dramaId=${dramaId}`;
  }

  if (inferredStatus === "script_ready") {
    return `/create/storyboard?dramaId=${dramaId}`;
  }

  if (inferredStatus === "storyboard_ready") {
    return `/create/preview?dramaId=${dramaId}`;
  }

  if (inferredStatus === "voiceover_ready" || inferredStatus === "completed") {
    return `/create/preview?dramaId=${dramaId}`;
  }

  return `/create/script?dramaId=${dramaId}`;
}
