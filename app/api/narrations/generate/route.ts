import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { narrations } from "@/lib/db/narration-schema";
import { eq, and } from "drizzle-orm";
import { generateNarrationScript } from "@/lib/ai/narration-script-generator";
import { composeNarrationVideo } from "@/lib/ai/narration-composer";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { checkCredits, requireCreditDeduction, CREDIT_COSTS } from "@/lib/credits";
import { createLogger } from "@/lib/logger";
import type { TransitionType } from "@/lib/ai/video-composer";

const log = createLogger("narrations-generate");
const NARRATION_CREDIT_COST = 5;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { narrationId, stopAt } = body;

    if (!narrationId) {
      return NextResponse.json({ error: "缺少 narrationId" }, { status: 400 });
    }

    const [narration] = await db
      .select()
      .from(narrations)
      .where(and(eq(narrations.id, narrationId), eq(narrations.userId, session.user.id)))
      .limit(1);

    if (!narration) {
      return NextResponse.json({ error: "不存在或无权限" }, { status: 404 });
    }

    // Check credits (except for script-only)
    if (stopAt !== "script") {
      const creditCheck = await checkCredits(session.user.id, NARRATION_CREDIT_COST);
      if (!creditCheck.ok) {
        return NextResponse.json(
          { error: `积分不足，需要 ${NARRATION_CREDIT_COST} 积分`, code: "INSUFFICIENT_CREDITS" },
          { status: 402 }
        );
      }
    }

    // Update status
    await db
      .update(narrations)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(narrations.id, narrationId));

    // === Step 1: Generate script (if needed) ===
    let videoScript = narration.videoScript || "";
    let searchTerms = (narration.searchTerms as string[]) || [];

    if (!videoScript) {
      const result = await generateNarrationScript(narration.subject || narration.title, {
        language: narration.language || undefined,
        paragraphNumber: narration.paragraphNumber || 5,
      });

      videoScript = result.script;
      searchTerms = result.terms;

      await db
        .update(narrations)
        .set({ videoScript, searchTerms, updatedAt: new Date() })
        .where(eq(narrations.id, narrationId));

      if (stopAt === "script") {
        await db
          .update(narrations)
          .set({ status: "script_ready", updatedAt: new Date() })
          .where(eq(narrations.id, narrationId));

        return NextResponse.json({
          narrationId,
          script: videoScript,
          terms: searchTerms,
          message: "解说文案生成完成",
        });
      }
    } else if (stopAt === "script") {
      return NextResponse.json({
        narrationId,
        script: videoScript,
        terms: searchTerms,
        message: "文案已存在",
      });
    }

    // === Step 2: Compose video (background) ===
    // Use the variable we just fetched/set, NOT narration.videoScript (stale)
    composeNarrationVideo({
      narrationId,
      userId: session.user.id,
      script: videoScript,
      searchTerms,
      voiceName: narration.voiceName || "zh-CN-YunyangNeural",
      voiceRate: narration.voiceRate || 1,
      videoAspect: (narration.videoAspect as "portrait" | "landscape") || "landscape",
      videoCount: narration.videoCount || 1,
      videoConcatMode: (narration.videoConcatMode as "random" | "sequential") || "random",
      transition: (narration.videoTransition as TransitionType) || "fade",
      transitionDuration: narration.videoTransitionDuration || 0.5,
      genre: null,
      bgmUrl: narration.bgmUrl,
    })
      .then(async (result) => {
        let finalVideoUrl = result.videoUrl;
        try {
          const uploadDir = process.env.UPLOAD_DIR || "./uploads";
          const localVideoPath = `${uploadDir}/${result.videoUrl}`;
          const cosKey = `narrations/${narrationId}/final.mp4`;
          finalVideoUrl = await uploadFileToCos(localVideoPath, cosKey);
        } catch (err) {
          log.warn("Failed to upload to COS, using local path", {
            error: err instanceof Error ? err.message : err,
          });
        }

        // Deduct credits
        await requireCreditDeduction(
          session.user.id,
          "narration",
          NARRATION_CREDIT_COST,
          narrationId,
          `短视频解说 - ${narration.title}`
        ).catch(() => {});

        await db
          .update(narrations)
          .set({
            videoUrl: finalVideoUrl,
            audioUrl: result.audioUrl,
            audioDuration: result.audioDuration,
            duration: result.audioDuration,
            status: "completed",
            updatedAt: new Date(),
          })
          .where(eq(narrations.id, narrationId));

        log.info(`Narration video completed: ${narrationId}`);
      })
      .catch(async (err) => {
        log.error(`Narration video failed: ${narrationId}`, {
          error: err instanceof Error ? err.message : err,
        });
        await db
          .update(narrations)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(narrations.id, narrationId));
      });

    return NextResponse.json({
      narrationId,
      message: "视频生成已启动，请稍候...",
    });
  } catch (error) {
    log.error("Narration generation failed", { error: error instanceof Error ? error.message : error });
    return NextResponse.json(
      { error: `生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
