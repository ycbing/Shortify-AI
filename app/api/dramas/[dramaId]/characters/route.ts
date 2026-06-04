import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOwnedDrama } from "@/lib/dramas";
import { db } from "@/lib/db";
import { dramas } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import type { Character } from "@/types/drama";

const log = createLogger("drama-characters-api");

/**
 * PUT /api/dramas/[dramaId]/characters
 * 更新角色的 referenceImageUrl（用户手动设置/替换）
 * Body: { characterName: string, referenceImageUrl: string }
 */
export async function PUT(
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
    const { characterName, referenceImageUrl } = body;

    if (!characterName || !referenceImageUrl) {
      return NextResponse.json(
        { error: "缺少参数 characterName 或 referenceImageUrl" },
        { status: 400 }
      );
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const characters: Character[] = Array.isArray(drama.characters)
      ? [...drama.characters]
      : [];

    const charIndex = characters.findIndex((c) => c.name === characterName);
    if (charIndex === -1) {
      return NextResponse.json(
        { error: `角色 "${characterName}" 不存在` },
        { status: 404 }
      );
    }

    characters[charIndex] = {
      ...characters[charIndex],
      referenceImageUrl,
    };

    await db
      .update(dramas)
      .set({ characters: characters as any })
      .where(eq(dramas.id, dramaId));

    log.info("角色参考图已更新", {
      dramaId,
      characterName,
    });

    return NextResponse.json({
      characterName,
      referenceImageUrl,
      character: characters[charIndex],
    });
  } catch (error) {
    log.error("更新角色参考图失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: `更新失败: ${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/dramas/[dramaId]/characters?characterName=xxx
 * 删除角色的参考图（清除 referenceImageUrl）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ dramaId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { dramaId } = await params;
    const { searchParams } = new URL(request.url);
    const characterName = searchParams.get("characterName");

    if (!characterName) {
      return NextResponse.json(
        { error: "缺少参数 characterName" },
        { status: 400 }
      );
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const characters: Character[] = Array.isArray(drama.characters)
      ? [...drama.characters]
      : [];

    const charIndex = characters.findIndex((c) => c.name === characterName);
    if (charIndex === -1) {
      return NextResponse.json(
        { error: `角色 "${characterName}" 不存在` },
        { status: 404 }
      );
    }

    characters[charIndex] = {
      ...characters[charIndex],
      referenceImageUrl: undefined,
    };

    await db
      .update(dramas)
      .set({ characters: characters as any })
      .where(eq(dramas.id, dramaId));

    return NextResponse.json({
      characterName,
      message: "参考图已清除",
    });
  } catch (error) {
    log.error("删除角色参考图失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: `删除失败: ${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 }
    );
  }
}
