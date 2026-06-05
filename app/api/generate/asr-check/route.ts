import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateSubtitlesWithASR } from "@/lib/ai/subtitle-generator";
import { isAsrConfigured } from "@/lib/ai/asr-client";
import { isAnyAsrConfigured } from "@/lib/ai/groq-asr";
import type { Shot, ShotAudio } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("asr-api");

/**
 * POST /api/generate/asr-check
 * 
 * 对指定剧集的配音进行 ASR 质量检测，返回字幕 + 质量报告。
 * 不会覆盖已有视频，只更新字幕文件和质量报告。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    if (!isAnyAsrConfigured()) {
      return NextResponse.json(
        { error: "ASR 未配置，请设置 GROQ_API_KEY（推荐）或 GLM_API_KEY 环境变量" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { dramaId, episodeId } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    // Get episodes
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

    const results = [];

    for (const episode of targetEpisodes) {
      if (!episode.shotData || !Array.isArray(episode.shotData)) {
        results.push({
          episodeNumber: episode.episodeNumber,
          skipped: true,
          reason: "无 shotData",
        });
        continue;
      }

      const shots = episode.shotData as Shot[];
      const shotAudios = await reconstructShotAudios(
        shots,
        episode.voiceoverUrl,
        dramaId,
        episode.episodeNumber
      );

      const asrResult = await generateSubtitlesWithASR(
        shots,
        shotAudios,
        dramaId,
        episode.episodeNumber
      );

      results.push({
        episodeNumber: episode.episodeNumber,
        subtitlePath: asrResult.subtitlePath,
        qualityReport: asrResult.qualityReport,
      });
    }

    // Summary
    const totalShots = results.filter(r => !r.skipped).reduce(
      (sum, r) => sum + (r as { qualityReport: { totalShots: number } }).qualityReport.totalShots, 0
    );
    const totalMatched = results.filter(r => !r.skipped).reduce(
      (sum, r) => sum + (r as { qualityReport: { matched: number } }).qualityReport.matched, 0
    );
    const totalMismatched = results.filter(r => !r.skipped).reduce(
      (sum, r) => sum + (r as { qualityReport: { mismatched: number } }).qualityReport.mismatched, 0
    );

    return NextResponse.json({
      summary: {
        totalEpisodes: targetEpisodes.length,
        totalShots,
        matched: totalMatched,
        mismatched: totalMismatched,
        accuracy: totalShots > 0 ? ((totalMatched / totalShots) * 100).toFixed(1) + "%" : "N/A",
      },
      episodes: results,
    });
  } catch (error) {
    log.error("ASR check failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: `ASR 质量检测失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

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

    try {
      await fs.access(audioPath);
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        );
        duration = parseFloat(stdout.trim()) || duration;
      } catch {
        // duration probe failed, using default
      }
    } catch {
      // audio file not found, using default duration
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
