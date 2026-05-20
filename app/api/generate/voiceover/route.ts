import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, type Episode } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateVoiceover, generateShotVoiceovers } from "@/lib/ai/voiceover-generator";
import type { Shot, ShotAudio } from "@/types/drama";
import path from "path";
import fs from "fs/promises";
import { checkCredits, CREDIT_COSTS, requireCreditDeduction, refundCredits } from "@/lib/credits";
import { getOwnedDrama } from "@/lib/dramas";
import { updateDramaStatus } from "@/lib/drama-status";
import { composeEpisodeFromShots, composeVideo, mergeVideos } from "@/lib/ai/video-composer";
import { generateSubtitles } from "@/lib/ai/subtitle-generator";
import { uploadFileToCos, videoCosKey } from "@/lib/ai/cos-storage";
import { inferBgmPreset, BGM_VOLUME_MAP } from "@/lib/ai/bgm-library";
import {
  completeGenerationTask,
  createOrReuseGenerationTask,
  failGenerationTask,
  getActiveGenerationTask,
  GenerationTaskCancelledError,
  touchGenerationTaskHeartbeat,
  throwIfGenerationTaskCancelled,
  updateGenerationTaskProgress,
} from "@/lib/generation";
import { tryAcquireUserSlot, releaseUserSlot, getUserActiveCount } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";

const log = createLogger("voiceover-api");

/**
 * Convert an absolute local path to a relative uploads path for database storage.
 * COS URLs (http) are returned as-is.
 */
