import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("stats-api");

/**
 * GET /api/stats — 落地页真实运营计数（仅聚合数字，公开）
 * 创作者数 = 拥有已完成作品的用户数（非注册用户数，避免虚高）
 */
export async function GET() {
  try {
    const [{ count: dramaCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dramas)
      .where(eq(dramas.status, "completed"));

    const [{ count: episodeCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .innerJoin(dramas, eq(episodes.dramaId, dramas.id))
      .where(eq(dramas.status, "completed"));

    const [{ count: creatorCount }] = await db
      .select({ count: sql<number>`count(distinct ${dramas.userId})::int` })
      .from(dramas)
      .where(eq(dramas.status, "completed"));

    return NextResponse.json({
      completedDramas: dramaCount,
      episodes: episodeCount,
      creators: creatorCount,
    });
  } catch (error) {
    log.error("Stats fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "获取统计失败" }, { status: 500 });
  }
}
