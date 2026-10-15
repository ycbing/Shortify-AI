import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedDrama } from "@/lib/dramas";
import { checkCredits, requireCreditDeduction } from "@/lib/credits";
import { enrollVoice, voiceEnrollPrefix, isVoiceCloneSupported } from "@/lib/ai/cosyvoice-clone";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import type { Character, Shot } from "@/types/drama";
import { createLogger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";

const log = createLogger("voice-clone-api");

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB
const MIN_SAMPLE_SEC = 6;
const MAX_SAMPLE_SEC = 60;

/**
 * POST /api/generate/voice-clone
 * 为角色复刻专属音色：样本音频 → COS → 百炼 Voice Enrollment → 更新角色 voiceId
 * 复刻音色自动同步到该角色在所有剧集分镜中的 voiceId，重新生成配音即生效。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    if (!isVoiceCloneSupported()) {
      return NextResponse.json(
        { error: "声音复刻需要配置 DASHSCOPE_API_KEY" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { dramaId, characterName, audio } = body as {
      dramaId?: string;
      characterName?: string;
      audio?: string; // data:audio/xxx;base64,...
    };

    if (!dramaId || !characterName || !audio) {
      return NextResponse.json(
        { error: "缺少参数 dramaId / characterName / audio" },
        { status: 400 }
      );
    }

    const match = audio.match(/^data:audio\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { error: "音频格式无效，请上传 mp3/wav/m4a 格式的样本" },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length < 32 * 1024) {
      return NextResponse.json(
        { error: "样本太短，请提供 10~20 秒的清晰人声样本" },
        { status: 400 }
      );
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "样本超过 8MB，请裁剪到 10~20 秒后重试" },
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

    // 积分
    const creditCheck = await checkCredits(session.user.id, 2);
    if (!creditCheck.ok) {
      return NextResponse.json(
        {
          error: `积分不足，需要 2 积分，当前余额 ${creditCheck.balance} 积分`,
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 402 }
      );
    }

    // 1. 样本落盘并校验时长
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
    const safeName = characterName.replace(/[^\w一-龥-]/g, "_");
    const samplePath = path.join(
      uploadDir,
      "voice-samples",
      dramaId,
      `${safeName}.mp3`
    );
    await fs.mkdir(path.dirname(samplePath), { recursive: true });
    await fs.writeFile(samplePath, buffer);

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    let durationSec = 0;
    try {
      const { stdout } = await promisify(exec)(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${samplePath}"`,
        { timeout: 15000 }
      );
      durationSec = parseFloat(stdout.trim()) || 0;
    } catch {
      // ffprobe 失败则不阻断，交给 Enrollment 校验
    }
    if (durationSec > 0 && (durationSec < MIN_SAMPLE_SEC || durationSec > MAX_SAMPLE_SEC)) {
      return NextResponse.json(
        {
          error: `样本时长 ${durationSec.toFixed(0)} 秒，建议 10~20 秒（允许 6~60 秒）`,
        },
        { status: 400 }
      );
    }

    // 2. 上传 COS，拿到百炼可访问的 URL
    const cosKey = `voice-samples/${dramaId}/${safeName}.mp3`;
    const sampleUrl = await uploadFileToCos(samplePath, cosKey);

    // 3. 注册复刻音色
    const voiceId = await enrollVoice(
      sampleUrl,
      voiceEnrollPrefix(dramaId, characterName)
    );

    // 4. 更新角色 voiceId，并同步到所有剧集分镜中的该角色
    const updatedCharacters = characters.map((c, i) =>
      i === charIndex ? { ...c, voiceId } : c
    );
    await db
      .update(dramas)
      .set({ characters: updatedCharacters as never })
      .where(eq(dramas.id, dramaId));

    const allEpisodes = await db
      .select()
      .from(episodes)
      .where(eq(episodes.dramaId, dramaId));

    let shotsUpdated = 0;
    for (const episode of allEpisodes) {
      const shots: Shot[] = Array.isArray(episode.shotData)
        ? episode.shotData
        : [];
      if (shots.length === 0) continue;
      const newShots = shots.map((s) =>
        s.character === characterName ? { ...s, voiceId } : s
      );
      const changed = newShots.some((s, i) => s.voiceId !== shots[i].voiceId);
      if (changed) {
        shotsUpdated += newShots.filter(
          (s, i) => s.voiceId !== shots[i].voiceId
        ).length;
        await db
          .update(episodes)
          .set({ shotData: newShots as never })
          .where(eq(episodes.id, episode.id));
      }
    }

    await requireCreditDeduction(
      session.user.id,
      "voiceClone",
      undefined,
      dramaId,
      `声音复刻 - ${characterName}`
    );

    log.info("Voice clone complete", {
      dramaId,
      characterName,
      voiceId,
      shotsUpdated,
      sampleDuration: durationSec,
    });

    return NextResponse.json({
      characterName,
      voiceId,
      shotsUpdated,
      character: updatedCharacters[charIndex],
    });
  } catch (error) {
    log.error("Voice clone failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: `声音复刻失败: ${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 }
    );
  }
}
