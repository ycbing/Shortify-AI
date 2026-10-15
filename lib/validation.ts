import { z } from "zod";
import {
  SHOT_SIZE_OPTIONS,
  CAMERA_ANGLE_OPTIONS,
  CAMERA_MOVE_OPTIONS,
  LIGHTING_OPTIONS,
  SHOT_TRANSITION_OPTIONS,
  type ShotSize,
  type CameraAngle,
  type CameraMove,
  type LightingType,
  type ShotTransition,
} from "@/types/drama";

/**
 * 由「key → 中文标签」选项表派生 zod 枚举，保证 UI / 校验 / 提示词单一数据源。
 * 选项表均为非空字面量，因此这里的元组断言是安全的。
 */
export const shotSizeSchema = z.enum(
  Object.keys(SHOT_SIZE_OPTIONS) as [ShotSize, ...ShotSize[]]
);
export const cameraAngleSchema = z.enum(
  Object.keys(CAMERA_ANGLE_OPTIONS) as [CameraAngle, ...CameraAngle[]]
);
export const cameraMoveSchema = z.enum(
  Object.keys(CAMERA_MOVE_OPTIONS) as [CameraMove, ...CameraMove[]]
);
export const lightingSchema = z.enum(
  Object.keys(LIGHTING_OPTIONS) as [LightingType, ...LightingType[]]
);
export const shotTransitionSchema = z.enum(
  Object.keys(SHOT_TRANSITION_OPTIONS) as [ShotTransition, ...ShotTransition[]]
);

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

/**
 * 单镜头文案编辑（PATCH /api/dramas/[dramaId]/episodes/[episodeId]/shots/[shotNumber]）
 *
 * 镜头语言字段允许空字符串：编辑弹窗把「未设置」提交为 ""，
 * 语义是清除该标注（路由层用 applyShotUpdates 删除键，而不是存空串）。
 */
export const updateShotSchema = z.object({
  visual: z.string().max(2000).optional(),
  line: z.string().max(500).optional(),
  subtitle: z.string().max(500).optional(),
  emotion: z.string().max(12).optional(),
  sfx: z.string().max(60).optional(),
  character: z.string().max(100).optional(),
  voiceId: z.string().max(200).optional(),
  duration: z.number().int().min(1).max(60).optional(),
  // 镜头语言
  shotSize: shotSizeSchema.or(z.literal("")).optional(),
  cameraAngle: cameraAngleSchema.or(z.literal("")).optional(),
  cameraMove: cameraMoveSchema.or(z.literal("")).optional(),
  lighting: lightingSchema.or(z.literal("")).optional(),
  transition: shotTransitionSchema.or(z.literal("")).optional(),
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
