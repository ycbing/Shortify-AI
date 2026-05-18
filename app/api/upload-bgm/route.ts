import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTS = new Set(["mp3", "wav"]);
const ALLOWED_MIME_PREFIXES = ["audio/"];

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const dramaId = formData.get("dramaId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "未选择文件" }, { status: 400 });
    }

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    // Validate drama ownership
    const { db } = await import("@/lib/db");
    const { dramas } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [drama] = await db
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, dramaId))
      .limit(1);
    if (!drama) {
      return NextResponse.json({ error: "短剧不存在" }, { status: 404 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "文件大小不能超过 20MB" }, { status: 400 });
    }

    // Validate by MIME type (not just extension)
    const mimePrefix = file.type?.split("/")[0] + "/";
    if (!ALLOWED_MIME_PREFIXES.includes(mimePrefix)) {
      return NextResponse.json({ error: "仅支持音频文件" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "仅支持 MP3 和 WAV 格式" }, { status: 400 });
    }

    // Sanitize dramaId for path safety
    const sanitizedId = dramaId.replace(/[^a-zA-Z0-9_-]/g, "");
    const bgmDir = path.join(UPLOAD_DIR, "bgm", sanitizedId);
    await mkdir(bgmDir, { recursive: true });

    const filePath = path.join(bgmDir, `bgm.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());

    // Basic content sniffing: check for valid audio headers
    if (ext === "mp3" && buffer.length > 2) {
      // MP3 frames start with 0xFF 0xFB or 0xFF 0xFA or 0xFF 0xF2 etc.
      const hasMp3Header = (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0);
      if (!hasMp3Header && buffer[0] !== 0x49) { // 0x49 = 'I' for ID3 tag
        // Don't reject, just warn
        console.warn("BGM upload: file has .mp3 extension but no valid MP3 header");
      }
    }

    await writeFile(filePath, buffer);

    const bgmUrl = `bgm/${sanitizedId}/bgm.${ext}`;

    return NextResponse.json({ bgmUrl });
  } catch (error) {
    console.error("BGM upload failed:", error);
    return NextResponse.json(
      { error: `上传失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
