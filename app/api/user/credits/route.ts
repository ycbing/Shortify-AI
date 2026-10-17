import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalance, getUsageLogs } from "@/lib/credits";
import { summarizeLogCost } from "@/lib/pricing";
import { getFreeVideoShotsRemaining } from "@/lib/free-quota";
import { createLogger } from "@/lib/logger";

const log = createLogger("credits-api");

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const [balance, logs, recentLogs, freeVideoShots] = await Promise.all([
      getCreditBalance(session.user.id),
      getUsageLogs(session.user.id, 20),
      // 成本估算基于更大的窗口（展示仍用最近 20 条）
      getUsageLogs(session.user.id, 200),
      getFreeVideoShotsRemaining(session.user.id),
    ]);

    const costEstimate = summarizeLogCost(recentLogs);

    return NextResponse.json({ balance, logs, costEstimate, freeVideoShots });
  } catch (error) {
    log.error("Failed to fetch credits", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "获取积分信息失败" }, { status: 500 });
  }
}
