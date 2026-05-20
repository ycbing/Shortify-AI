import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateSubtitles, generateSubtitlesWithASR } from "@/lib/ai/subtitle-generator";
import { isAsrConfigured } from "@/lib/ai/asr-client";
import type { Shot, ShotAudio } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("subtitle-api");

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId, episodeId, useAsr } = body; // useAsr: boolean, ASR精排模式

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    // Get episodes for this drama
    const episodeQuery = episodeId
      ? db
          .select()
          .from(episodes)
          .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
      : db
          .select()
          .from(episodes)
          .where(eq(episodes.dramaId, dramaId))
          .orderBy(episodes.episodeNumber);

    const targetEpisodes = await episodeQuery;

    if (targetEpisodes.length === 0) {
      return NextResponse.json({ error: "没有找到剧集" }, { status: 404 });
    }

    // Validate ASR mode
    if (useAsr && !isAsrConfigured()) {
      return NextResponse.json(
        { error: "ASR 模式需要配置 GLM_API_KEY" },
        { status: 400 }
      );
    }

    const taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "subtitle",
      status: "processing",
      inputData: { episodeCount: targetEpisodes.length, useAsr: !!useAsr },
      startedAt: new Date(),
    });

    const results: {
      episodeNumber: number;
      subtitleUrl: string;
      qualityReport?: {
        totalShots: number;
        matched: number;
        mismatched: number;
        details: {
          shotNumber: number;
          originalText: string;
          asrText: string;
          match: boolean;
          diff: string;
        }[];
      };
    }[] = [];

    for (const episode of targetEpisodes) {
      if (!episode.shotData || !Array.isArray(episode.shotData)) {
        log.debug(`Episode ${episode.episodeNumber} has no shotData, skipping`);
        continue;
      }

      const shots = episode.shotData as Shot[];

      // Reconstruct ShotAudio from voiceover directory
      const shotAudios = await reconstructShotAudios(
        shots,
        episode.voiceoverUrl,
        dramaId,
        episode.episodeNumber
      );

      if (useAsr) {
        // ASR 精排模式：生成字幕 + 配音质量检测
        const asrResult = await generateSubtitlesWithASR(
          shots,
          shotAudios,
          dramaId,
          episode.episodeNumber
        );

        await db
          .update(episodes)
          .set({ subtitleUrl: asrResult.subtitlePath })
          .where(eq(episodes.id, episode.id));

        results.push({
          episodeNumber: episode.episodeNumber,
          subtitleUrl: asrResult.subtitlePath,
          qualityReport: asrResult.qualityReport,
        });
      } else {
        // 传统模式：基于文本+时长生成字幕
        const subtitleUrl = await generateSubtitles(
          shots,
          shotAudios,
          dramaId,
          episode.episodeNumber
        );

        await db
          .update(episodes)
          .set({ subtitleUrl })
          .where(eq(episodes.id, episode.id));

        results.push({
          episodeNumber: episode.episodeNumber,
          subtitleUrl,
        });
      }
    }

    await db
      .update(generationTasks)
      .set({ status: "completed", outputData: { results }, completedAt: new Date() })
      .where(eq(generationTasks.id, taskId));

    return NextResponse.json({
      taskId,
      results,
      mode: useAsr ? "asr" : "standard",
      asrAvailable: isAsrConfigured(),
    });
  } catch (error) {
    log.error("Subtitle generation failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: `字幕生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

/**
 * Reconstruct ShotAudio array by reading audio files from the voiceover directory.
 */
async function reconstructShotAudios(
  shots: Shot[],
  voiceoverUrl: string | null,
  dramaId: string,
  episodeNumber: number
): Promise<ShotAudio[]> {
  const fs = await import("fs/promises");
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  const path = await import("path");

  const shotAudios: ShotAudio[] = [];

  // Determine the voiceover directory
  let voiceoverDir: string;
  if (voiceoverUrl) {
    voiceoverDir = voiceoverUrl;
  } else {
    voiceoverDir = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      "voiceovers",
      dramaId,
      `episode-${episodeNumber}`
    );
  }

  for (const shot of shots) {
    const audioPath = path.join(voiceoverDir, `shot-${shot.shotNumber}.mp3`);
    let duration = shot.duration || 5;
    let exists = false;

    try {
      await fs.access(audioPath);
      exists = true;
      // Get actual duration
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        );
        duration = parseFloat(stdout.trim()) || duration;
      } catch {
        // use estimated duration
      }
    } catch {
      // file doesn't exist, use estimated duration
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
