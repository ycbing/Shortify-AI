import { NextRequest, NextResponse } from "next/server";
import { getPublicDramas, toPublicCoverUrl } from "@/lib/public-dramas";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize")) || 12));
    const genre = searchParams.get("genre") || undefined;
    const keyword = searchParams.get("keyword") || undefined;

    const { dramas, total } = await getPublicDramas(page, pageSize, { genre, keyword });

    const processed = dramas.map((d) => ({
      ...d,
      coverUrl: toPublicCoverUrl(d.coverUrl),
    }));

    return NextResponse.json({ dramas: processed, total, page, pageSize });
  } catch (error) {
    console.error("Gallery API error:", error);
    return NextResponse.json({ error: "获取作品列表失败" }, { status: 500 });
  }
}
