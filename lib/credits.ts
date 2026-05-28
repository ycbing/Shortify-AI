// ============================================
// Shortify AI - Credits System
// ============================================

import { db } from "@/lib/db";
import { users, usageLogs } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@/lib/logger";

const log = createLogger("credits");

// Credit costs per operation
export const CREDIT_COSTS = {
  script: 10,        // 生成剧本
  storyboard: 5,     // 生成分镜图片（每集）
  voiceover: 5,      // 生成配音（每集）
  compose: 5,        // 合成视频（每集）
  video: 20,         // AI 视频生成（每个镜头）
  narration: 5,      // 短视频解说生成
} as const;

export type CreditType = keyof typeof CREDIT_COSTS;

// Chinese labels for credit types
export const CREDIT_LABELS: Record<CreditType, string> = {
  script: "生成剧本",
  storyboard: "生成分镜图片",
  voiceover: "生成配音",
  compose: "合成视频",
  video: "AI 视频生成",
  narration: "短视频解说",
};

/**
 * Check if user has enough credits. Returns true if sufficient.
 */
export async function checkCredits(
  userId: string,
  required: number
): Promise<{ ok: boolean; balance: number; required: number }> {
  const [user] = await db
    .select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const balance = user?.credits ?? 0;
  return { ok: balance >= required, balance, required };
}

/**
 * Deduct credits from user and log usage.
 * Returns true if successful, false if insufficient.
 */
export async function deductCredits(
  userId: string,
  type: CreditType,
  amount?: number,
  dramaId?: string,
  description?: string
): Promise<{ ok: boolean; balance: number; error?: string }> {
  const cost = amount ?? CREDIT_COSTS[type];
  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ credits: sql`${users.credits} - ${cost}` })
        .where(and(eq(users.id, userId), gte(users.credits, cost)))
        .returning({ credits: users.credits });

      if (!updated) {
        const [user] = await tx
          .select({ credits: users.credits })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const balance = user?.credits ?? 0;
        return {
          ok: false,
          balance,
          error: `积分不足，需要 ${cost} 积分，当前余额 ${balance} 积分`,
        };
      }

      await tx.insert(usageLogs).values({
        id: uuidv4(),
        userId,
        type,
        creditsUsed: cost,
        dramaId: dramaId || null,
        description: description || CREDIT_LABELS[type],
      });

      return { ok: true, balance: updated.credits ?? 0 };
    });
  } catch (error) {
    log.error("Failed to deduct credits", { error: error instanceof Error ? error.message : String(error) });
    return {
      ok: false,
      balance: await getCreditBalance(userId),
      error: "积分扣减失败，请稍后重试",
    };
  }
}

/**
 * Refund credits to user (e.g., when generation completely fails after partial deduction).
 */
export async function refundCredits(
  userId: string,
  amount: number,
 dramaId?: string,
  description?: string
): Promise<void> {
  if (amount <= 0) return;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning({ credits: users.credits });

    if (updated) {
      await tx.insert(usageLogs).values({
        id: uuidv4(),
        userId,
        type: "script" as CreditType, // placeholder, actual type stored in description
        creditsUsed: -amount, // negative = refund
        dramaId: dramaId || null,
        description: description || `积分退还 (${amount})`,
      });
    }
  });
}

export async function requireCreditDeduction(
  userId: string,
  type: CreditType,
  amount?: number,
  dramaId?: string,
  description?: string
) {
  const result = await deductCredits(userId, type, amount, dramaId, description);
  if (!result.ok) {
    throw new Error(result.error || "积分扣减失败");
  }
  return result;
}

/**
 * Get user's current credit balance.
 */
export async function getCreditBalance(userId: string): Promise<number> {
  const [user] = await db
    .select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.credits ?? 0;
}

/**
 * Get recent usage logs for a user.
 */
export async function getUsageLogs(
  userId: string,
  limit: number = 20
) {
  const logs = await db
    .select({
      id: usageLogs.id,
      type: usageLogs.type,
      creditsUsed: usageLogs.creditsUsed,
      dramaId: usageLogs.dramaId,
      description: usageLogs.description,
      createdAt: usageLogs.createdAt,
    })
    .from(usageLogs)
    .where(eq(usageLogs.userId, userId))
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit);

  return logs;
}
