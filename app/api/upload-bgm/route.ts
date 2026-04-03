import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const dramaId = formData.get("dramaId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "未选择文件" }, { status: 400 });
    }

    if (!dramaId) {
      return NextResponse.json({ error: "缺少 dramaId" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "文件大小不能超过 20MB" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["mp3", "wav"].includes(ext || "")) {
      return NextResponse.json({ error: "仅支持 MP3 和 WAV 格式" }, { status: 400 });
    }

    const bgmDir = path.join(UPLOAD_DIR, "bgm", dramaId);
    await mkdir(bgmDir, { recursive: true });

    // Always overwrite: bgm.mp3
    const fileName = "bgm.mp3";
    const filePath = path.join(bgmDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Return relative path from uploads/
    const bgmUrl = `bgm/${dramaId}/bgm.mp3`;

    return NextResponse.json({ bgmUrl });
  } catch (error) {
    console.error("BGM upload failed:", error);
    return NextResponse.json(
      { error: `上传失败: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
