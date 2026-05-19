import { db } from "@/lib/db";
import { verificationTokens } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

export type TokenType = "verify_email" | "reset_password";

function tokenExpiry(type: TokenType): Date {
  const ms = type === "verify_email" ? 24 * 3600_000 : 3600_000;
  return new Date(Date.now() + ms);
}

export async function createToken(email: string, type: TokenType): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(verificationTokens).values({
    id: uuidv4(),
    email,
    token,
    type,
    expiresAt: tokenExpiry(type),
  });
  return token;
}

export async function verifyToken(
  token: string,
  type: TokenType
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.token, token),
        eq(verificationTokens.type, type),
        gt(verificationTokens.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!row) return null;

  // Delete used token
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.id, row.id));

  return row.email;
}

export async function deleteTokensForEmail(email: string, type: TokenType): Promise<void> {
  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.email, email),
        eq(verificationTokens.type, type)
      )
    );
}
