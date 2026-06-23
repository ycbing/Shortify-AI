import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@/lib/logger";

const log = createLogger("drama-share-api");

/**
 * POST /api/dramas/[dramaId]/share
 * Generate or retrieve a share token for a drama.
 * Returns the public share URL.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { dramaId } = await params;

    const [drama] = await db
      .select()
      .from(dramas)
      .where(eq(dramas.id, dramaId))
      .limit(1);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    // Check ownership
    if (drama.userId !== session.user.id) {
      return NextResponse.json({ error: "无权操作" }, { status: 403 });
    }

    // Generate share token if not exists
    let shareToken = drama.shareToken;
    if (!shareToken) {
      shareToken = uuidv4();
      await db
        .update(dramas)
        .set({ shareToken })
        .where(eq(dramas.id, dramaId));
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
    const shareUrl = `${baseUrl}/share/${shareToken}`;

    return NextResponse.json({
      shareUrl,
      shareToken,
    });
  } catch (error) {
    log.error("Failed to generate share token", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "生成分享链接失败" }, { status: 500 });
  }
}

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

    if (!drama.status || !["completed", "storyboard_ready", "voiceover_ready"].includes(drama.status)) {
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
    const shareUrl = drama.shareToken
      ? `${baseUrl}/share/${drama.shareToken}`
      : `${baseUrl}/view/${dramaId}`;

    return NextResponse.json({
      id: drama.id,
      title: drama.title,
      description: drama.description,
      genre: drama.genre,
      style: drama.style,
      aspectRatio: drama.aspectRatio,
      coverUrl,
      episodeCount: count,
      totalDuration: drama.totalDuration,
      shareUrl,
      shareCount: (drama.shareCount || 0) + 1,
    });
  } catch (error) {
    log.error("Failed to get share info", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "获取分享信息失败" }, { status: 500 });
  }
}
