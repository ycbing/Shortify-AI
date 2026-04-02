import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

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

    // 为每个 drama 附带 episodes
    const dramasWithEpisodes = await Promise.all(
      userDramas.map(async (drama) => {
        const dramaEpisodes = await db
          .select({
            id: episodes.id,
            episodeNumber: episodes.episodeNumber,
            title: episodes.title,
            imageUrl: episodes.imageUrl,
            voiceoverUrl: episodes.voiceoverUrl,
            videoUrl: episodes.videoUrl,
            duration: episodes.duration,
          })
          .from(episodes)
          .where(eq(episodes.dramaId, drama.id))
          .orderBy(episodes.episodeNumber);

        return {
          ...drama,
          episodes: dramaEpisodes,
        };
      })
    );

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
    const { title, description, theme, genre, style, episodeCount } = body;

    const id = uuidv4();

    const [drama] = await db
      .insert(dramas)
      .values({
        id,
        userId: session.user.id,
        title: title || "未命名短剧",
        description,
        theme,
        genre,
        style,
        episodeCount: episodeCount || 3,
        status: "draft",
      })
      .returning();

    return NextResponse.json({ drama }, { status: 201 });
  } catch (error) {
    console.error("Failed to create drama:", error);
    return NextResponse.json({ error: "创建短剧失败" }, { status: 500 });
  }
}
