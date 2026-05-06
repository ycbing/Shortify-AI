import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedDrama } from "@/lib/dramas";
import { PUBLIC_DRAMA_STATUSES } from "@/lib/public-dramas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const { dramaId } = await params;
    const session = await auth();

    // Allow public access for completed dramas (no auth required)
    // For non-completed dramas, require auth and ownership
    let drama;
    if (session?.user?.id) {
      drama = await getOwnedDrama(dramaId, session.user.id);
    }

    if (!drama) {
      // Try public access (completed dramas only)
      [drama] = await db
        .select()
        .from(dramas)
        .where(eq(dramas.id, dramaId))
        .limit(1);

      if (!drama) {
        return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
      }

      // Only allow public access to completed or storyboard_ready+ dramas
      if (!PUBLIC_DRAMA_STATUSES.has(drama.status || "")) {
        return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
      }
    }

    const dramaEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    return NextResponse.json({ drama, episodes: dramaEpisodes });
  } catch (error) {
    console.error("Failed to fetch drama:", error);
    return NextResponse.json({ error: "获取短剧详情失败" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { dramaId } = await params;
    const body = await request.json();

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    // If episodes data is provided, update episodes table
    if (body.episodes && Array.isArray(body.episodes)) {
      const { episodes: episodesData, ...dramaFields } = body;

      // Update drama fields if any (e.g. characters)
      if (Object.keys(dramaFields).length > 0) {
        await db
          .update(dramas)
          .set({
            ...dramaFields,
            updatedAt: new Date(),
          })
          .where(eq(dramas.id, dramaId));
      }

      // Update each episode's shotData and scriptContent
      for (const ep of episodesData) {
        if (!ep.id) continue;

        const updates: Record<string, unknown> = {};
        if (ep.shotData !== undefined) {
          updates.shotData = ep.shotData;
        }
        if (ep.scriptContent !== undefined) {
          updates.scriptContent = ep.scriptContent;
        }
        if (ep.title !== undefined) {
          updates.title = ep.title;
        }
        if (ep.duration !== undefined) {
          updates.duration = ep.duration;
        }

        if (Object.keys(updates).length > 0) {
          await db
            .update(episodes)
          .set(updates)
            .where(eq(episodes.id, ep.id));
        }
      }

      // Return updated drama with episodes
      const updatedDrama = await db
        .select()
        .from(dramas)
        .where(eq(dramas.id, dramaId))
        .limit(1);

      const updatedEpisodes = await db
        .select()
        .from(episodes)
        .where(eq(episodes.dramaId, dramaId))
        .orderBy(episodes.episodeNumber);

      return NextResponse.json({ drama: updatedDrama[0], episodes: updatedEpisodes });
    }

    const [updated] = await db
      .update(dramas)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(dramas.id, dramaId))
      .returning();

    return NextResponse.json({ drama: updated });
  } catch (error) {
    console.error("Failed to update drama:", error);
    return NextResponse.json({ error: "更新短剧失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { dramaId } = await params;

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    await db
      .delete(dramas)
      .where(eq(dramas.id, dramaId));

    return NextResponse.json({ message: "删除成功" });
  } catch (error) {
    console.error("Failed to delete drama:", error);
    return NextResponse.json({ error: "删除短剧失败" }, { status: 500 });
  }
}
