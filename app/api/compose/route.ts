import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, type Episode } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { composeVideo, composeEpisodeFromShots, mergeVideos } from "@/lib/ai/video-composer";
import { searchAndDownloadVideos, extractSearchTermsFromShots } from "@/lib/ai/pexels-material";
import type { TransitionType } from "@/lib/ai/video-composer";
import { generateSubtitles, generateSubtitlesWithASR } from "@/lib/ai/subtitle-generator";
import { isAsrConfigured } from "@/lib/ai/asr-client";
import { uploadFileToCos, videoCosKey } from "@/lib/ai/cos-storage";
import { inferBgmPreset, BGM_VOLUME_MAP } from "@/lib/ai/bgm-library";
import type { Shot, ShotAudio } from "@/types/drama";
import path from "path";
import fs from "fs/promises";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction } from "@/lib/credits";
import { getOwnedDrama } from "@/lib/dramas";
import { updateDramaStatus } from "@/lib/drama-status";
import { createLogger } from "@/lib/logger";

const log = createLogger("compose-api");
import {
  createOrReuseGenerationTask,
  getActiveGenerationTask,
  completeGenerationTask,
  failGenerationTask,
  GenerationTaskCancelledError,
  throwIfGenerationTaskCancelled,
  touchGenerationTaskHeartbeat,
  updateGenerationTaskProgress,
} from "@/lib/generation";

/**
 * Convert an absolute local path to a relative uploads path for database storage.
 * COS URLs (http) are returned as-is.
 */
function toDbPath(filePath: string): string {
  if (filePath.startsWith("http")) return filePath;
  // Remove absolute prefix, return relative to uploads/
  const prefix = "/uploads/";
  const idx = filePath.indexOf(prefix);
  if (idx >= 0) {
    return filePath.slice(idx + 1); // e.g. "videos/xxx/episode-1.mp4"
  }
  return filePath;
}

