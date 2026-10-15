import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getOwnedDrama } from "@/lib/dramas";
import { updateShotSchema } from "@/lib/validation";
import type { Shot } from "@/types/drama";
import { applyShotUpdates } from "@/types/drama";
import { createLogger } from "@/lib/logger";

const log = createLogger("shot-api");

const EDITABLE_FIELDS = new Set([
  "visual", "line", "subtitle", "emotion", "character", "voiceId", "duration",
  // 镜头语言
  "shotSize", "cameraAngle", "cameraMove", "lighting", "transition",
]);

/**
 * PATCH /api/dramas/[dramaId]/episodes/[episodeId]/shots/[shotNumber]
 * 编辑单个镜头的文案（画面描述/台词/字幕/情绪/镜头语言/时长等），保存到 episode.shotData
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string; episodeId: string; shotNumber: string }> }
) {
  try {
    const { dramaId, episodeId, shotNumber: shotNumberStr } = await params;
    const shotNumber = Number(shotNumberStr);
    if (!Number.isInteger(shotNumber) || shotNumber < 1) {
      return NextResponse.json({ error: "shotNumber 无效" }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const parsed = updateShotSchema.safeParse(await request.json());
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0];
      return NextResponse.json(
        { error: firstIssue?.message || "请求参数无效" },
        { status: 400 }
      );
    }

    const [episode] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId)))
      .limit(1);
    if (!episode) {
      return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
    }

    const shots: Shot[] = Array.isArray(episode.shotData) ? episode.shotData : [];
    const idx = shots.findIndex((s) => s.shotNumber === shotNumber);
    if (idx === -1) {
      return NextResponse.json({ error: `镜头 ${shotNumber} 不存在` }, { status: 404 });
    }

    // 仅应用白名单字段；镜头语言/情绪/音效的空串表示清除（删除键而非存 ""）
    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([k, v]) => EDITABLE_FIELDS.has(k) && v !== undefined)
    );
    const updatedShot: Shot = applyShotUpdates(shots[idx], updates);
    const newShots = shots.map((s, i) => (i === idx ? updatedShot : s));

    await db
      .update(episodes)
      .set({ shotData: newShots as never })
      .where(eq(episodes.id, episodeId));

    log.info("Shot updated", {
      dramaId,
      episodeNumber: episode.episodeNumber,
      shotNumber,
      fields: Object.keys(updates),
    });

    return NextResponse.json({ shot: updatedShot });
  } catch (error) {
    log.error("Shot update failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: `镜头更新失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
