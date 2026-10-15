import { z } from "zod";

export const genreSchema = z.enum(["mystery", "romance", "comedy", "scifi", "horror"]);
export const styleSchema = z.enum(["realistic", "anime", "ink", "cyberpunk"]);
export const episodeCountSchema = z.number().int().min(1).max(20);

export const characterSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  voiceId: z.string().optional(),
  appearance: z.string().max(1000).optional(),
  personality: z.string().max(500).optional(),
  referenceImageUrl: z.string().max(2000).optional(),
});

export const aspectRatioSchema = z.enum(["landscape", "vertical"]);

export const createDramaSchema = z.object({
  theme: z.string().min(1).max(1000),
  genre: genreSchema,
  style: styleSchema,
  episodeCount: episodeCountSchema,
  aspectRatio: aspectRatioSchema.optional(),
});

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  name: z.string().max(100).optional(),
});

export const generateScriptSchema = z.object({
  dramaId: z.string().min(1),
  genre: genreSchema.optional(),
  style: styleSchema.optional(),
  episodeCount: episodeCountSchema.optional(),
});

export const storyboardSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});

export const voiceoverSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});

/** 单镜头文案编辑（PATCH /api/dramas/[dramaId]/episodes/[episodeId]/shots/[shotNumber]） */
export const updateShotSchema = z.object({
  visual: z.string().max(2000).optional(),
  line: z.string().max(500).optional(),
  subtitle: z.string().max(500).optional(),
  emotion: z.string().max(12).optional(),
  sfx: z.string().max(60).optional(),
  character: z.string().max(100).optional(),
  voiceId: z.string().max(200).optional(),
  duration: z.number().int().min(1).max(60).optional(),
});

/** 单镜头资源重跑 */
export const shotRegenerateSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().min(1),
  shotNumber: z.number().int().min(1),
  targets: z.array(z.enum(["image", "voiceover", "video"])).min(1),
  /** 可选：重跑前先应用文案修改 */
  shot: updateShotSchema.optional(),
});

export const composeSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});

export const videoSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});
