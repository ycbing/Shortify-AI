/**
 * LibLib AI (哩布哩布) Client
 * Supports: Star-3 Alpha text2img, Kling video generation, IP-Adapter character consistency
 * Docs: https://resonate.feishu.cn/wiki/UAMVw67NcifQHukf8fpccgS5n6d
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("liblib-client");

const BASE_URL = process.env.LIBLIB_BASE_URL || "https://openapi.liblibai.cloud";
const ACCESS_KEY = process.env.LIBLIB_ACCESS_KEY || "";
const SECRET_KEY = process.env.LIBLIB_SECRET_KEY || "";
const CHECKPOINT = process.env.LIBLIB_IMAGE_CHECKPOINT || "0ea388c7eb854be3ba3c6f65aac6bfd3";
const VIDEO_MODEL = process.env.LIBLIB_VIDEO_MODEL || "kling-v2-6";

const POLL_INTERVAL = 3000;
const MAX_POLL_TIME = 120000;
const VIDEO_POLL_INTERVAL = 5000;
const MAX_VIDEO_POLL_TIME = 300000;

// ==================== Signature ====================

function createSignature(uri: string): {
  signature: string;
  timestamp: string;
  nonce: string;
} {
  const crypto = require("crypto");
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const content = `${uri}&${timestamp}&${nonce}`;

  const signature = crypto
    .createHmac("sha1", SECRET_KEY)
    .update(content)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { signature, timestamp, nonce };
}

function buildUrl(uri: string): string {
  const { signature, timestamp, nonce } = createSignature(uri);
  return `${BASE_URL}${uri}?AccessKey=${ACCESS_KEY}&Signature=${signature}&Timestamp=${timestamp}&SignatureNonce=${nonce}`;
}

// ==================== Types ====================

interface GenerateStatus {
  code: number;
  msg: string;
  data: {
    generateUuid: string;
    generateStatus: number; // 1=waiting, 2=running, 3=done, 4=reviewing, 5=success, 6=failed, 7=timeout
    percentCompleted: number;
    generateMsg: string;
    pointsCost?: number;
    accountBalance?: number;
    images?: { imageUrl: string; seed?: number; auditStatus: number }[];
    videos?: { videoUrl: string; coverPath?: string; auditStatus: number }[];
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Poll helpers ====================

async function pollImageTask(generateUuid: string): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME) {
    await sleep(POLL_INTERVAL);
    try {
      const url = buildUrl("/api/generate/webui/status");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateUuid }),
      });
      const result: GenerateStatus = await res.json();

      if (result.code !== 0) {
        log.warn("Poll returned error", { code: result.code, msg: result.msg });
        continue;
      }

      const { generateStatus, images, generateMsg, pointsCost, accountBalance } = result.data;

      if (generateStatus === 5 && images?.[0]?.imageUrl) {
        log.info("Image generated successfully", {
          pointsCost,
          accountBalance,
          seed: images[0].seed,
        });
        return images[0].imageUrl;
      }

      if (generateStatus === 6) {
        throw new Error(`LibLib image generation failed: ${generateMsg}`);
      }

      if (generateStatus === 7) {
        throw new Error("LibLib image generation timed out");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("generation failed")) throw err;
      log.warn("Poll error (retrying)", { error: (err as Error).message });
    }
  }

  throw new Error("LibLib image polling timeout");
}

async function pollVideoTask(generateUuid: string): Promise<{ videoUrl: string; coverUrl?: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_VIDEO_POLL_TIME) {
    await sleep(VIDEO_POLL_INTERVAL);
    try {
      const url = buildUrl("/api/generate/status");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateUuid }),
      });
      const result: GenerateStatus = await res.json();

      if (result.code !== 0) {
        log.warn("Video poll returned error", { code: result.code, msg: result.msg });
        continue;
      }

      const { generateStatus, videos, generateMsg, pointsCost, accountBalance } = result.data;

      if (generateStatus === 5 && videos?.[0]?.videoUrl) {
        log.info("Video generated successfully", {
          pointsCost,
          accountBalance,
        });
        return {
          videoUrl: videos[0].videoUrl,
          coverUrl: videos[0].coverPath,
        };
      }

      if (generateStatus === 6) {
        throw new Error(`LibLib video generation failed: ${generateMsg}`);
      }

      if (generateStatus === 7) {
        throw new Error("LibLib video generation timed out");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("generation failed")) throw err;
      log.warn("Video poll error (retrying)", { error: (err as Error).message });
    }
  }

  throw new Error("LibLib video polling timeout");
}

// ==================== Retry helper ====================
async function withRetry(fn: () => Promise<Response>, retries = 3, baseDelay = 2000): Promise<Response> {
  let lastRes: Response;
  for (let i = 0; i <= retries; i++) {
    const res = await fn();
    lastRes = res;
    if (res.status !== 429 || i === retries) return res;
    log.warn(`Rate limited (429), retry ${i + 1}/${retries + 1} in ${baseDelay * (i + 1)}ms`);
    await sleep(baseDelay * (i + 1));
  }
  return lastRes!;
}

// ==================== Star-3 Alpha Text-to-Image ====================

const STAR3_TEMPLATE = "5d7e67009b344550bc1aa6ccbfa1d7f4";

interface Star3Options {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "square" | "portrait" | "landscape";
  imageSize?: { width: number; height: number };
  imgCount?: number;
  steps?: number;
  controlnet?: {
    controlType: "line" | "depth" | "pose" | "IPAdapter" | "subject";
    controlImage: string;
  };
}

async function generateWithStar3(options: Star3Options): Promise<string> {
  const url = buildUrl("/api/generate/webui/text2img/ultra");

  const generateParams: Record<string, unknown> = {
    prompt: options.prompt,
    imgCount: options.imgCount || 1,
    steps: options.steps || 30,
  };

  if (options.aspectRatio) {
    generateParams.aspectRatio = options.aspectRatio;
  }
  if (options.imageSize) {
    generateParams.imageSize = options.imageSize;
  }
  if (options.negativePrompt) {
    (generateParams as Record<string, string>).negativePrompt = options.negativePrompt;
  }
  if (options.controlnet) {
    generateParams.controlnet = {
      controlType: options.controlnet.controlType,
      controlImage: options.controlnet.controlImage,
    };
  }

  const body = {
    templateUuid: STAR3_TEMPLATE,
    generateParams,
  };

  log.info("Submitting Star-3 text2img task", {
    aspectRatio: options.aspectRatio || "landscape",
    hasControlnet: !!options.controlnet,
    prompt: options.prompt.substring(0, 80),
  });

  const res = await withRetry(() => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

  const result = await res.json();
  if (result.code !== 0 || !result.data?.generateUuid) {
    throw new Error(`LibLib Star-3 generation failed: ${JSON.stringify(result)}`);
  }

  return pollImageTask(result.data.generateUuid);
}

// ==================== SD Custom Model Text-to-Image ====================

const SD_TEMPLATE = "e10adc3949ba59abbe56e057f20f883e";

interface SDOptions {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  sampler?: number;
  cfgScale?: number;
  seed?: number;
  restoreFaces?: boolean;
  additionalNetwork?: { modelId: string; weight: number }[];
  controlNet?: {
    unitOrder: number;
    sourceImage: string;
    width: number;
    height: number;
    preprocessor: number;
    model: string;
    controlWeight: number;
    startingControlStep: number;
    endingControlStep: number;
    pixelPerfect: number;
    controlMode: number;
    resizeMode: number;
    annotationParameters?: Record<string, unknown>;
  }[];
}

async function generateWithSD(options: SDOptions): Promise<string> {
  const url = buildUrl("/api/generate/webui/text2img");

  const generateParams: Record<string, unknown> = {
    checkPointId: CHECKPOINT,
    prompt: options.prompt,
    negativePrompt: options.negativePrompt || "ng_deepnegative_v1_75t,(badhandv4:1.2),EasyNegative,(worst quality:2),nsfw,watermark,text",
    clipSkip: 2,
    sampler: options.sampler || 15,
    steps: options.steps || 20,
    cfgScale: options.cfgScale || 7,
    width: options.width || 1280,
    height: options.height || 720,
    imgCount: 1,
    randnSource: 0,
    seed: options.seed || -1,
    restoreFaces: options.restoreFaces ? 1 : 0,
  };

  if (options.additionalNetwork?.length) {
    generateParams.additionalNetwork = options.additionalNetwork;
  }
  if (options.controlNet?.length) {
    generateParams.controlNet = options.controlNet;
  }

  const body = {
    templateUuid: SD_TEMPLATE,
    generateParams,
  };

  log.info("Submitting SD text2img task", {
    checkpoint: CHECKPOINT,
    width: options.width || 1280,
    height: options.height || 720,
    hasControlNet: !!options.controlNet?.length,
    prompt: options.prompt.substring(0, 80),
  });

  const res = await withRetry(() => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

  const result = await res.json();
  if (result.code !== 0 || !result.data?.generateUuid) {
    throw new Error(`LibLib SD generation failed: ${JSON.stringify(result)}`);
  }

  return pollImageTask(result.data.generateUuid);
}

// ==================== Kling Video Generation (via LibLib) ====================

export interface LibLibVideoOptions {
  prompt: string;
  startFrame?: string;
  endFrame?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  duration?: "5" | "10";
  mode?: "std" | "pro";
  model?: string;
}

export async function generateVideoWithKling(options: LibLibVideoOptions): Promise<{
  videoUrl: string;
  coverUrl?: string;
}> {
  const isImage2Video = !!options.startFrame;
  const uri = isImage2Video
    ? "/api/generate/video/kling/img2video"
    : "/api/generate/video/kling/text2video";

  const templateUuid = isImage2Video
    ? "180f33c6748041b48593030156d2a71d"
    : "61cd8b60d340404394f2a545eeaf197a";

  const generateParams: Record<string, unknown> = {
    model: options.model || VIDEO_MODEL,
    prompt: options.prompt,
    promptMagic: 1,
    aspectRatio: options.aspectRatio || "16:9",
    duration: options.duration || "5",
    mode: options.mode || "std",
  };

  if (options.startFrame) {
    // LibLib kling v2.6 uses 'images' array for image reference
    generateParams.images = [{ imageUrl: options.startFrame }];
  }
  if (options.endFrame) {
    generateParams.endFrame = options.endFrame;
    generateParams.mode = "pro";
  }

  const url = buildUrl(uri);
  const body = { templateUuid, generateParams };

  log.info("Submitting Kling video task via LibLib", {
    model: generateParams.model,
    type: isImage2Video ? "img2video" : "text2video",
    hasStartFrame: !!options.startFrame,
    duration: options.duration || "5",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (result.code !== 0 || !result.data?.generateUuid) {
    throw new Error(`LibLib Kling video failed: ${JSON.stringify(result)}`);
  }

  return pollVideoTask(result.data.generateUuid);
}

// ==================== Main Image Generation ====================

export interface LibLibCharacterReference {
  imageUrl: string;
  characterName: string;
  type: "face" | "full_body";
}

function mapSizeToDimensions(size: string): { width: number; height: number } {
  const map: Record<string, { width: number; height: number }> = {
    "1024x1024": { width: 1024, height: 1024 },
    "1280x720": { width: 1280, height: 720 },
    "1728x960": { width: 1728, height: 960 },
    "1920x1080": { width: 1920, height: 1080 },
  };
  return map[size] || { width: 1280, height: 720 };
}

/**
 * Generate image via LibLib AI
 * - Uses Star-3 Alpha for subject reference (character consistency)
 * - Falls back to SD custom model with IP-Adapter for face reference
 * - Falls back to SD custom model without reference for normal generation
 */
export async function generateImageWithLibLib(
  prompt: string,
  size: string = "1280x720",
  characterReference?: LibLibCharacterReference
): Promise<string> {
  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error("LibLib API key not configured. Set LIBLIB_ACCESS_KEY and LIBLIB_SECRET_KEY.");
  }

  const dimensions = mapSizeToDimensions(size);

  // With character reference: use Star-3 subject reference
  if (characterReference) {
    log.info("Using Star-3 Alpha with subject reference for character consistency", {
      character: characterReference.characterName,
      type: characterReference.type,
    });

    return generateWithStar3({
      prompt,
      aspectRatio: "landscape",
      imageSize: dimensions,
      steps: 30,
      controlnet: {
        controlType: "subject",
        controlImage: characterReference.imageUrl,
      },
    });
  }

  // Without reference: use SD custom model (DreamTech XL, best quality)
  return generateWithSD({
    prompt,
    width: dimensions.width,
    height: dimensions.height,
    steps: 20,
    cfgScale: 7,
    sampler: 15,
    restoreFaces: true,
  });
}

/**
 * Check if LibLib is configured
 */
export function isLibLibConfigured(): boolean {
  return !!(ACCESS_KEY && SECRET_KEY);
}
