import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("public-share-api");

/**
 * GET /api/share/[token]
 * Public endpoint — returns drama info by share token.
 * No authentication required.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: "无效的分享链接" }, { status: 400 });
    }

    const [drama] = await db
      .select()
      .from(dramas)
      .where(eq(dramas.shareToken, token))
      .limit(1);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在或链接已失效" }, { status: 404 });
    }

    if (!drama.status || !["completed", "storyboard_ready", "voiceover_ready"].includes(drama.status)) {
      return NextResponse.json({ error: "短剧尚未完成" }, { status: 404 });
    }

    // Get episodes with data
    const dramaEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, drama.id))
      .orderBy(episodes.episodeNumber);

    // Increment share count
    await db
      .update(dramas)
      .set({
        shareCount: sql`${dramas.shareCount} + 1`,
      })
      .where(eq(dramas.id, drama.id));

    return NextResponse.json({
      drama: {
        id: drama.id,
        title: drama.title,
        description: drama.description,
        genre: drama.genre,
        style: drama.style,
        aspectRatio: drama.aspectRatio,
        coverUrl: drama.coverUrl,
        totalDuration: drama.totalDuration,
        shareCount: (drama.shareCount || 0) + 1,
        createdAt: drama.createdAt,
      },
      episodes: dramaEpisodes,
    });
  } catch (error) {
    log.error("Failed to get shared drama", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "获取短剧信息失败" }, { status: 500 });
  }
}
