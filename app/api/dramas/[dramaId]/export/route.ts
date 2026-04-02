import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { mergeVideos } from "@/lib/ai/video-composer";
import path from "path";
import fs from "fs/promises";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { dramaId } = await params;
    const body = await request.json();
    const { format = "full" } = body; // "full" | "episodes"

    const [drama] = await db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, session.user.id)))
      .limit(1);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const dramaEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId))
      .orderBy(episodes.episodeNumber);

    const videoEpisodes = dramaEpisodes.filter((ep) => ep.videoUrl);
    if (videoEpisodes.length === 0) {
      return NextResponse.json({ error: "暂无可导出的视频" }, { status: 400 });
    }

    const uploadDir = process.env.UPLOAD_DIR || "./uploads";
    const outputDir = path.join(uploadDir, "exports", dramaId);

    if (format === "full") {
      // Merge all episodes
      const outputPath = path.join(outputDir, `${drama.title}-complete.mp4`);
      await mergeVideos(
        videoEpisodes.map((ep) => ep.videoUrl!),
        outputPath
      );
      return NextResponse.json({ url: outputPath, format: "full" });
    }

    // Return individual episode URLs
    return NextResponse.json({
      episodes: videoEpisodes.map((ep) => ({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        url: ep.videoUrl,
      })),
      format: "episodes",
    });
  } catch (error) {
    console.error("Export failed:", error);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
