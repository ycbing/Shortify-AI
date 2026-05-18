import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSignedCosUrl } from "@/lib/ai/cos-storage";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const { searchParams } = new URL(request.url);
    const downloadName = searchParams.get("download");

    if (!pathSegments || pathSegments.length === 0) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }

    // /api/uploads/cos/<encoded-key> — proxy with signed COS URL
    if (pathSegments[0] === "cos") {
      const cosKey = decodeURIComponent(pathSegments.slice(1).join("/"));
      if (!cosKey) {
        return NextResponse.json({ error: "Missing COS key" }, { status: 400 });
      }

      const signedUrl = getSignedCosUrl(cosKey, 7200);
      if (downloadName) {
        return NextResponse.redirect(
          `${signedUrl}&response-content-disposition=${encodeURIComponent(`attachment; filename="${downloadName}"`)}`
        );
      }
      return NextResponse.redirect(signedUrl);
    }

    // /api/uploads/<relative-path> — serve local files
    const relativePath = pathSegments.join("/");
    const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");

    const fullPath = path.resolve(UPLOAD_DIR, safePath);

    if (!fullPath.startsWith(path.resolve(UPLOAD_DIR))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const exists = await fs.stat(fullPath).then((s) => s.isFile()).catch(() => false);
    if (!exists) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".srt": "text/plain",
      ".json": "application/json",
    };

    const contentType = mimeMap[ext] || "application/octet-stream";

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    };

    if (downloadName) {
      headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
    }

    return new NextResponse(buffer, { headers });
  } catch (error) {
    console.error("Uploads route error:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
