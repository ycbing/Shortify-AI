// ============================================
// Public Dramas — 查询公开作品的纯数据层
// ============================================

import { db } from "@/lib/db";
import { dramas, episodes } from "@/lib/db/schema";
import { eq, desc, sql, like, and } from "drizzle-orm";

/** Drama statuses that are considered publicly visible */
export const PUBLIC_DRAMA_STATUSES = new Set(["completed", "storyboard_ready", "voiceover_ready"]);

export interface PublicDrama {
  id: string;
  title: string;
  genre: string | null;
  style: string | null;
  episodeCount: number | null;
  coverUrl: string | null;
  shareCount: number | null;
  createdAt: Date;
}

export interface PublicDramaWithEpisodes extends PublicDrama {
  actualEpisodeCount: number;
}

/**
 * Fetch paginated completed (public) dramas with optional genre/keyword filters.
 */
export async function getPublicDramas(
  page = 1,
  pageSize = 12,
  filters?: { genre?: string; keyword?: string }
) {
  const offset = (page - 1) * pageSize;

  const conditions = [eq(dramas.status, "completed")];
  if (filters?.genre) conditions.push(eq(dramas.genre, filters.genre));
  if (filters?.keyword) conditions.push(like(dramas.title, `%${filters.keyword}%`));
  const whereClause = and(...conditions);

  const rows = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      genre: dramas.genre,
      style: dramas.style,
      episodeCount: dramas.episodeCount,
      coverUrl: dramas.coverUrl,
      shareCount: dramas.shareCount,
      createdAt: dramas.createdAt,
    })
    .from(dramas)
    .where(whereClause)
    .orderBy(desc(dramas.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dramas)
    .where(whereClause);

  return { dramas: rows, total: count, page, pageSize };
}

/**
 * Fetch latest N completed dramas (for homepage showcase).
 */
export async function getLatestPublicDramas(limit = 3) {
  return db
    .select({
      id: dramas.id,
      title: dramas.title,
      genre: dramas.genre,
      style: dramas.style,
      episodeCount: dramas.episodeCount,
      coverUrl: dramas.coverUrl,
      shareCount: dramas.shareCount,
      createdAt: dramas.createdAt,
    })
    .from(dramas)
    .where(eq(dramas.status, "completed"))
    .orderBy(desc(dramas.createdAt))
    .limit(limit);
}

/**
 * Convert a COS URL or local path to a publicly-accessible URL
 * via the /api/uploads proxy.
 */
export function toPublicCoverUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.includes(".cos.") && url.startsWith("http")) {
    try {
      const u = new URL(url);
      const cosKey = u.pathname.slice(1);
      return `/api/uploads/cos/${encodeURIComponent(cosKey)}`;
    } catch {
      return url;
    }
  }
  if (url.startsWith("http")) return url;
  return `/api/uploads/${url.replace(/^\.?\/?uploads\/?/, "")}`;
}
