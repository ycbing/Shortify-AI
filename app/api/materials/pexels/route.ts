import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  searchVideos,
  searchAndDownloadVideos,
  extractSearchTermsFromShots,
} from "@/lib/ai/pexels-material";
import path from "path";
import { createLogger } from "@/lib/logger";

const log = createLogger("pexels-api");

function isPexelsConfigured(): boolean {
  return !!process.env.PEXELS_API_KEY;
}

/**
 * GET /api/materials/pexels - Search Pexels videos (preview only, no download)
 * Query: ?q=search_term&orientation=landscape&per_page=5
 */
export async function GET(request: NextRequest) {
  if (!isPexelsConfigured()) {
    return NextResponse.json(
      { error: "Pexels API 未配置，请在 .env.local 中设置 PEXELS_API_KEY" },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const orientation = (searchParams.get("orientation") as "portrait" | "landscape") || "landscape";
    const perPage = Math.min(parseInt(searchParams.get("per_page") || "6"), 15);
    const minDuration = parseInt(searchParams.get("min_duration") || "3");

    if (!query.trim()) {
      return NextResponse.json({ error: "请提供搜索关键词" }, { status: 400 });
    }

    const videos = await searchVideos(query, orientation, minDuration);
    // Return limited results for preview
    const preview = videos.slice(0, perPage).map((v) => ({
      url: v.url,
      duration: v.duration,
      width: v.width,
      height: v.height,
      provider: v.provider,
      // Generate a thumbnail-like preview URL (Pexels video images)
      previewUrl: `https://videos.pexels.com/video-files/${v.url.split("/").pop()?.split("-")[0] || ""}/`,
    }));

    return NextResponse.json({ videos: preview, total: videos.length });
  } catch (error) {
    log.error("Pexels search failed", { error: error instanceof Error ? error.message : error });
    return NextResponse.json(
      { error: `搜索失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/materials/pexels - Download Pexels videos for a drama episode
 * Body: { dramaId, episodeNumber, shots, orientation }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    if (!isPexelsConfigured()) {
      return NextResponse.json(
        { error: "Pexels API 未配置" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { dramaId, episodeNumber, shots, orientation = "landscape" } = body;

    if (!dramaId || !episodeNumber) {
      return NextResponse.json({ error: "缺少 dramaId 或 episodeNumber" }, { status: 400 });
    }

    // Extract search terms from shot visuals
    const terms = extractSearchTermsFromShots(shots || []);
    if (terms.length === 0) {
      return NextResponse.json({ error: "无法从镜头描述中提取搜索关键词" }, { status: 400 });
    }

    // Calculate total duration needed
    const totalDuration = (shots || []).reduce((sum: number, s: { duration: number }) => sum + (s.duration || 5), 0);

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    const saveDir = path.join(uploadDir, "cache_videos");

    log.info(`Downloading Pexels videos for drama ${dramaId} episode ${episodeNumber}`, {
      terms,
      totalDuration: Math.ceil(totalDuration),
      orientation,
    });

    const videoPaths = await searchAndDownloadVideos(
      terms,
      orientation,
      totalDuration,
      saveDir,
      10 // max clip duration
    );

    return NextResponse.json({
      dramaId,
      episodeNumber,
      videoPaths,
      videoCount: videoPaths.length,
      searchTerms: terms,
    });
  } catch (error) {
    log.error("Pexels download failed", { error: error instanceof Error ? error.message : error });
    return NextResponse.json(
      { error: `下载失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
