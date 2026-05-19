import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "@/lib/tokens";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "缺少验证令牌" }, { status: 400 });
    }

    const email = await verifyToken(token, "verify_email");
    if (!email) {
      return NextResponse.redirect(
        new URL("/sign-in?error=invalid_token", request.url)
      );
    }

    await db
      .update(users)
      .set({ emailVerified: new Date() })
      .where(eq(users.email, email));

    return NextResponse.redirect(
      new URL("/sign-in?verified=1", request.url)
    );
  } catch (error) {
    console.error("Email verification failed:", error);
    return NextResponse.json({ error: "验证失败" }, { status: 500 });
  }
}
