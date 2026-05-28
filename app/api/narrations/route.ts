import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { narrations } from "@/lib/db/narration-schema";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("narrations-api");

// GET /api/narrations — List user's narrations
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const list = await db
      .select()
      .from(narrations)
      .where(eq(narrations.userId, session.user.id))
      .orderBy(desc(narrations.createdAt));

    return NextResponse.json({ narrations: list });
  } catch (error) {
    log.error("Failed to list narrations", { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ error: "加载失败" }, { status: 500 });
  }
}

// POST /api/narrations — Create narration
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { subject, paragraphNumber, voiceName, videoAspect, videoCount, videoTransition, videoTransitionDuration } = body;

    if (!subject?.trim()) {
      return NextResponse.json({ error: "请输入视频主题" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const [created] = await db
      .insert(narrations)
      .values({
        id,
        userId: session.user.id,
        title: subject.slice(0, 100),
        subject: subject.trim(),
        paragraphNumber: paragraphNumber || 5,
        voiceName: voiceName || "zh-CN-YunyangNeural",
        videoAspect: videoAspect || "landscape",
        videoCount: videoCount || 1,
        videoTransition: videoTransition || "fade",
        videoTransitionDuration: videoTransitionDuration || 0.5,
      })
      .returning();

    return NextResponse.json({ narration: created });
  } catch (error) {
    log.error("Failed to create narration", { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}

// DELETE /api/narrations — Delete narration
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    }

    const [deleted] = await db
      .delete(narrations)
      .where(and(eq(narrations.id, id), eq(narrations.userId, session.user.id)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "不存在或无权限" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to delete narration", { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
