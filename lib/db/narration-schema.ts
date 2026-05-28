import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const narrations = pgTable(
  "narrations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => require("./schema").users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subject: text("subject"),
    videoScript: text("video_script"),
    searchTerms: jsonb("search_terms").default([]),
    voiceName: text("voice_name").default("zh-CN-YunyangNeural"),
    voiceRate: real("voice_rate").default(1),
    language: text("language").default("zh-CN"),
    paragraphNumber: integer("paragraph_number").default(5),
    videoAspect: text("video_aspect").default("landscape"),
    videoCount: integer("video_count").default(1),
    videoConcatMode: text("video_concat_mode").default("random"),
    videoTransition: text("video_transition").default("fade"),
    videoTransitionDuration: real("video_transition_duration").default(0.5),
    videoUrl: text("video_url"),
    subtitleUrl: text("subtitle_url"),
    bgmUrl: text("bgm_url"),
    audioUrl: text("audio_url"),
    audioDuration: real("audio_duration"),
    duration: real("duration"),
    status: text("status").default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("narrations_user_id_idx").on(table.userId)]
);

export type Narration = typeof narrations.$inferSelect;
export type NewNarration = typeof narrations.$inferInsert;
