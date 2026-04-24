import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dramas } from "@/lib/db/schema";

export async function getOwnedDrama(dramaId: string, userId: string) {
  const [drama] = await db
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId)))
    .limit(1);

  return drama;
}
