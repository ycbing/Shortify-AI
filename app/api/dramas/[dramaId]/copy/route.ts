import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

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

    // Fetch original drama with episodes
    const [originalDrama] = await db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, session.user.id)))
      .limit(1);

    if (!originalDrama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const originalEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    const newDramaId = randomUUID();

    // Create the copied drama
    const [newDrama] = await db
      .insert(dramas)
      .values({
        id: newDramaId,
        userId: session.user.id,
        title: originalDrama.title + "（副本）",
        description: originalDrama.description,
        theme: originalDrama.theme,
        genre: originalDrama.genre,
        style: originalDrama.style,
        episodeCount: originalDrama.episodeCount,
        status: "draft",
        characters: originalDrama.characters,
      })
      .returning();

    // Copy episodes (reset media URLs since they belong to the original)
    const newEpisodes = await Promise.all(
      originalEpisodes.map((ep) =>
        db
          .insert(episodes)
          .values({
            id: randomUUID(),
            dramaId: newDramaId,
            episodeNumber: ep.episodeNumber,
            title: ep.title,
            scriptContent: ep.scriptContent,
            narrationText: ep.narrationText,
            duration: ep.duration,
            shotData: ep.shotData,
            // Don't copy media files — they need to be regenerated
            imageUrl: null,
            voiceoverUrl: null,
            videoUrl: null,
            subtitleUrl: null,
          })
          .returning()
      )
    );

    return NextResponse.json({
      drama: {
        ...newDrama,
        episodes: newEpisodes.map((ep) => ep[0]),
      },
    });
  } catch (error) {
    console.error("Failed to copy drama:", error);
    return NextResponse.json({ error: "复制短剧失败" }, { status: 500 });
  }
}
