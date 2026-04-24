import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listTasksForUser } from "@/lib/services/tasks";

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

    const tasks = await listTasksForUser(session.user.id, {
      dramaId: dramaId || undefined,
      type: type || undefined,
      status: status || undefined,
      latest,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return NextResponse.json({ error: "获取任务失败" }, { status: 500 });
  }
}
