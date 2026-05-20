import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, userPasswords } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { INITIAL_USER_CREDITS } from "@/lib/constants";
import { registerSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendEmail, buildVerifyEmailHtml } from "@/lib/email";
import { createToken } from "@/lib/tokens";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth-api");

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 registrations per IP per hour
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = checkRateLimit(`register:${ip}`, 5, 3600_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "注册过于频繁，请稍后再试" },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0];
      return NextResponse.json(
        { error: firstIssue?.message || "请求参数无效" },
        { status: 400 }
      );
    }

    const { email, password, name } = parsed.data;

    // Check if user exists
    const existing = await db
      .select()
      .from(userPasswords)
      .where(eq(userPasswords.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "该邮箱已注册" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    // Create user and password
    await db.insert(users).values({
      id: userId,
      email,
      name: name || email.split("@")[0],
      credits: INITIAL_USER_CREDITS,
    });

    await db.insert(userPasswords).values({
      userId,
      email,
      passwordHash,
    });

    // Send verification email (non-blocking)
    const verifyTokenVal = await createToken(email, "verify_email");
    sendEmail(email, "验证你的邮箱 - Shortify AI", buildVerifyEmailHtml(name || email, verifyTokenVal));

    return NextResponse.json({
      message: "注册成功，请查收验证邮件",
      userId,
      email,
    });
  } catch (error) {
    log.error("Registration failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 }
    );
  }
}
