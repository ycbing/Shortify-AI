import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getOwnedDrama } from "@/lib/dramas";
import { shotRegenerateSchema } from "@/lib/validation";
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos, imageCosKey, aiVideoCosKey } from "@/lib/ai/cos-storage";
import { generateVoiceover } from "@/lib/ai/voiceover-generator";
import { generateVideo, downloadVideo, imageToBase64 } from "@/lib/ai/video-generator";
import {
  buildShotImagePrompt,
  buildShotVideoPrompt,
  buildShotCharacterRefs,
} from "@/lib/ai/shot-prompts";
import { findShotImage, mixAudioToShotVideo, tryLipSyncShotVideo } from "@/lib/ai/shot-assets";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction } from "@/lib/credits";
import { consumeFreeVideoShots, getFreeVideoShotsRemaining } from "@/lib/free-quota";
import {
  completeGenerationTask,
  createOrReuseGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  touchGenerationTaskHeartbeat,
} from "@/lib/generation";
import { NARRATION_VOICE, applyShotUpdates } from "@/types/drama";
import type { Character, Shot } from "@/types/drama";
import { createLogger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";

const log = createLogger("shot-regenerate-api");

const EDITABLE_FIELDS = new Set([
  "visual", "line", "subtitle", "emotion", "sfx", "character", "voiceId", "duration",
  // 镜头语言
  "shotSize", "cameraAngle", "cameraMove", "lighting", "transition",
]);

/**
 * POST /api/generate/shot-regenerate
 * 分镜编辑器：应用文案修改并按需重跑单镜头的 生图 / 配音 / AI 视频
 * - image / voiceover 同步返回（秒级~二十秒）
 * - video 走后台任务，返回 taskId 供轮询
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const parsed = shotRegenerateSchema.safeParse(await request.json());
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0];
      return NextResponse.json(
        { error: firstIssue?.message || "请求参数无效" },
        { status: 400 }
      );
    }
    const { dramaId, episodeId, shotNumber, targets, shot: edited } = parsed.data;

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const [episode] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
      .limit(1);
    if (!episode) {
      return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
    }

    const shots: Shot[] = Array.isArray(episode.shotData) ? episode.shotData : [];
    const idx = shots.findIndex((s) => s.shotNumber === shotNumber);
    if (idx === -1) {
      return NextResponse.json({ error: `镜头 ${shotNumber} 不存在` }, { status: 404 });
    }

    // 应用可选的文案修改（与 PATCH 路由同一白名单与清除语义）
    let shot: Shot = shots[idx];
    if (edited) {
      const updates = Object.fromEntries(
        Object.entries(edited).filter(([k, v]) => EDITABLE_FIELDS.has(k) && v !== undefined)
      );
      shot = applyShotUpdates(shot, updates);
    }

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    const aspectRatio = (drama.aspectRatio as "landscape" | "vertical") || "landscape";
    const characters: Character[] = Array.isArray(drama.characters) ? drama.characters : [];
    const style = drama.style || "realistic";

    // AI 视频是后台任务，先做互斥检查
    if (targets.includes("video")) {
      const activeTask = await getActiveGenerationTask(dramaId, "video");
      if (activeTask) {
        return NextResponse.json(
          { error: "已有 AI 视频任务正在进行，请等待完成后再试", code: "TASK_IN_PROGRESS" },
          { status: 409 }
        );
      }
      const freeRemaining = await getFreeVideoShotsRemaining(session.user.id);
      const creditCheck = await checkCredits(session.user.id, freeRemaining > 0 ? 0 : CREDIT_COSTS.video);
      if (!creditCheck.ok) {
        return NextResponse.json(
          {
            error: `积分不足，AI 视频生成需要 ${CREDIT_COSTS.video} 积分（免费额度已用完），当前余额 ${creditCheck.balance} 积分`,
            code: "INSUFFICIENT_CREDITS",
          },
          { status: 402 }
        );
      }
    }

    let imageUrl: string | undefined;
    let voiceoverPath: string | undefined;

    // ---- 生图（同步）----
    if (targets.includes("image")) {
      const refMap = new Map<string, string>();
      for (const c of characters) {
        if (c.referenceImageUrl) refMap.set(c.name, c.referenceImageUrl);
      }
      // 角色外貌（一致性）+ 画面描述 + 镜头语言（景别/机位/光线）
      const enrichedPrompt = buildShotImagePrompt(shot, characters);
      const characterReferences = buildShotCharacterRefs(shot, characters, refMap);

      const generatedUrl = await generateImage(
        enrichedPrompt,
        style,
        aspectRatio === "vertical" ? "960x1728" : "1728x960",
        { characterReferences: characterReferences.length > 0 ? characterReferences : undefined }
      );

      // 落盘 + 上传 COS（与批量分镜流程同一存储布局）
      const savePath = path.join(
        uploadDir, "images", dramaId, `episode-${episode.episodeNumber}`, `shot-${shot.shotNumber}.jpg`
      );
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      const imgResp = await fetch(generatedUrl);
      if (!imgResp.ok) throw new Error(`下载生成图片失败: ${imgResp.status}`);
      await fs.writeFile(savePath, Buffer.from(await imgResp.arrayBuffer()));

      imageUrl = await uploadFileToCos(savePath, imageCosKey(dramaId, episode.episodeNumber, shot.shotNumber));
      shot = { ...shot, imageUrl };

      await requireCreditDeduction(
        session.user.id, "shotImage", undefined, dramaId,
        `单镜头重新生图 - 第${episode.episodeNumber}集镜头${shot.shotNumber}`
      );
    }

    // ---- 配音（同步）----
    if (targets.includes("voiceover")) {
      const text = shot.type === "dialogue" && shot.line ? shot.line : shot.subtitle || "";
      if (text.trim()) {
        const outputPath = path.join(
          uploadDir, "voiceovers", dramaId, `episode-${episode.episodeNumber}`, `shot-${shot.shotNumber}.mp3`
        );
        const result = await generateVoiceover(
          text, outputPath, shot.voiceId || NARRATION_VOICE, "+0%", "+0Hz",
          { emotion: shot.emotion, sfx: shot.sfx }
        );
        voiceoverPath = result.filePath;
      } else {
        log.warn("Voiceover regen skipped: no text", {
          dramaId, episodeNumber: episode.episodeNumber, shotNumber: shot.shotNumber,
        });
      }
    }

    // ---- 持久化同步部分的结果 ----
    if (targets.includes("image") || targets.includes("voiceover") || edited) {
      const newShots = shots.map((s, i) => (i === idx ? shot : s));
      await db
        .update(episodes)
        .set({ shotData: newShots as never })
        .where(eq(episodes.id, episodeId));
    }

    // ---- AI 视频（后台任务）----
    let taskId: string | undefined;
    if (targets.includes("video")) {
      const taskResult = await createOrReuseGenerationTask({
        dramaId,
        type: "video",
        // 单镜头重跑不改变短剧状态（保持 completed 等原状态，避免作品从列表消失）
        processingDramaStatus: drama.status || "generating",
        inputData: { episodeNumber: episode.episodeNumber, shotNumber: shot.shotNumber, singleShot: true },
      });
      taskId = taskResult.taskId;

      processShotVideoRegeneration({
        taskId,
        dramaId,
        userId: session.user.id,
        episodeId,
        shotNumber: shot.shotNumber,
        episodeNumber: episode.episodeNumber,
        shot,
        uploadDir,
        aspectRatio,
        style,
      }).catch((err) =>
        log.error("Background shot video regeneration failed", {
          error: err instanceof Error ? err.message : String(err),
          shotNumber: shot.shotNumber,
        })
      );
    }

    log.info("Shot regeneration dispatched", {
      dramaId,
      episodeNumber: episode.episodeNumber,
      shotNumber: shot.shotNumber,
      targets,
      taskId: taskId || "-",
    });

    return NextResponse.json({
      shot,
      imageUrl,
      voiceoverPath,
      ...(taskId ? { taskId } : {}),
    });
  } catch (error) {
    log.error("Shot regeneration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: `镜头重跑失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

type ShotVideoRegenParams = {
  taskId: string;
  dramaId: string;
  userId: string;
  episodeId: string;
  shotNumber: number;
  episodeNumber: number;
  shot: Shot;
  uploadDir: string;
  aspectRatio: "landscape" | "vertical";
  style: string;
};

/** 后台：单镜头 AI 视频生成 → 混音 → 上传 COS → 写回 shotData */
async function processShotVideoRegeneration({
  taskId,
  dramaId,
  userId,
  episodeId,
  shotNumber,
  episodeNumber,
  shot,
  uploadDir,
  aspectRatio,
  style,
}: ShotVideoRegenParams) {
  try {
    await touchGenerationTaskHeartbeat(taskId, {
      currentEpisode: episodeNumber,
      currentShot: shotNumber,
      stage: "submit",
    });

    // 生成分镜图（本地文件），作为 i2v 首帧
    const imgPath = await findShotImage(dramaId, episodeNumber, shotNumber);
    if (!imgPath) {
      throw new Error("镜头无分镜图，请先生成或重跑图片");
    }
    const base64DataUrl = await imageToBase64(imgPath);
    // 画面描述 + 镜头语言优先，台词仅作表情参考（避免台词文本驱动画面运动）
    const prompt = buildShotVideoPrompt(shot);

    const result = await generateVideo(prompt, base64DataUrl, style, { userId });
    await touchGenerationTaskHeartbeat(taskId, {
      currentEpisode: episodeNumber,
      currentShot: shotNumber,
      stage: "download",
    });

    const localVideoDir = path.join(uploadDir, "videos", dramaId, `episode-${episodeNumber}-ai`);
    const localVideoPath = path.join(localVideoDir, `shot-${shotNumber}.mp4`);
    await downloadVideo(result.videoUrl, localVideoPath);

    // 对口型（可选）：对白镜头 + 有配音 + KLING_LIPSYNC 开启
    const voiceoverPath = path.join(uploadDir, "voiceovers", dramaId, `episode-${episodeNumber}`, `shot-${shotNumber}.mp3`);
    let hasVoiceover = false;
    try {
      await fs.access(voiceoverPath);
      hasVoiceover = true;
    } catch { /* no voiceover */ }
    if (hasVoiceover && shot.type === "dialogue") {
      await tryLipSyncShotVideo({
        videoPath: localVideoPath,
        voiceoverPath,
        dramaId,
        episodeNumber,
        shotNumber,
      });
    }

    // 已有配音则直接混入（与批量流程一致）
    try {
      await fs.access(voiceoverPath);
      const mixedPath = path.join(localVideoDir, `shot-${shotNumber}-mixed.mp4`);
      await mixAudioToShotVideo(localVideoPath, voiceoverPath, mixedPath, aspectRatio);
      await fs.unlink(localVideoPath).catch(() => {});
      await fs.rename(mixedPath, localVideoPath);
    } catch {
      log.info("No voiceover for shot, using video without audio", { episodeNumber, shotNumber });
    }

    const cosUrl = await uploadFileToCos(localVideoPath, aiVideoCosKey(dramaId, episodeNumber, shotNumber));

    // 写回 shotData
    const [episode] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);
    if (episode && Array.isArray(episode.shotData)) {
      const shots: Shot[] = episode.shotData;
      const newShots = shots.map((s) =>
        s.shotNumber === shotNumber ? { ...s, aiVideoUrl: cosUrl } : s
      );
      await db
        .update(episodes)
        .set({ shotData: newShots as never })
        .where(eq(episodes.id, episodeId));
    }

    const freeUsed = await consumeFreeVideoShots(userId, 1);
    const chargedCredits = freeUsed.used === 0 ? CREDIT_COSTS.video : 0;
    if (freeUsed.used === 0) {
      await requireCreditDeduction(
        userId, "video", undefined, dramaId,
        `单镜头 AI 视频 - 第${episodeNumber}集镜头${shotNumber}`
      );
    }

    await completeGenerationTask(taskId, {
      completedCount: 1,
      episodeCount: 1,
      creditsUsed: chargedCredits,
      freeShotsUsed: freeUsed.used,
      shotNumber,
      videoUrl: cosUrl,
    });

    log.info("Shot video regenerated", { dramaId, episodeNumber, shotNumber });
  } catch (error) {
    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
    throw error;
  }
}
