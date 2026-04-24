import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSignedCosUrl, cosKeyFromUrl, isCosUrl } from "@/lib/ai/cos-storage";
import path from "path";
import fs from "fs/promises";
import { getOwnedDrama } from "@/lib/dramas";

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
    const { format = "full" } = body;

    const drama = await getOwnedDrama(dramaId, session.user.id);

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
      return NextResponse.json({ error: "暂无可导出的视频，请先合成视频" }, { status: 400 });
    }

    if (format === "full") {
      // Try to find complete.mp4
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const completeLocalPath = path.join(uploadDir, "videos", dramaId, "complete.mp4");
      let downloadUrl: string | null = null;

      // Check if complete.mp4 exists locally
      try {
        await fs.access(completeLocalPath);
        // Convert to public URL or COS signed URL
        const publicPath = `/api/uploads/videos/${dramaId}/complete.mp4`;
        downloadUrl = `${publicPath}?download=${encodeURIComponent(drama.title || "完整视频")}.mp4`;
      } catch {
        // complete.mp4 not found, check if first episode has a COS URL for merged video
      }

      // Also check if any episode has a "complete" COS URL
      if (!downloadUrl) {
        const cosCompleteKey = `${dramaId}/videos/complete.mp4`;
        downloadUrl = getSignedCosUrl(cosCompleteKey, 7200);
      }

      // Fallback: return first episode video as individual download
      if (!downloadUrl && videoEpisodes[0]?.videoUrl) {
        downloadUrl = getDownloadUrl(videoEpisodes[0].videoUrl, `${drama.title}-第1集.mp4`);
      }

      return NextResponse.json({
        url: downloadUrl,
        format: "full",
        filename: `${drama.title || "完整视频"}.mp4`,
        episodeCount: videoEpisodes.length,
      });
    }

    // Return individual episode download URLs
    const episodeDownloads = videoEpisodes.map((ep) => {
      const filename = `${drama.title || "短剧"}-第${ep.episodeNumber}集${ep.title ? `-${ep.title}` : ""}.mp4`;
      return {
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        url: getDownloadUrl(ep.videoUrl, filename),
        filename,
      };
    });

    return NextResponse.json({
      episodes: episodeDownloads,
      format: "episodes",
    });
  } catch (error) {
    console.error("Export failed:", error);
    return NextResponse.json(
      { error: `导出失败: ${error instanceof Error ? error.message : "请稍后重试"}` },
      { status: 500 }
    );
  }
}

/**
 * Convert a stored URL (COS or local) to a downloadable URL.
 */
function getDownloadUrl(storedUrl: string | null, filename: string): string {
  if (!storedUrl) return "";

  // COS URL: generate signed URL for download
  if (isCosUrl(storedUrl)) {
    const cosKey = cosKeyFromUrl(storedUrl);
    if (cosKey) {
      return getSignedCosUrl(cosKey, 7200);
    }
  }

  // Local path: use the uploads API with download parameter
  if (!storedUrl.startsWith("http")) {
    const publicPath = storedUrl.startsWith("./uploads/")
      ? storedUrl.slice(1)
      : storedUrl.startsWith("uploads/")
        ? `/${storedUrl}`
        : `/api/uploads/${storedUrl}`;
    return `${publicPath}?download=${encodeURIComponent(filename)}`;
  }

  return storedUrl;
}
