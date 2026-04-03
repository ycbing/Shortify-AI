import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

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
      [drama] = await db
        .select()
        .from(dramas)
        .where(and(eq(dramas.id, dramaId), eq(dramas.userId, session.user.id)))
        .limit(1);
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
      const publicStatuses = ["completed", "storyboard_ready", "voiceover_ready"];
      if (!publicStatuses.includes(drama.status || "")) {
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

    const [updated] = await db
      .update(dramas)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, session.user.id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

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

    const [deleted] = await db
      .delete(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, session.user.id)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    return NextResponse.json({ message: "删除成功" });
  } catch (error) {
    console.error("Failed to delete drama:", error);
    return NextResponse.json({ error: "删除短剧失败" }, { status: 500 });
  }
}
