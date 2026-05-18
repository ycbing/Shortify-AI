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

export const createDramaSchema = z.object({
  theme: z.string().min(1).max(1000),
  genre: genreSchema,
  style: styleSchema,
  episodeCount: episodeCountSchema,
});

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  name: z.string().max(100).optional(),
});

export const generateScriptSchema = z.object({
  dramaId: z.string().min(1),
  genre: genreSchema,
  style: styleSchema,
  episodeCount: episodeCountSchema,
});

export const storyboardSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});

export const voiceoverSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});

export const composeSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});

export const videoSchema = z.object({
  dramaId: z.string().min(1),
  episodeId: z.string().optional(),
});
