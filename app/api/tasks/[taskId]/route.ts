import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTaskForUser, getTaskWithProgressForUser } from "@/lib/services/tasks";
import { cancelGenerationTask } from "@/lib/generation";
import { createLogger } from "@/lib/logger";

const log = createLogger("tasks-api");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { taskId } = await params;

    const task = await getTaskWithProgressForUser(taskId, session.user.id);

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch (error) {
    log.error("Failed to fetch task", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "获取任务详情失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { taskId } = await params;
    const task = await getTaskForUser(taskId, session.user.id);

    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (task.status !== "processing") {
      return NextResponse.json({ error: "只有进行中的任务可以取消" }, { status: 409 });
    }

    await cancelGenerationTask(taskId, task.dramaId, "用户主动取消任务");

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to cancel task", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "取消任务失败" }, { status: 500 });
  }
}
