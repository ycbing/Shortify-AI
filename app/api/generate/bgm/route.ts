import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOwnedDrama } from "@/lib/dramas";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateBgm, inferEpisodeBgmStyle } from "@/lib/ai/bgm-generator";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { checkCredits, requireCreditDeduction } from "@/lib/credits";
import { createLogger } from "@/lib/logger";
import type { Shot } from "@/types/drama";
import path from "path";
import fs from "fs/promises";

const log = createLogger("bgm-api");

/** AI 生成 BGM 积分消耗 */
const BGM_CREDIT_COST = 3;

/**
 * POST /api/generate/bgm
 * 
 * 请求体：
 * - dramaId: 短剧 ID（必填）
 * - episodeId: 指定剧集 ID（可选，不传则为整部剧生成一条 BGM）
 * - provider: "suno" | "auto"（可选，默认 auto）
 * 
 * 根据剧情情绪自动生成背景音乐
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId, episodeId, provider } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少参数 dramaId" }, { status: 400 });
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    // 检查积分
    const creditCheck = await checkCredits(session.user.id, BGM_CREDIT_COST);
    if (!creditCheck.ok) {
      return NextResponse.json(
        {
          error: `积分不足，AI 配乐需要 ${BGM_CREDIT_COST} 积分，当前余额 ${creditCheck.balance} 积分`,
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 402 }
      );
    }

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    let bgmPath: string;

    if (episodeId) {
      // 单集生成
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      const shots = Array.isArray(episode.shotData) ? (episode.shotData as Shot[]) : [];
      const { prompt, style } = inferEpisodeBgmStyle(shots, drama.genre);

      // 计算剧集总时长
      const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 5), 0) || 60;

      bgmPath = path.join(uploadDir, "bgm", dramaId, `episode-${episode.episodeNumber}.mp3`);

      log.info("生成单集 AI BGM", {
        dramaId,
        episodeNumber: episode.episodeNumber,
        style,
        duration: totalDuration,
      });

      await generateBgm(bgmPath, {
        prompt,
        style,
        duration: totalDuration,
        genre: drama.genre || undefined,
        userId: session.user.id,
      });
    } else {
      // 整部剧生成一条通用 BGM
      const allEpisodes = await db
        .select()
        .from(episodes)
        .where(eq(episodes.dramaId, dramaId))
        .orderBy(episodes.episodeNumber);

      // 收集所有镜头的 bgm 标签
      const allShots = allEpisodes.flatMap((ep) =>
        Array.isArray(ep.shotData) ? (ep.shotData as Shot[]) : []
      );
      const { prompt, style } = inferEpisodeBgmStyle(allShots, drama.genre);

      // 整部剧总时长
      const totalDuration = allShots.reduce((sum, s) => sum + (s.duration || 5), 0) || 120;

      bgmPath = path.join(uploadDir, "bgm", dramaId, "full-drama.mp3");

      log.info("生成整剧 AI BGM", {
        dramaId,
        style,
        duration: totalDuration,
      });

      await generateBgm(bgmPath, {
        prompt,
        style,
        duration: totalDuration,
        genre: drama.genre || undefined,
        userId: session.user.id,
      });
    }

    // 上传到 COS
    const cosKey = `bgm/${dramaId}/ai-generated.mp3`;
    const cosUrl = await uploadFileToCos(bgmPath, cosKey);

    // 更新 drama 的 bgmUrl
    const bgmUrl = path.relative(uploadDir, bgmPath);
    await db
      .update(dramas)
      .set({ bgmUrl })
      .where(eq(dramas.id, dramaId));

    // 扣积分
    await requireCreditDeduction(
      session.user.id,
      "compose", // 复用 compose 类型
      BGM_CREDIT_COST,
      dramaId,
      `AI 自动配乐 - ${drama.title || dramaId}`
    );

    log.info("AI BGM 生成完成", { dramaId, bgmUrl });

    return NextResponse.json({
      bgmUrl,
      cosUrl,
      message: "AI 背景音乐生成完成，合成视频时将自动混入",
    });
  } catch (error) {
    log.error("AI BGM 生成失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: `生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 }
    );
  }
}
