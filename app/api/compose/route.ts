import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { composeVideo, composeEpisodeFromShots, mergeVideos } from "@/lib/ai/video-composer";
import { generateSubtitles } from "@/lib/ai/subtitle-generator";
import { uploadFileToCos, videoCosKey } from "@/lib/ai/cos-storage";
import type { Shot, ShotAudio } from "@/types/drama";
import path from "path";
import fs from "fs/promises";

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
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId, episodeId } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    const relativeUploadDir = process.env.UPLOAD_DIR || "./uploads";

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
          subtitlePath = await generateSubtitles(
            shots,
            shotAudios,
            dramaId,
            episode.episodeNumber
          );
          await db
            .update(episodes)
            .set({ subtitleUrl: subtitlePath })
            .where(eq(episodes.id, episodeId));
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
          }
        );

        const cosKey = videoCosKey(dramaId, episode.episodeNumber);
        const finalVideoUrl = toDbPath(await uploadFileToCos(outputPath, cosKey));

        await db
          .update(episodes)
          .set({ videoUrl: finalVideoUrl })
          .where(eq(episodes.id, episodeId));

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

      return NextResponse.json({ episodeId, videoUrl: finalVideoUrlV1 });
    }

    // Compose all episodes
    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    const taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "compose",
      status: "processing",
      inputData: { episodeCount: allEpisodes.length },
      startedAt: new Date(),
    });

    const videoPaths: string[] = [];

    for (const episode of allEpisodes) {
      try {
        const outputPath = path.join(
          uploadDir,
          "videos",
          `${dramaId}`,
          `episode-${episode.episodeNumber}.mp4`
        );

        if (episode.shotData && Array.isArray(episode.shotData)) {
          // V2 shot-based composition
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
            // Check for AI video
            if (shot.aiVideoUrl) {
              try {
                await fs.access(shot.aiVideoUrl);
                shotVideos.set(shot.shotNumber, shot.aiVideoUrl);
              } catch {
                // AI video file doesn't exist
              }
            }

            // Still need image for fallback
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

          // Generate subtitle if not done
          let subtitlePath = episode.subtitleUrl;
          if (!subtitlePath) {
            subtitlePath = await generateSubtitles(
              shots,
              shotAudios,
              dramaId,
              episode.episodeNumber
            );
            await db
              .update(episodes)
              .set({ subtitleUrl: subtitlePath })
              .where(eq(episodes.id, episode.id));
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
            }
          );
        } else if (episode.imageUrl && episode.voiceoverUrl) {
          // V1 fallback
          await composeVideo({
            imagePath: episode.imageUrl,
            audioPath: episode.voiceoverUrl,
            outputPath,
            subtitlePath: episode.subtitleUrl || undefined,
          });
        } else {
          continue;
        }

        const cosKeyAll = videoCosKey(dramaId, episode.episodeNumber);
        const finalVideoUrlAll = toDbPath(await uploadFileToCos(outputPath, cosKeyAll));

        await db
          .update(episodes)
          .set({ videoUrl: finalVideoUrlAll })
          .where(eq(episodes.id, episode.id));

        videoPaths.push(outputPath);
      } catch (err) {
        console.error(`Failed to compose episode ${episode.episodeNumber}:`, err);
      }
    }

    // Merge all videos
    let mergedUrl: string | null = null;
    if (videoPaths.length > 0) {
      const mergedPath = path.join(uploadDir, "videos", `${dramaId}`, "complete.mp4");
      const localMergedPath = await mergeVideos(videoPaths, mergedPath);
      const mergedCosKey = `${dramaId}/videos/complete.mp4`;
      mergedUrl = toDbPath(await uploadFileToCos(localMergedPath, mergedCosKey));
    }

    // Calculate total duration
    const totalDuration = allEpisodes.reduce(
      (sum, ep) => sum + (ep.duration || 0),
      0
    );

    await db
      .update(dramas)
      .set({
        status: "completed",
        totalDuration,
        updatedAt: new Date(),
      })
      .where(eq(dramas.id, dramaId));

    await db
      .update(generationTasks)
      .set({
        status: "completed",
        outputData: { videoCount: videoPaths.length, mergedUrl },
        completedAt: new Date(),
      })
      .where(eq(generationTasks.id, taskId));

    return NextResponse.json({
      taskId,
      videoCount: videoPaths.length,
      mergedUrl,
    });
  } catch (error) {
    console.error("Video composition failed:", error);
    return NextResponse.json(
      { error: `视频合成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
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
