// 资源成本估算 — 供应商单价表（人民币，估算口径）
// ⚠️ 用途说明：
// 1. 这里的单价是"估算配置"，用于成本可见性，不是计费依据；真实账单以供应商控制台为准
// 2. 可用环境变量覆盖：PRICING_CNY_<TYPE大写>（如 PRICING_CNY_VIDEO=2.0）
// 3. 估算方法：usageLogs 记录的是积分，按 CREDIT_COSTS 单位积分反推调用次数，再乘单价
import { CREDIT_COSTS } from "@/lib/credits";
import { createLogger } from "@/lib/logger";

const log = createLogger("pricing");

export interface UnitPrice {
  /** 计量单位（展示用） */
  unit: string;
  /** 每单位人民币估算价 */
  priceCNY: number;
  /** 单价来源说明 */
  note: string;
}

/** 默认单价表（人民币估算）。compose 为本地 FFmpeg 合成，无 API 成本 */
const DEFAULT_PRICING_CNY: Record<string, UnitPrice> = {
  script: { unit: "次", priceCNY: 0.05, note: "LLM 全量剧本生成" },
  storyboard: { unit: "集", priceCNY: 2.0, note: "每集约 10 张 2K 分镜图" },
  voiceover: { unit: "集", priceCNY: 0.5, note: "CosyVoice 按字符计费" },
  compose: { unit: "集", priceCNY: 0, note: "本地 FFmpeg 合成" },
  video: { unit: "镜头", priceCNY: 1.5, note: "wan i2v 每条 5 秒 720P" },
  narration: { unit: "次", priceCNY: 0.2, note: "解说生成" },
  characterReference: { unit: "张", priceCNY: 0.3, note: "角色定妆照" },
  voiceClone: { unit: "次", priceCNY: 0, note: "声音注册（调用费极小）" },
  shotImage: { unit: "张", priceCNY: 0.3, note: "单镜头重跑生图" },
};

function priceFor(type: string): number {
  const envKey = `PRICING_CNY_${type.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue !== undefined) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    log.warn(`Invalid pricing env ${envKey}=${envValue}, using default`);
  }
  return DEFAULT_PRICING_CNY[type]?.priceCNY ?? 0;
}

export function getUnitPrice(type: string): UnitPrice {
  return (
    DEFAULT_PRICING_CNY[type] ?? { unit: "次", priceCNY: 0, note: "未配置单价" }
  );
}

export interface CostSummary {
  /** 估算总成本（人民币） */
  totalCNY: number;
  /** 估算窗口内的总积分 */
  totalCredits: number;
  /** 每积分对应成本（人民币） */
  cnyPerCredit: number;
  byType: Record<
    string,
    { credits: number; quantity: number; cny: number; unit: string }
  >;
}

/**
 * 按用量日志估算供应商成本。
 * 数量 = creditsUsed / 单位积分（与 requireCreditDeduction 的默认计费口径一致），
 * 成本 = 数量 × 单价。无法识别的类型按 0 计。
 */
export function summarizeLogCost(
  logs: { type: string; creditsUsed: number }[]
): CostSummary {
  const byType: CostSummary["byType"] = {};
  let totalCNY = 0;
  let totalCredits = 0;

  for (const item of logs) {
    const unitCredits = CREDIT_COSTS[item.type as keyof typeof CREDIT_COSTS];
    const credits = item.creditsUsed || 0;
    totalCredits += credits;

    let quantity = 0;
    let cny = 0;
    if (unitCredits && unitCredits > 0) {
      quantity = credits / unitCredits;
      cny = quantity * priceFor(item.type);
    }
    totalCNY += cny;

    const entry = (byType[item.type] ??= {
      credits: 0,
      quantity: 0,
      cny: 0,
      unit: getUnitPrice(item.type).unit,
    });
    entry.credits += credits;
    entry.quantity += quantity;
    entry.cny += cny;
  }

  return {
    totalCNY: Math.round(totalCNY * 100) / 100,
    totalCredits,
    cnyPerCredit:
      totalCredits > 0
        ? Math.round((totalCNY / totalCredits) * 10000) / 10000
        : 0,
    byType,
  };
}
