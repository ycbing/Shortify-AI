// 免费 AI 视频镜头额度 — 新用户激活体验用
// 扣减为原子条件递减（WHERE free_video_shots > 0 RETURNING），并发安全
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("free-quota");

/** 每用户免费镜头数（注册时由列默认值写入，存量用户由迁移默认值获得） */
export const DEFAULT_FREE_VIDEO_SHOTS = Number(process.env.FREE_VIDEO_SHOTS ?? "10");

/** 查询剩余免费镜头数 */
export async function getFreeVideoShotsRemaining(userId: string): Promise<number> {
  const [row] = await db
    .select({ remaining: users.freeVideoShots })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.remaining ?? 0;
}

/**
 * 消耗免费额度（最多 wanted 个），返回实际消耗数。
 * 每个额度为一次独立的原子条件递减（仅当剩余 > 0 时生效），
 * 并发生成时也不会超发。used = 0 表示额度已用尽，调用方应扣积分。
 */
export async function consumeFreeVideoShots(
  userId: string,
  wanted: number
): Promise<{ used: number; remaining: number }> {
  let used = 0;
  let remaining = await getFreeVideoShotsRemaining(userId);

  while (used < wanted) {
    const [row] = await db
      .update(users)
      .set({ freeVideoShots: sql`${users.freeVideoShots} - 1` })
      .where(and(eq(users.id, userId), gt(users.freeVideoShots, 0)))
      .returning({ remaining: users.freeVideoShots });

    if (!row) break; // 额度已用尽
    used++;
    remaining = row.remaining ?? 0;
  }

  if (used > 0) {
    log.info("Free video shots consumed", { userId, wanted, used, remaining });
  }
  return { used, remaining };
}
