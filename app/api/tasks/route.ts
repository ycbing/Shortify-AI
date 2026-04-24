import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, generationTasks } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dramaId = searchParams.get("dramaId");
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const latest = searchParams.get("latest") === "1";

    const conditions = [eq(dramas.userId, session.user.id)];
    if (dramaId) conditions.push(eq(generationTasks.dramaId, dramaId));
    if (type) conditions.push(eq(generationTasks.type, type));
    if (status) conditions.push(eq(generationTasks.status, status));

    const rows = await db
      .select({
        id: generationTasks.id,
        dramaId: generationTasks.dramaId,
        episodeId: generationTasks.episodeId,
        type: generationTasks.type,
        status: generationTasks.status,
        inputData: generationTasks.inputData,
        outputData: generationTasks.outputData,
        errorMessage: generationTasks.errorMessage,
        startedAt: generationTasks.startedAt,
        completedAt: generationTasks.completedAt,
      })
      .from(generationTasks)
      .innerJoin(dramas, eq(dramas.id, generationTasks.dramaId))
      .where(and(...conditions))
      .orderBy(desc(generationTasks.startedAt));

    const tasks = latest ? rows.slice(0, 1) : rows;

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return NextResponse.json({ error: "获取任务失败" }, { status: 500 });
  }
}
