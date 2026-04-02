import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, userPasswords } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "邮箱和密码不能为空" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "密码至少6位" },
        { status: 400 }
      );
    }

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
      credits: 10,
    });

    await db.insert(userPasswords).values({
      userId,
      email,
      passwordHash,
    });

    return NextResponse.json({
      message: "注册成功",
      userId,
      email,
    });
  } catch (error) {
    console.error("Registration failed:", error);
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 }
    );
  }
}