function toDbPath(filePath: string): string {
  if (filePath.startsWith("http")) return filePath;
  const prefix = "/uploads/";
  const idx = filePath.indexOf(prefix);
  if (idx >= 0) {
    return filePath.slice(idx + 1);
  }
  return filePath;
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
    const { episodeId, autoCompose = true } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");

    if (episodeId) {
      // Check credits for single episode
      const creditCheck = await checkCredits(session.user.id, CREDIT_COSTS.voiceover);
      if (!creditCheck.ok) {
        return NextResponse.json(
          { error: `积分不足，需要 ${CREDIT_COSTS.voiceover} 积分，当前余额 ${creditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
          { status: 402 }
        );
      }

      // Generate for single episode
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      // Check if V2 (shot-based)
      if (episode.shotData && Array.isArray(episode.shotData)) {
        // V2: generate per-shot voiceovers
        const shots = episode.shotData as Shot[];
        const shotAudios = await generateShotVoiceovers(
          shots,
          dramaId,
          episode.episodeNumber
        );

        // Store shot audio results in episode's scriptContent or outputData
        const totalDuration = shotAudios.reduce((sum, a) => sum + a.duration, 0);

        await db
          .update(episodes)
          .set({
            voiceoverUrl: path.join(
              uploadDir,
              "voiceovers",
              dramaId,
              `episode-${episode.episodeNumber}`
            ),
            duration: Math.round(totalDuration),
          })
          .where(eq(episodes.id, episodeId));

        await requireCreditDeduction(
          session.user.id,
          "voiceover",
          undefined,
          dramaId,
          `生成配音 - 第${episode.episodeNumber}集`
        );

        return NextResponse.json({
          episodeId,
          shotAudios,
          totalDuration: Math.round(totalDuration),
        });
      }

      // V1 fallback: single narration voiceover
      if (!episode.narrationText) {
        return NextResponse.json({ error: "剧集无旁白文本" }, { status: 404 });
      }

      const outputPath = path.join(
        uploadDir,
        "voiceovers",
        `${dramaId}`,
        `episode-${episode.episodeNumber}.mp3`
      );

      const result = await generateVoiceover(episode.narrationText, outputPath);

      await db
        .update(episodes)
        .set({
          voiceoverUrl: result.filePath,
          duration: result.durationSeconds,
        })
        .where(eq(episodes.id, episodeId));

      // Deduct credits
      await requireCreditDeduction(session.user.id, "voiceover", undefined, dramaId, `生成配音 - 第${episode.episodeNumber}集`);

      return NextResponse.json({
        episodeId,
        voiceoverUrl: result.filePath,
        duration: result.durationSeconds,
      });
    }

    // Generate for all episodes
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    // Check credits for all episodes
    const activeTask = await getActiveGenerationTask(dramaId, "voiceover");
    if (activeTask) {
      return NextResponse.json({
        taskId: activeTask.id,
        message: "已有配音任务正在进行，已为你恢复到当前任务",
        episodeCount: allEpisodes.length,
      });
    }

    // Concurrency control
    if (!tryAcquireUserSlot(session.user.id)) {
      return NextResponse.json({
        error: `当前有 ${getUserActiveCount(session.user.id)} 个任务正在进行，请等待完成后再试`,
        code: "TOO_MANY_TASKS",
      }, { status: 429 });
    }

    const totalVoiceoverCredits = allEpisodes.length * CREDIT_COSTS.voiceover;
    const voiceCreditCheck = await checkCredits(session.user.id, totalVoiceoverCredits);
    if (!voiceCreditCheck.ok) {
      return NextResponse.json(
        { error: `积分不足，生成 ${allEpisodes.length} 集配音需要 ${totalVoiceoverCredits} 积分，当前余额 ${voiceCreditCheck.balance} 积分`, code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "voiceover",
      inputData: { episodeCount: allEpisodes.length },
    });
    taskId = taskResult.taskId;

    processVoiceoverGeneration({
      taskId,
      dramaId,
      userId: session.user.id,
      uploadDir,
      allEpisodes,
      autoCompose,
    }).catch(err => log.error("Background voiceover processing failed", { error: err instanceof Error ? err.message : String(err) })).finally(() => releaseUserSlot(session.user.id));

    return NextResponse.json({
      taskId,
      message: `正在为 ${allEpisodes.length} 集生成配音，请稍候...`,
      episodeCount: allEpisodes.length,
    });
  } catch (error) {
    log.error("Voiceover generation failed", { error: error instanceof Error ? error.message : String(error) });
    if (taskId && dramaId) {
      await failGenerationTask(
        taskId,
        dramaId,
        error instanceof Error ? error.message : "未知错误"
      );
    }
    return NextResponse.json(
      { error: `配音生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

type VoiceoverGenerationParams = {
  taskId: string;
  dramaId: string;
  userId: string;
  uploadDir: string;
  allEpisodes: Episode[];
  autoCompose?: boolean;
};

async function processVoiceoverGeneration({
  taskId,
  dramaId,
  userId,
  uploadDir,
  allEpisodes,
  autoCompose = true,
}: VoiceoverGenerationParams) {
  const results: { episodeNumber: number; voiceoverUrl: string; duration: number; shotAudios?: unknown[] }[] = [];
  let creditsUsed = 0;

  try {
    for (const episode of allEpisodes) {
      await throwIfGenerationTaskCancelled(taskId);

      try {
        await touchGenerationTaskHeartbeat(taskId, {
          currentEpisode: episode.episodeNumber,
          stage: "generate",
          completedCount: results.length,
          episodeCount: allEpisodes.length,
          creditsUsed,
        });

        if (episode.shotData && Array.isArray(episode.shotData)) {
          const shots = episode.shotData as Shot[];
          const shotAudios = await generateShotVoiceovers(
            shots,
            dramaId,
            episode.episodeNumber
          );

          const totalDuration = shotAudios.reduce((sum, a) => sum + a.duration, 0);
          const voiceoverDir = path.join(
            uploadDir,
            "voiceovers",
            dramaId,
            `episode-${episode.episodeNumber}`
          );
          await throwIfGenerationTaskCancelled(taskId);

          await requireCreditDeduction(
            userId,
            "voiceover",
            undefined,
            dramaId,
            `生成配音 - 第${episode.episodeNumber}集`
          );
          creditsUsed += CREDIT_COSTS.voiceover;

          await db
            .update(episodes)
            .set({
              voiceoverUrl: voiceoverDir,
              duration: Math.round(totalDuration),
            })
            .where(eq(episodes.id, episode.id));

          results.push({
            episodeNumber: episode.episodeNumber,
            voiceoverUrl: voiceoverDir,
            duration: Math.round(totalDuration),
            shotAudios,
          });
        } else if (episode.narrationText) {
          const outputPath = path.join(
            uploadDir,
            "voiceovers",
            `${dramaId}`,
            `episode-${episode.episodeNumber}.mp3`
          );

          const result = await generateVoiceover(episode.narrationText, outputPath);
          await throwIfGenerationTaskCancelled(taskId);

          await requireCreditDeduction(
            userId,
            "voiceover",
            undefined,
            dramaId,
            `生成配音 - 第${episode.episodeNumber}集`
          );
          creditsUsed += CREDIT_COSTS.voiceover;

          await db
            .update(episodes)
            .set({
              voiceoverUrl: result.filePath,
              duration: result.durationSeconds,
            })
            .where(eq(episodes.id, episode.id));

          results.push({
            episodeNumber: episode.episodeNumber,
            voiceoverUrl: result.filePath,
            duration: result.durationSeconds,
          });
        }
      } catch (err) {
        if (err instanceof GenerationTaskCancelledError) {
          throw err;
        }
        log.error(`Failed to generate voiceover for episode ${episode.episodeNumber}`, { error: err instanceof Error ? err.message : String(err) });
        // Push failure entry so completedCount reflects total processed
        results.push({
          episodeNumber: episode.episodeNumber,
          voiceoverUrl: "",
          duration: 0,
        });
      }

      await updateGenerationTaskProgress(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
        creditsUsed,
      });
    }

    const hasGeneratedVoiceover = results.some((result) => result.voiceoverUrl);
    if (!hasGeneratedVoiceover) {
      throw new Error("未生成任何可用配音");
    }

    await updateDramaStatus(dramaId, "voiceover_ready");

    // Auto-compose preview videos after all voiceovers are generated
    if (autoCompose) {
      log.info("Voiceover complete, starting auto-compose for all episodes", { dramaId });

      // Get drama info (bgmUrl, genre)
      const [dramaData] = await db
        .select({ bgmUrl: dramas.bgmUrl, genre: dramas.genre })
        .from(dramas)
        .where(eq(dramas.id, dramaId))
        .limit(1);

      let bgmPath: string | null = null;
      let bgmVolume = 0.15;
      if (dramaData?.bgmUrl) {
        const resolvedBgmPath = path.isAbsolute(dramaData.bgmUrl)
          ? dramaData.bgmUrl
          : path.join(uploadDir, dramaData.bgmUrl);
        try {
          await fs.access(resolvedBgmPath);
          bgmPath = resolvedBgmPath;
          bgmVolume = BGM_VOLUME_MAP[inferBgmPreset(dramaData.genre)] ?? 0.15;
        } catch { /* BGM not found */ }
      }

      const videoPaths: string[] = [];
      let composedCount = 0;

      // Re-query episodes from DB to get fresh voiceoverUrls
      const freshEpisodes = await db
        .select()
        .from(episodes)
        .where(eq(episodes.dramaId, dramaId))
        .orderBy(episodes.episodeNumber);

      for (const episode of freshEpisodes) {
        await throwIfGenerationTaskCancelled(taskId);

        if (!episode.voiceoverUrl) {
          log.warn(`Episode ${episode.episodeNumber} has no voiceover, skipping auto-compose`);
          continue;
        }

        if (!episode.imageUrl && !(episode.shotData && Array.isArray(episode.shotData))) {
          log.warn(`Episode ${episode.episodeNumber} has no storyboard data, skipping auto-compose`);
          continue;
        }

        try {
          await touchGenerationTaskHeartbeat(taskId, {
            currentEpisode: episode.episodeNumber,
            stage: "auto-compose",
            completedCount: composedCount,
            episodeCount: allEpisodes.length,
            creditsUsed,
          });

          const outputPath = path.join(
            uploadDir, "videos", dramaId, `episode-${episode.episodeNumber}.mp4`
          );

          if (episode.shotData && Array.isArray(episode.shotData)) {
            const shots = episode.shotData as Shot[];
            const shotAudios = await reconstructShotAudios(
              shots, episode.voiceoverUrl, dramaId, episode.episodeNumber
            );

            // Build shot images map from disk
            const shotImages = new Map<number, string>();
            const shotVideos = new Map<number, string>();
            const shotImageDir = path.join(
              uploadDir, "images", dramaId, `episode-${episode.episodeNumber}`
            );

            for (const shot of shots) {
              if (shot.aiVideoUrl) {
                try {
                  await fs.access(shot.aiVideoUrl);
                  shotVideos.set(shot.shotNumber, shot.aiVideoUrl);
                } catch { /* AI video not found */ }
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
                } catch { /* no shot image */ }
              }
            }

            // Generate subtitles
            let subtitlePath = episode.subtitleUrl;
            if (!subtitlePath) {
              await touchGenerationTaskHeartbeat(taskId, {
                currentEpisode: episode.episodeNumber,
                stage: "subtitles",
              });
              subtitlePath = await generateSubtitles(
                shots, shotAudios, dramaId, episode.episodeNumber
              );
              await throwIfGenerationTaskCancelled(taskId);
              await db
                .update(episodes)
                .set({ subtitleUrl: subtitlePath })
                .where(eq(episodes.id, episode.id));
            }

            await throwIfGenerationTaskCancelled(taskId);
            await touchGenerationTaskHeartbeat(taskId, {
              currentEpisode: episode.episodeNumber,
              stage: "compose",
            });
            await composeEpisodeFromShots(
              shots, shotAudios, dramaId, episode.episodeNumber,
              {
                imageUrl: episode.imageUrl,
                subtitlePath,
                shotImages,
                shotVideos,
                bgmPath,
                bgmVolume,
              }
            );
          } else if (episode.imageUrl && episode.voiceoverUrl) {
            // V1 fallback
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

          // Upload to COS
          const cosKey = videoCosKey(dramaId, episode.episodeNumber);
          const finalVideoUrl = toDbPath(await uploadFileToCos(outputPath, cosKey));

          await db
            .update(episodes)
            .set({ videoUrl: finalVideoUrl })
            .where(eq(episodes.id, episode.id));

          videoPaths.push(outputPath);
          composedCount++;

          await updateGenerationTaskProgress(taskId, {
            completedCount: composedCount,
            episodeCount: allEpisodes.length,
            creditsUsed,
            stage: "auto-compose",
          });
        } catch (err) {
          if (err instanceof GenerationTaskCancelledError) {
            throw err;
          }
          log.error(`Auto-compose failed for episode ${episode.episodeNumber}`, { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Merge all episode videos into complete video
      let mergedUrl: string | null = null;
      if (videoPaths.length > 0) {
        await touchGenerationTaskHeartbeat(taskId, {
          stage: "merge",
          completedCount: videoPaths.length,
          episodeCount: allEpisodes.length,
          creditsUsed,
        });

        const mergedPath = path.join(uploadDir, "videos", dramaId, "complete.mp4");
        const localMergedPath = await mergeVideos(videoPaths, mergedPath);
        const mergedCosKey = `${dramaId}/videos/complete.mp4`;
        mergedUrl = toDbPath(await uploadFileToCos(localMergedPath, mergedCosKey));
      }

      // Update drama total duration, merged video URL, and status
      const totalDuration = allEpisodes.reduce(
        (sum, ep) => sum + (ep.duration || 0), 0
      );
      await db
        .update(dramas)
        .set({
          totalDuration,
          ...(mergedUrl ? { mergedVideoUrl: mergedUrl } : {}),
        })
        .where(eq(dramas.id, dramaId));
      await updateDramaStatus(dramaId, "completed");

      await completeGenerationTask(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
        creditsUsed,
        results,
        videoCount: videoPaths.length,
        mergedUrl: mergedUrl || undefined,
        autoComposed: true,
      });
    } else {
      await completeGenerationTask(taskId, {
        completedCount: results.length,
        episodeCount: allEpisodes.length,
        creditsUsed,
        results,
      });
    }
  } catch (error) {
    if (error instanceof GenerationTaskCancelledError) {
      return;
    }

    // Refund credits if nothing was generated
    if (creditsUsed > 0 && !results.some((r) => r.voiceoverUrl)) {
      log.warn(`No voiceover generated, refunding ${creditsUsed} credits`, { dramaId, taskId });
      await refundCredits(userId, creditsUsed, dramaId, "配音生成失败 - 积分退还").catch(err => log.error("Failed to refund credits", { error: err instanceof Error ? err.message : String(err) }));
    }

    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
