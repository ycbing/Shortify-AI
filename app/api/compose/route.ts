import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { composeVideo, mergeVideos } from "@/lib/ai/video-composer";
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
      // Compose single episode
      const [episode] = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
        .limit(1);

      if (!episode) {
        return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
      }

      if (!episode.imageUrl || !episode.voiceoverUrl) {
        return NextResponse.json(
          { error: "请先生成分镜图片和配音" },
          { status: 400 }
        );
      }

      const outputPath = path.join(
        uploadDir,
        "videos",
        `${dramaId}`,
        `episode-${episode.episodeNumber}.mp4`
      );

      await composeVideo({
        imagePath: episode.imageUrl,
        audioPath: episode.voiceoverUrl,
        outputPath,
      });

      await db
        .update(episodes)
        .set({ videoUrl: outputPath })
        .where(eq(episodes.id, episodeId));

      return NextResponse.json({ episodeId, videoUrl: outputPath });
    }

    // Compose all episodes and merge
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
      if (!episode.imageUrl || !episode.voiceoverUrl) continue;

      try {
        const outputPath = path.join(
          uploadDir,
          "videos",
          `${dramaId}`,
          `episode-${episode.episodeNumber}.mp4`
        );

        await composeVideo({
          imagePath: episode.imageUrl,
          audioPath: episode.voiceoverUrl,
          outputPath,
        });

        await db
          .update(episodes)
          .set({ videoUrl: outputPath })
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
      mergedUrl = await mergeVideos(videoPaths, mergedPath);
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
