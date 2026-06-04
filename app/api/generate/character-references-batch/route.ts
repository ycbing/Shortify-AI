import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOwnedDrama } from "@/lib/dramas";
import { db } from "@/lib/db";
import { dramas } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { checkCredits, requireCreditDeduction } from "@/lib/credits";
import {
  createOrReuseGenerationTask,
  completeGenerationTask,
  failGenerationTask,
  updateGenerationTaskProgress,
} from "@/lib/generation";
import { createLogger } from "@/lib/logger";
import type { Character } from "@/types/drama";
import path from "path";
import fs from "fs/promises";

const log = createLogger("character-refs-batch-api");

/**
 * POST /api/generate/character-references-batch
 * 为 drama 所有角色批量生成参考图（异步任务）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少参数 dramaId" }, { status: 400 });
    }

    const drama = await getOwnedDrama(dramaId, session.user.id);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    const characters: Character[] = Array.isArray(drama.characters)
      ? drama.characters
      : [];

    // 过滤出需要生成参考图的角色（没有 referenceImageUrl 的）
    const needRef = characters.filter((c) => !c.referenceImageUrl);

    if (needRef.length === 0) {
      return NextResponse.json({
        message: "所有角色已有参考图，无需生成",
        characters,
      });
    }

    // 检查积分
    const totalCredits = needRef.length;
    const creditCheck = await checkCredits(session.user.id, totalCredits);
    if (!creditCheck.ok) {
      return NextResponse.json(
        {
          error: `积分不足，需要 ${totalCredits} 积分（${needRef.length}个角色×1积分），当前余额 ${creditCheck.balance} 积分`,
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 402 }
      );
    }

    // 创建异步任务
    const taskResult = await createOrReuseGenerationTask({
      dramaId,
      type: "character_reference",
      inputData: { characterCount: needRef.length },
    });

    // 后台执行
    processBatchReferences(
      taskResult.taskId,
      dramaId,
      session.user.id,
      drama.style || "realistic",
      characters,
      needRef.map((c) => c.name)
    ).catch((err) =>
      log.error("批量角色参考图生成失败", {
        error: err instanceof Error ? err.message : String(err),
      })
    );

    return NextResponse.json({
      taskId: taskResult.taskId,
      message: `正在为 ${needRef.length} 个角色生成参考图...`,
      characterCount: needRef.length,
    });
  } catch (error) {
    log.error("批量角色参考图请求失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: `请求失败: ${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 }
    );
  }
}

async function processBatchReferences(
  taskId: string,
  dramaId: string,
  userId: string,
  style: string,
  characters: Character[],
  characterNames: string[]
) {
  const results: { name: string; referenceImageUrl: string }[] = [];
  let creditsUsed = 0;
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");

  try {
    for (let i = 0; i < characterNames.length; i++) {
      const charName = characterNames[i];
      const charIndex = characters.findIndex((c) => c.name === charName);
      if (charIndex === -1) continue;

      const character = characters[charIndex];
      const appearance = character.appearance || character.description || "";
      const referencePrompt = `${charName}正面半身肖像，${appearance}，白色纯色背景，摄影棚均匀打光，高清摄影，面部五官清晰，自然表情，看向前方，肖像摄影`;

      log.info("生成角色参考图", {
        character: charName,
        progress: `${i + 1}/${characterNames.length}`,
      });

      try {
        const imageUrl = await generateImage(referencePrompt, style, "1024x1024");

        // 下载并上传到 COS
        const savePath = path.join(
          uploadDir,
          "images",
          dramaId,
          "characters",
          `${charName}.jpg`
        );
        await fs.mkdir(path.dirname(savePath), { recursive: true });

        const response = await fetch(imageUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          await fs.writeFile(savePath, buffer);

          const cosKey = `images/${dramaId}/characters/${charName}.jpg`;
          const finalUrl = await uploadFileToCos(savePath, cosKey);

          characters[charIndex] = {
            ...character,
            referenceImageUrl: finalUrl,
          };
          results.push({ name: charName, referenceImageUrl: finalUrl });
        }

        // 扣积分
        await requireCreditDeduction(
          userId,
          "characterReference",
          1,
          dramaId,
          `生成角色参考图 - ${charName}`
        );
        creditsUsed += 1;
      } catch (err) {
        log.error(`角色 ${charName} 参考图生成失败`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 更新进度
      await updateGenerationTaskProgress(taskId, {
        completedCount: i + 1,
        episodeCount: characterNames.length,
        creditsUsed,
      });
    }

    // 保存最终 characters 到 drama
    await db
      .update(dramas)
      .set({ characters: characters as any })
      .where(eq(dramas.id, dramaId));

    await completeGenerationTask(taskId, {
      completedCount: results.length,
      episodeCount: characterNames.length,
      creditsUsed,
      results,
    });
  } catch (error) {
    await failGenerationTask(
      taskId,
      dramaId,
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
