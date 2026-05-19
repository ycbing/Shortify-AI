import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { userPasswords } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyToken, deleteTokensForEmail } from "@/lib/tokens";

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "密码至少6位" }, { status: 400 });
    }

    const { token, password } = parsed.data;

    const email = await verifyToken(token, "reset_password");
    if (!email) {
      return NextResponse.json({ error: "重置链接已过期或无效" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db
      .update(userPasswords)
      .set({ passwordHash })
      .where(eq(userPasswords.email, email));

    // Clean up any remaining reset tokens
    await deleteTokensForEmail(email, "reset_password");

    return NextResponse.json({ message: "密码已重置，请重新登录" });
  } catch (error) {
    console.error("Reset password failed:", error);
    return NextResponse.json({ error: "重置失败，请稍后重试" }, { status: 500 });
  }
}
