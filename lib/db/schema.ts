// ============================================
// Shortify AI - Database Schema
// ============================================

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Users table
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  credits: integer("credits").default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// User passwords (credential auth)
export const userPasswords = pgTable(
  "user_passwords",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("user_passwords_email_idx").on(table.email)]
);

// Dramas (short drama projects)
export const dramas = pgTable(
  "dramas",
  {
    id: text("id").primaryKey(), // UUID
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    theme: text("theme"), // user input theme
    genre: text("genre"), // 悬疑/爱情/喜剧/科幻/恐怖
    style: text("style"), // 写实/动漫/水墨/赛博朋克
    episodeCount: integer("episode_count").default(3),
    status: text("status").default("draft"), // draft/generating/script_ready/storyboard_ready/voiceover_ready/completed/error
    totalDuration: integer("total_duration"),
    coverUrl: text("cover_url"),
    bgmUrl: text("bgm_url"), // user-uploaded background music file
    shareCount: integer("share_count").default(0), // share click counter
    characters: jsonb("characters"), // v2: character list with voiceId
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dramas_user_id_idx").on(table.userId)]
);

// Episodes
export const episodes = pgTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    dramaId: text("drama_id")
      .notNull()
      .references(() => dramas.id, { onDelete: "cascade" }),
    episodeNumber: integer("episode_number").notNull(),
    title: text("title"),
    scriptContent: text("script_content"), // full script text (JSON string)
    narrationText: text("narration_text"), // narration for TTS (v1 fallback)
    imageUrl: text("image_url"), // storyboard image
    voiceoverUrl: text("voiceover_url"), // voiceover audio
    videoUrl: text("video_url"), // episode video
    duration: integer("duration"), // seconds
    shotData: jsonb("shot_data"), // v2: shots array (JSON)
    subtitleUrl: text("subtitle_url"), // v2: SRT subtitle file path
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("episodes_drama_id_idx").on(table.dramaId),
    uniqueIndex("episodes_drama_number_idx").on(table.dramaId, table.episodeNumber),
  ]
);

// Usage logs (credits consumption tracking)
export const usageLogs = pgTable(
  "usage_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // script/storyboard/voiceover/compose/video
    creditsUsed: integer("credits_used").notNull(),
    dramaId: text("drama_id")
      .references(() => dramas.id, { onDelete: "set null" }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("usage_logs_user_id_idx").on(table.userId),
    index("usage_logs_drama_id_idx").on(table.dramaId),
  ]
);

// Generation tasks (async job tracking)
export const generationTasks = pgTable(
  "generation_tasks",
  {
    id: text("id").primaryKey(),
    dramaId: text("drama_id")
      .notNull()
      .references(() => dramas.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    type: text("type").notNull(), // script/storyboard/voiceover/compose/subtitle/video
    status: text("status").default("pending"), // pending/processing/completed/failed
    inputData: jsonb("input_data"),
    outputData: jsonb("output_data"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("generation_tasks_drama_id_idx").on(table.dramaId)]
);

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Drama = typeof dramas.$inferSelect;
export type NewDrama = typeof dramas.$inferInsert;
export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;
export type GenerationTask = typeof generationTasks.$inferSelect;
export type NewGenerationTask = typeof generationTasks.$inferInsert;
