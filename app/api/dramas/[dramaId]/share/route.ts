import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { PUBLIC_DRAMA_STATUSES } from "@/lib/public-dramas";
import { createLogger } from "@/lib/logger";

const log = createLogger("dramas-api");

/**
 * GET /api/dramas/[dramaId]/share
 * Public endpoint — returns share info for a drama.
 * No authentication required.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const { dramaId } = await params;

    const [drama] = await db
      .select()
      .from(dramas)
      .where(eq(dramas.id, dramaId))
      .limit(1);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    if (!PUBLIC_DRAMA_STATUSES.has(drama.status || "")) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    // Get first episode for cover image
    const [firstEpisode] = await db
      .select({ imageUrl: episodes.imageUrl, videoUrl: episodes.videoUrl })
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber)
      .limit(1);

    const coverUrl = drama.coverUrl || firstEpisode?.imageUrl || null;

    // Get total episode count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId));

    // Increment share count
    await db
      .update(dramas)
      .set({
        shareCount: sql`${dramas.shareCount} + 1`,
      })
      .where(eq(dramas.id, dramaId));

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
    const shareUrl = `${baseUrl}/view/${dramaId}`;

    return NextResponse.json({
      id: drama.id,
      title: drama.title,
      description: drama.description,
      genre: drama.genre,
      style: drama.style,
      coverUrl,
      episodeCount: count,
      totalDuration: drama.totalDuration,
      shareUrl,
    });
  } catch (error) {
    log.error("Failed to get share info", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "获取分享信息失败" }, { status: 500 });
  }
}
