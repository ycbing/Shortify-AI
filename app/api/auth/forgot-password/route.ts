import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, userPasswords } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendEmail, buildResetEmailHtml } from "@/lib/email";
import { createToken } from "@/lib/tokens";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth-api");

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = checkRateLimit(`forgot-pwd:${ip}`, 3, 3600_000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
    }

    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "请输入邮箱地址" }, { status: 400 });
    }

    // Check if email exists (don't reveal existence to avoid enumeration)
    const [existing] = await db
      .select()
      .from(userPasswords)
      .where(eq(userPasswords.email, email))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ message: "如果该邮箱已注册，你将收到重置邮件" });
    }

    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1);

    const token = await createToken(email, "reset_password");
    await sendEmail(
      email,
      "重置密码 - Shortify AI",
      buildResetEmailHtml(user?.name || email, token)
    );

    return NextResponse.json({ message: "如果该邮箱已注册，你将收到重置邮件" });
  } catch (error) {
    log.error("Forgot password failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "发送失败，请稍后重试" }, { status: 500 });
  }
}