export async function POST(request: NextRequest) {
  let taskId: string | null = null;
  let dramaId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    dramaId = body.dramaId;
    const { episodeId, useAsr, materialSource, transition, transitionDuration } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");

    if (episodeId) {
      // Compose single episode
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      // Check credits
      const creditCheck = await checkCredits(session.user.id, CREDIT_COSTS.compose);
      if (!creditCheck.ok) {
        return NextResponse.json(
          { error: `积分不足，需要 ${CREDIT_COSTS.compose} 积分，当前余额 ${creditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
          { status: 402 }
        );
      }

      const outputPath = path.join(
        uploadDir,
        "videos",
        `${dramaId}`,
        `episode-${episode.episodeNumber}.mp4`
      );

      // Check if V2 (shot-based)
      if (episode.shotData && Array.isArray(episode.shotData)) {
        const shots = episode.shotData as Shot[];
        const shotAudios = await reconstructShotAudios(
          shots,
          episode.voiceoverUrl,
          dramaId,
          episode.episodeNumber
        );

        // Build shot images map from disk
        const shotImages = new Map<number, string>();
        const shotVideos = new Map<number, string>(); // AI generated videos
        const shotImageDir = path.join(uploadDir, "images", dramaId, `episode-${episode.episodeNumber}`);
        for (const shot of shots) {
          // Check for AI video first
          if (shot.aiVideoUrl) {
            try {
              await fs.access(shot.aiVideoUrl);
              shotVideos.set(shot.shotNumber, shot.aiVideoUrl);
            } catch {
              // AI video file doesn't exist, skip
            }
          }

          // Still need the image for fallback
          const imgPath = path.join(shotImageDir, `shot-${shot.shotNumber}.jpg`);
          try {
            await fs.access(imgPath);
            shotImages.set(shot.shotNumber, imgPath);
          } catch {
            // Try png
            const imgPathPng = path.join(shotImageDir, `shot-${shot.shotNumber}.png`);
            try {
              await fs.access(imgPathPng);
              shotImages.set(shot.shotNumber, imgPathPng);
            } catch {
              // No shot image, will fall back to episode-level imageUrl
            }
          }
        }

        // Generate subtitle on the fly if not already done
        let subtitlePath = episode.subtitleUrl;
        if (!subtitlePath) {
          if (useAsr && isAsrConfigured()) {
            const asrResult = await generateSubtitlesWithASR(
              shots,
              shotAudios,
              dramaId,
              episode.episodeNumber
            );
            subtitlePath = asrResult.subtitlePath;
          } else {
            subtitlePath = await generateSubtitles(
              shots,
              shotAudios,
              dramaId,
              episode.episodeNumber
            );
          }
          await db
            .update(episodes)
            .set({ subtitleUrl: subtitlePath })
            .where(eq(episodes.id, episodeId));
        }

        // Resolve BGM path
        const bgmUrl = drama.bgmUrl;
        let bgmPath: string | null = null;
        if (bgmUrl) {
          const resolvedBgmPath = path.isAbsolute(bgmUrl) ? bgmUrl : path.join(uploadDir, bgmUrl);
          try {
            await fs.access(resolvedBgmPath);
            bgmPath = resolvedBgmPath;
          } catch { /* BGM file not found */ }
        }
        const bgmVolume = bgmUrl ? (BGM_VOLUME_MAP[inferBgmPreset(drama.genre)] ?? 0.15) : 0.15;

        await composeEpisodeFromShots(
          shots,
          shotAudios,
          dramaId,
          episode.episodeNumber,
          {
            imageUrl: episode.imageUrl,
            subtitlePath,
            shotImages,
            shotVideos,
            bgmPath,
            bgmVolume,
            transition: (transition as TransitionType) || 'fade',
            transitionDuration: transitionDuration || 0.5,
          }
        );

        const cosKey = videoCosKey(dramaId, episode.episodeNumber);
        const finalVideoUrl = toDbPath(await uploadFileToCos(outputPath, cosKey));

        await db
          .update(episodes)
          .set({ videoUrl: finalVideoUrl })
          .where(eq(episodes.id, episodeId));

        // Deduct credits
        await requireCreditDeduction(session.user.id, "compose", undefined, dramaId, `合成视频 - 第${episode.episodeNumber}集`);

        return NextResponse.json({ episodeId, videoUrl: finalVideoUrl });
      }

      // V1 fallback
      if (!episode.imageUrl || !episode.voiceoverUrl) {
        return NextResponse.json(
          { error: "请先生成分镜图片和配音" },
          { status: 400 }
        );
      }

      await composeVideo({
        imagePath: episode.imageUrl,
        audioPath: episode.voiceoverUrl,
        outputPath,
        subtitlePath: episode.subtitleUrl || undefined,
      });

      const cosKeyV1 = videoCosKey(dramaId, episode.episodeNumber);
      const finalVideoUrlV1 = toDbPath(await uploadFileToCos(outputPath, cosKeyV1));

      await db
        .update(episodes)
        .set({ videoUrl: finalVideoUrlV1 })
        .where(eq(episodes.id, episodeId));

      // Deduct credits
      await requireCreditDeduction(session.user.id, "compose", undefined, dramaId, `合成视频 - 第${episode.episodeNumber}集`);

      return NextResponse.json({ episodeId, videoUrl: finalVideoUrlV1 });
    }

    // Compose all episodes
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    // Check credits for all episodes
    const activeTask = await getActiveGenerationTask(dramaId, "compose");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有合成任务正在进行，已为你恢复到当前任务",
        episodeCount: allEpisodes.length,
      });
    }

    const totalComposeCredits = allEpisodes.length * CREDIT_COSTS.compose;
    const composeCreditCheck = await checkCredits(session.user.id, totalComposeCredits);
    if (!composeCreditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，合成 ${allEpisodes.length} 集视频需要 ${totalComposeCredits} 积分，当前余额 ${composeCreditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "compose",
      inputData: { episodeCount: allEpisodes.length, autoComposed: false },
    });
    taskId = taskResult.taskId;

    processComposeGeneration({
      taskId,
      dramaId,
      userId: session.user.id,
      useAsr: Boolean(useAsr),
      uploadDir,
      dramaBgmUrl: drama.bgmUrl,
      dramaGenre: drama.genre,
      allEpisodes,
      materialSource,
      transition,
      transitionDuration,
    }).catch(err => log.error("Background compose generation failed", { error: err instanceof Error ? err.message : String(err) }));

    return NextResponse.json({
      taskId,
      message: `正在合成 ${allEpisodes.length} 集视频，请稍候...`,
      episodeCount: allEpisodes.length,
    });
  } catch (error) {
    log.error("Video composition failed", { error: error instanceof Error ? error.message : String(error) });
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `视频合成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

type ComposeGenerationParams = {
  taskId: string;
  dramaId: string;
  userId: string;
  useAsr: boolean;
  uploadDir: string;
  dramaBgmUrl: string | null;
  dramaGenre: string | null;
  allEpisodes: Episode[];
  materialSource?: string;
  transition?: string;
  transitionDuration?: number;
};

async function processComposeGeneration({
  taskId,
  dramaId,
  userId,
  useAsr,
  uploadDir,
  dramaBgmUrl,
  dramaGenre,
  allEpisodes,
  materialSource,
  transition,
  transitionDuration,
}: ComposeGenerationParams) {
  try {
    const videoPaths: string[] = [];
    let creditsUsed = 0;

    let resolvedBgmPath: string | null = null;
    if (dramaBgmUrl) {
      const tryPath = path.isAbsolute(dramaBgmUrl) ? dramaBgmUrl : path.join(uploadDir, dramaBgmUrl);
      try {
        await fs.access(tryPath);
        resolvedBgmPath = tryPath;
      } catch {
        // ignore missing bgm
      }
    }
    const dramaBgmVolume = dramaBgmUrl ? (BGM_VOLUME_MAP[inferBgmPreset(dramaGenre)] ?? 0.15) : 0.15;

    for (const episode of allEpisodes) {
      await throwIfGenerationTaskCancelled(taskId);

      try {
        const outputPath = path.join(
          uploadDir,
          "videos",
          `${dramaId}`,
          `episode-${episode.episodeNumber}.mp4`
        );

        if (episode.shotData && Array.isArray(episode.shotData)) {
          const shots = episode.shotData as Shot[];
          const shotAudios = await reconstructShotAudios(
            shots,
            episode.voiceoverUrl,
            dramaId,
            episode.episodeNumber
          );

          const shotImages = new Map<number, string>();
          const shotVideos = new Map<number, string>();
          const shotImageDir = path.join(uploadDir, "images", dramaId, `episode-${episode.episodeNumber}`);

          for (const shot of shots) {
            if (shot.aiVideoUrl) {
              try {
                await fs.access(shot.aiVideoUrl);
                shotVideos.set(shot.shotNumber, shot.aiVideoUrl);
              } catch {
                // ignore missing ai video file
              }
            }

            const imgPath = path.join(shotImageDir, `shot-${shot.shotNumber}.jpg`);
            try {
              await fs.access(imgPath);
              shotImages.set(shot.shotNumber, imgPath);
            } catch {
              const imgPathPng = path.join(shotImageDir, `shot-${shot.shotNumber}.png`);
              try {
                await fs.access(imgPathPng);
                shotImages.set(shot.shotNumber, imgPathPng);
              } catch {
                // ignore missing shot image
              }
            }
          }

          let subtitlePath = episode.subtitleUrl;
          if (!subtitlePath) {
            if (useAsr && isAsrConfigured()) {
              await touchGenerationTaskHeartbeat(taskId, {
                currentEpisode: episode.episodeNumber,
                stage: "subtitles",
              });
              const asrResult = await generateSubtitlesWithASR(
                shots,
                shotAudios,
                dramaId,
                episode.episodeNumber
              );
              subtitlePath = asrResult.subtitlePath;
            } else {
              await touchGenerationTaskHeartbeat(taskId, {
                currentEpisode: episode.episodeNumber,
                stage: "subtitles",
              });
              subtitlePath = await generateSubtitles(
                shots,
                shotAudios,
                dramaId,
                episode.episodeNumber
              );
            }
            await throwIfGenerationTaskCancelled(taskId);
            await db
              .update(episodes)
              .set({ subtitleUrl: subtitlePath })
              .where(eq(episodes.id, episode.id));
          }

          await touchGenerationTaskHeartbeat(taskId, {
            currentEpisode: episode.episodeNumber,
            stage: "compose",
          });

          // Optionally fetch Pexels video materials if source is 'pexels'
          if (materialSource === 'pexels') {
            try {
              await touchGenerationTaskHeartbeat(taskId, {
                currentEpisode: episode.episodeNumber,
                stage: "pexels",
              });
              const terms = extractSearchTermsFromShots(shots);
              const totalDuration = shots.reduce((s, sh) => s + (sh.duration || 5), 0);
              const pexelsVideos = await searchAndDownloadVideos(
                terms,
                'landscape',
                totalDuration,
                uploadDir,
                10
              );
              for (let i = 0; i < shots.length && i < pexelsVideos.length; i++) {
                shotVideos.set(shots[i].shotNumber, pexelsVideos[i]);
              }
              log.info(`Loaded ${pexelsVideos.length} Pexels videos for episode ${episode.episodeNumber}`);
            } catch (err) {
              log.warn(`Pexels material fetch failed, using AI images as fallback`, {
                error: err instanceof Error ? err.message : err,
              });
            }
          }

          await composeEpisodeFromShots(
            shots,
            shotAudios,
            dramaId,
            episode.episodeNumber,
            {
              imageUrl: episode.imageUrl,
              subtitlePath,
              shotImages,
              shotVideos,
              bgmPath: resolvedBgmPath,
              bgmVolume: dramaBgmVolume,
              transition: (transition as TransitionType) || 'fade',
              transitionDuration: transitionDuration || 0.5,
            }
          );
        } else if (episode.imageUrl && episode.voiceoverUrl) {
          await touchGenerationTaskHeartbeat(taskId, {
            currentEpisode: episode.episodeNumber,
            stage: "compose",
          });
          await composeVideo({
            imagePath: episode.imageUrl,
            audioPath: episode.voiceoverUrl,
            outputPath,
            subtitlePath: episode.subtitleUrl || undefined,
          });
        } else {
          continue;
        }

        await throwIfGenerationTaskCancelled(taskId);
        await requireCreditDeduction(
          userId,
          "compose",
          undefined,
          dramaId,
          `合成视频 - 第${episode.episodeNumber}集`
        );
        creditsUsed += CREDIT_COSTS.compose;

        const cosKeyAll = videoCosKey(dramaId, episode.episodeNumber);
        const finalVideoUrlAll = toDbPath(await uploadFileToCos(outputPath, cosKeyAll));
        await throwIfGenerationTaskCancelled(taskId);

        await db
          .update(episodes)
          .set({ videoUrl: finalVideoUrlAll })
          .where(eq(episodes.id, episode.id));

        videoPaths.push(outputPath);
      } catch (err) {
        if (err instanceof GenerationTaskCancelledError) {
          throw err;
        }
        log.error(`Failed to compose episode ${episode.episodeNumber}`, { error: err instanceof Error ? err.message : String(err) });
      }

      await updateGenerationTaskProgress(taskId, {
        completedCount: videoPaths.length,
        episodeCount: allEpisodes.length,
        creditsUsed,
      });
    }

    if (videoPaths.length === 0) {
      throw new Error("未生成任何可用视频");
    }

    const mergedPath = path.join(uploadDir, "videos", `${dramaId}`, "complete.mp4");
    await touchGenerationTaskHeartbeat(taskId, {
      stage: "merge",
      completedCount: videoPaths.length,
      episodeCount: allEpisodes.length,
      creditsUsed,
    });
    const localMergedPath = await mergeVideos(videoPaths, mergedPath);
    const mergedCosKey = `${dramaId}/videos/complete.mp4`;
    const mergedUrl = toDbPath(await uploadFileToCos(localMergedPath, mergedCosKey));

    const totalDuration = allEpisodes.reduce(
      (sum, ep) => sum + (ep.duration || 0),
      0
    );

    await db
      .update(dramas)
      .set({
        totalDuration,
      })
      .where(eq(dramas.id, dramaId));
    await updateDramaStatus(dramaId, "completed");

    await completeGenerationTask(taskId, {
      completedCount: videoPaths.length,
      episodeCount: allEpisodes.length,
      videoCount: videoPaths.length,
      creditsUsed,
      mergedUrl,
    });
  } catch (error) {
    if (error instanceof GenerationTaskCancelledError) {
      return;
    }

    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}

/**
 * Reconstruct ShotAudio array from voiceover directory.
 */
async function reconstructShotAudios(
  shots: Shot[],
  voiceoverUrl: string | null,
  dramaId: string,
  episodeNumber: number
): Promise<ShotAudio[]> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const shotAudios: ShotAudio[] = [];

  let voiceoverDir: string;
  if (voiceoverUrl) {
    voiceoverDir = voiceoverUrl;
  } else {
    voiceoverDir = path.join(
      process.env.UPLOAD_DIR
        ? path.resolve(process.env.UPLOAD_DIR)
        : path.resolve("./uploads"),
      "voiceovers",
      dramaId,
      `episode-${episodeNumber}`
    );
  }

  for (const shot of shots) {
    const audioPath = path.join(voiceoverDir, `shot-${shot.shotNumber}.mp3`);
    let duration = shot.duration || 5;

    try {
      await fs.access(audioPath);
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        );
        duration = parseFloat(stdout.trim()) || duration;
      } catch {
        // use estimated
      }
    } catch {
      // file doesn't exist
    }

    shotAudios.push({
      shotNumber: shot.shotNumber,
      audioUrl: audioPath,
      duration: Math.round(duration * 10) / 10,
      type: shot.type === "dialogue" ? "dialogue" : "narration",
      character: shot.character,
    });
  }

  return shotAudios;
}
