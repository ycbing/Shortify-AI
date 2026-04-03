import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateVoiceover, generateShotVoiceovers } from "@/lib/ai/voiceover-generator";
import type { Shot } from "@/types/drama";
import path from "path";

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

    const uploadDir = process.env.UPLOAD_DIR || "./uploads";

    if (episodeId) {
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

    const taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "voiceover",
      status: "processing",
      inputData: { episodeCount: allEpisodes.length },
      startedAt: new Date(),
    });

    const results: { episodeNumber: number; voiceoverUrl: string; duration: number; shotAudios?: unknown[] }[] = [];

    for (const episode of allEpisodes) {
      try {
        if (episode.shotData && Array.isArray(episode.shotData)) {
          // V2: per-shot voiceovers
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
          // V1 fallback
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
            .where(eq(episodes.id, episode.id));

          results.push({
            episodeNumber: episode.episodeNumber,
            voiceoverUrl: result.filePath,
            duration: result.durationSeconds,
          });
        }
      } catch (err) {
        console.error(`Failed to generate voiceover for episode ${episode.episodeNumber}:`, err);
      }
    }

    await db
      .update(dramas)
      .set({ status: "voiceover_ready", updatedAt: new Date() })
      .where(eq(dramas.id, dramaId));

    await db
      .update(generationTasks)
      .set({ status: "completed", outputData: { results }, completedAt: new Date() })
      .where(eq(generationTasks.id, taskId));

    return NextResponse.json({ taskId, results });
  } catch (error) {
    console.error("Voiceover generation failed:", error);
    return NextResponse.json(
      { error: `配音生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
