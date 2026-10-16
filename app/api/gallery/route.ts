import { NextRequest, NextResponse } from "next/server";
import { getPublicDramas, toPublicCoverUrl } from "@/lib/public-dramas";
import { createLogger } from "@/lib/logger";

const log = createLogger("gallery-api");

/**
 * GET /api/gallery?page=1&pageSize=12&genre=romance&keyword=xxx
 * 公开作品列表（仅 completed），落地页与作品集使用，无需登录
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(24, Math.max(1, Number(searchParams.get("pageSize")) || 12));
    const genre = searchParams.get("genre") || undefined;
    const keyword = searchParams.get("keyword") || undefined;

    const result = await getPublicDramas(page, pageSize, { genre, keyword });

    return NextResponse.json({
      dramas: result.dramas.map((d) => ({
        ...d,
        coverUrl: toPublicCoverUrl(d.coverUrl),
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (error) {
    log.error("Gallery fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "获取作品列表失败" }, { status: 500 });
  }
}
