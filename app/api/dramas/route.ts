import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createDramaSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const conditions = [eq(dramas.userId, session.user.id)];
    if (status && status !== "all") {
      conditions.push(eq(dramas.status, status));
    }

    const userDramas = await db
      .select()
      .from(dramas)
      .where(and(...conditions))
      .orderBy(desc(dramas.createdAt));

    if (userDramas.length === 0) {
      return NextResponse.json({ dramas: [] });
    }

    const dramaIds = userDramas.map((drama) => drama.id);
    const allEpisodes = await db
      .select({
        id: episodes.id,
        dramaId: episodes.dramaId,
        episodeNumber: episodes.episodeNumber,
        title: episodes.title,
        imageUrl: episodes.imageUrl,
        voiceoverUrl: episodes.voiceoverUrl,
        videoUrl: episodes.videoUrl,
        duration: episodes.duration,
      })
      .from(episodes)
      .where(inArray(episodes.dramaId, dramaIds))
      .orderBy(episodes.dramaId, episodes.episodeNumber);

    const episodesByDramaId = new Map<string, typeof allEpisodes>();
    for (const episode of allEpisodes) {
      const dramaEpisodes = episodesByDramaId.get(episode.dramaId) ?? [];
      dramaEpisodes.push(episode);
      episodesByDramaId.set(episode.dramaId, dramaEpisodes);
    }

    const dramasWithEpisodes = userDramas.map((drama) => ({
      ...drama,
      episodes: (episodesByDramaId.get(drama.id) ?? []).map(({ dramaId: _dramaId, ...episode }) => episode),
    }));

    return NextResponse.json({ dramas: dramasWithEpisodes });
  } catch (error) {
    console.error("Failed to fetch dramas:", error);
    return NextResponse.json({ error: "获取短剧列表失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const title = body.title || "未命名短剧";
    const description = body.description || null;

    // Validate creation fields
    const parsed = createDramaSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0];
      return NextResponse.json(
        { error: firstIssue?.message || "请求参数无效" },
        { status: 400 }
      );
    }

    const { theme, genre, style, episodeCount } = parsed.data;
    const id = uuidv4();

    const [drama] = await db
      .insert(dramas)
      .values({
        id,
        userId: session.user.id,
        title,
        description,
        theme,
        genre,
        style,
        episodeCount,
        status: "draft",
      })
      .returning();

    return NextResponse.json({ drama }, { status: 201 });
  } catch (error) {
    console.error("Failed to create drama:", error);
    return NextResponse.json({ error: "创建短剧失败" }, { status: 500 });
  }
}
