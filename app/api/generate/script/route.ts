import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes, generationTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { generateScript } from "@/lib/ai/script-generator";
import type { DramaGenreType, DramaStyleType } from "@/types/drama";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { dramaId } = body;

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    // Get drama
    const [drama] = await db
      .select()
      .from(dramas)
      .where(eq(dramas.id, dramaId))
      .limit(1);

    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    // Create generation task
    const taskId = uuidv4();
    await db.insert(generationTasks).values({
      id: taskId,
      dramaId,
      type: "script",
      status: "processing",
      inputData: {
        theme: drama.theme,
        genre: drama.genre,
        style: drama.style,
        episodeCount: drama.episodeCount,
      },
      startedAt: new Date(),
    });

    // Generate script
    const script = await generateScript(
      drama.theme || "都市情感",
      (drama.genre as DramaGenreType) || "romance",
      (drama.style as DramaStyleType) || "realistic",
      drama.episodeCount || 3
    );

    // Update drama title
    await db
      .update(dramas)
      .set({
        title: script.title,
        status: "script_ready",
        updatedAt: new Date(),
      })
      .where(eq(dramas.id, dramaId));

    // Create episodes
    for (const ep of script.episodes) {
      await db.insert(episodes).values({
        id: uuidv4(),
        dramaId,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        scriptContent: JSON.stringify({
          narration: ep.narration,
          sceneDescription: ep.sceneDescription,
          dialogues: ep.dialogues,
        }),
        narrationText: ep.narration,
        duration: ep.duration,
      });
    }

    // Complete task
    await db
      .update(generationTasks)
      .set({
        status: "completed",
        outputData: script as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(generationTasks.id, taskId));

    return NextResponse.json({ taskId, script });
  } catch (error) {
    console.error("Script generation failed:", error);
    return NextResponse.json(
      { error: `剧本生成失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
