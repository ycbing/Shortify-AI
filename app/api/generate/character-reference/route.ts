import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOwnedDrama } from "@/lib/dramas";
import { db } from "@/lib/db";
import { dramas } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { checkCredits, requireCreditDeduction } from "@/lib/credits";
import { createLogger } from "@/lib/logger";
import type { Character } from "@/types/drama";
import path from "path";
import fs from "fs/promises";

const log = createLogger("character-reference-api");

/**
 * POST /api/generate/character-reference
 * 为指定角色生成标准参考图（正面半身照）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId, characterName } = body;

    if (!dramaId || !characterName) {
      return NextResponse.json(
        { error: "缺少参数 dramaId 或 characterName" },
        { status: 400 }
      );
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const characters: Character[] = Array.isArray(drama.characters)
      ? drama.characters
      : [];
    const charIndex = characters.findIndex((c) => c.name === characterName);

    if (charIndex === -1) {
      return NextResponse.json(
        { error: `角色 "${characterName}" 不存在` },
        { status: 404 }
      );
    }

    const character = characters[charIndex];

    // 检查积分
    const creditCheck = await checkCredits(
      session.user.id,
      1 // characterReference: 1
    );
    if (!creditCheck.ok) {
      return NextResponse.json(
        {
          error: `积分不足，需要 1 积分，当前余额 ${creditCheck.balance} 积分`,
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 402 }
      );
    }

    // 构建参考图专用 prompt
    const appearance = character.appearance || character.description || "";
    const referencePrompt = `${characterName}正面半身肖像，${appearance}，白色纯色背景，摄影棚均匀打光，高清摄影，面部五官清晰，自然表情，看向前方，肖像摄影`;

    // 生成参考图（1024x1024 正方形，适合作为参考）
    log.info("生成角色参考图", {
      character: characterName,
      dramaId,
      appearance: appearance.substring(0, 50),
    });

    const imageUrl = await generateImage(
      referencePrompt,
      drama.style || "realistic",
      "1024x1024"
    );

    // 下载并上传到 COS
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    const savePath = path.join(
      uploadDir,
      "images",
      dramaId,
      "characters",
      `${characterName}.jpg`
    );
    await fs.mkdir(path.dirname(savePath), { recursive: true });

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下载参考图失败: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(savePath, buffer);

    const cosKey = `images/${dramaId}/characters/${characterName}.jpg`;
    const finalUrl = await uploadFileToCos(savePath, cosKey);

    // 更新 drama.characters 的 referenceImageUrl
    const updatedCharacters = characters.map((c, i) =>
      i === charIndex ? { ...c, referenceImageUrl: finalUrl } : c
    );

    await db
      .update(dramas)
      .set({ characters: updatedCharacters as any })
      .where(eq(dramas.id, dramaId));

    // 扣积分
    await requireCreditDeduction(
      session.user.id,
      "characterReference",
      1,
      dramaId,
      `生成角色参考图 - ${characterName}`
    );

    log.info("角色参考图生成完成", {
      character: characterName,
      dramaId,
      url: finalUrl.substring(0, 80) + "...",
    });

    return NextResponse.json({
      characterName,
      referenceImageUrl: finalUrl,
      character: updatedCharacters[charIndex],
    });
  } catch (error) {
    log.error("角色参考图生成失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: `生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 }
    );
  }
}
