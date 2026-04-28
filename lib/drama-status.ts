// Server-only drama status utilities (imports DB)
// Re-exports client-safe functions from drama-status-client.ts

// Re-export client-safe utilities for API routes
export {
  DRAMA_STATUS_META,
  DRAMA_PROGRESS_STEPS,
  inferDramaStatusFromEpisodes,
  getCompletedDramaSteps,
  getDramaEditorPath,
} from "@/lib/drama-status-client";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { inferDramaStatusFromEpisodes } from "@/lib/drama-status-client";
import type { DramaWithEpisodes } from "@/types/drama";

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
