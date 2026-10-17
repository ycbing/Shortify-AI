// 免费 AI 视频镜头额度 — 新用户激活体验用
// 扣减用 GREATEST 原子更新防透支；额度扣完返回 0，调用方回退到积分扣费
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
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
 * used = wanted 表示全部免费；used = 0 表示额度已用尽，调用方应扣积分。
 */
export async function consumeFreeVideoShots(
  userId: string,
  wanted: number
): Promise<{ used: number; remaining: number }> {
  if (wanted <= 0) return { used: 0, remaining: await getFreeVideoShotsRemaining(userId) };

  const [prev] = await db
    .select({ remaining: users.freeVideoShots })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const prevRemaining = prev?.remaining ?? 0;
  if (prevRemaining <= 0) return { used: 0, remaining: 0 };

  // GREATEST 兜底防透支（同用户并发时差值仍准确）
  const [row] = await db
    .update(users)
    .set({ freeVideoShots: sql`GREATEST(${users.freeVideoShots} - ${wanted}, 0)` })
    .where(eq(users.id, userId))
    .returning({ remaining: users.freeVideoShots });

  const newRemaining = row?.remaining ?? prevRemaining;
  const used = Math.max(0, prevRemaining - newRemaining);
  log.info("Free video shots consumed", { userId, wanted, used, remaining: newRemaining });
  return { used, remaining: newRemaining };
}
