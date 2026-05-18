import { withRetry, withTimeout } from "@/lib/resilience";
import { createLogger } from "@/lib/logger";
import { createHmac } from "crypto";

const log = createLogger("kling-client");

const KLING_BASE_URL = process.env.KLING_BASE_URL || "https://api.klingai.com";
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY || "";
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY || "";
const KLING_MODEL = process.env.KLING_MODEL || "kling-v1.6";
const POLL_INTERVAL = Number(process.env.KLING_POLL_INTERVAL_MS || "3000");
const MAX_POLL_TIME = Number(process.env.KLING_MAX_POLL_TIME_MS || "120000");
const VIDEO_POLL_INTERVAL = Number(process.env.KLING_VIDEO_POLL_INTERVAL_MS || "5000");
const MAX_VIDEO_POLL_TIME = Number(process.env.KLING_MAX_VIDEO_POLL_TIME_MS || "300000");

function createToken(accessKey: string, secretKey: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: accessKey,
      exp: now + 1800,
      nbf: now,
    })
  ).toString("base64url");

  const signature = createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

function mapSize(size: string): string {
  const map: Record<string, string> = {
    "1024x1024": "1024x1024",
    "1280x720": "1280x720",
    "1728x960": "1728x960",
    "1920x1080": "1920x1080",
  };
  return map[size] || "1280x720";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface KlingJobResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status?: string;
    status?: string;
    images?: { url: string; seed?: number }[];
    videos?: { url: string; cover?: string; seed?: number }[];
  };
}

export interface KlingCharacterReference {
  imageUrl: string;
  type: "face" | "full_body";
}

interface VideoResult {
  videoUrl: string;
  coverUrl?: string;
}

export async function generateImageWithKling(
  prompt: string,
  size: string = "1280x720",
  characterReference?: KlingCharacterReference
): Promise<string> {
  if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
    throw new Error("Kling API key not configured. Set KLING_ACCESS_KEY and KLING_SECRET_KEY.");
  }

  const token = createToken(KLING_ACCESS_KEY, KLING_SECRET_KEY);

  const body: Record<string, unknown> = {
    model: KLING_MODEL,
    prompt,
    size: mapSize(size),
    negative_prompt:
      process.env.KLING_NEGATIVE_PROMPT ||
      "low quality, blurry, distorted, ugly, bad anatomy, watermark, text, logo, signature, monochrome, bad proportions, extra limbs",
    n: 1,
  };

  if (characterReference) {
    body.character_reference = {
      image_url: characterReference.imageUrl,
      type: characterReference.type,
    };
    log.info(`Using Kling character reference`, {
      type: characterReference.type,
      imageUrl: characterReference.imageUrl.substring(0, 80) + "...",
    });
  }

  const submitResponse = await withRetry(
    async () => {
      const res = await fetch(`${KLING_BASE_URL}/v1/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kling submit error: ${res.status} - ${text}`);
      }

      return res.json() as Promise<KlingJobResponse>;
    },
    { maxRetries: 3, baseDelayMs: 2000 }
  );

  if (submitResponse.code !== 0) {
    throw new Error(`Kling task submit failed: ${submitResponse.message}`);
  }

  const taskId = submitResponse.data.task_id;
  const initialStatus = submitResponse.data.task_status || submitResponse.data.status || "";
  log.info(`Kling task submitted`, { taskId, initialStatus });

  // If the response already contains images (synchronous completion)
  if (submitResponse.data.images && submitResponse.data.images.length > 0) {
    log.info(`Kling task completed synchronously`, { taskId });
    return submitResponse.data.images[0].url;
  }

  // Poll for async completion
  return withTimeout(
    async () => {
      while (true) {
        await sleep(POLL_INTERVAL);

        const freshToken = createToken(KLING_ACCESS_KEY, KLING_SECRET_KEY);
        const res = await fetch(
          `${KLING_BASE_URL}/v1/images/generations/${taskId}`,
          {
            headers: { Authorization: `Bearer ${freshToken}` },
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Kling poll error: ${res.status} - ${text}`);
        }

        const result = (await res.json()) as KlingJobResponse;

        if (result.code !== 0) {
          throw new Error(`Kling task failed: ${result.message}`);
        }

        const taskStatus =
          result.data.task_status || result.data.status || "";

        if (taskStatus === "succeed" || taskStatus === "completed") {
          const images = result.data.images;
          if (!images || images.length === 0) {
            throw new Error("Kling returned no images");
          }
          log.info(`Kling task completed`, { taskId });
          return images[0].url;
        }

        if (taskStatus === "failed") {
          throw new Error(
            `Kling image generation failed: ${result.message}`
          );
        }

        log.debug(`Kling task polling`, { taskId, status: taskStatus });
      }
    },
    MAX_POLL_TIME,
    "Kling image generation"
  );
}

function pollKlingTask(
  taskId: string,
  endpoint: string,
  pollInterval: number,
  maxPollTime: number,
  resultField: "images" | "videos",
  label: string
): Promise<string> {
  return withTimeout(
    async () => {
      while (true) {
        await sleep(pollInterval);

        const freshToken = createToken(KLING_ACCESS_KEY, KLING_SECRET_KEY);
        const res = await fetch(
          `${KLING_BASE_URL}${endpoint}/${taskId}`,
          {
            headers: { Authorization: `Bearer ${freshToken}` },
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Kling poll error: ${res.status} - ${text}`);
        }

        const result = (await res.json()) as KlingJobResponse;

        if (result.code !== 0) {
          throw new Error(`Kling task failed: ${result.message}`);
        }

        const taskStatus =
          result.data.task_status || result.data.status || "";

        if (taskStatus === "succeed" || taskStatus === "completed") {
          const items = result.data[resultField];
          if (!items || items.length === 0) {
            throw new Error(`Kling returned no ${resultField}`);
          }
          log.info(`Kling ${label} completed`, { taskId });
          return items[0].url;
        }

        if (taskStatus === "failed") {
          throw new Error(`Kling ${label} failed: ${result.message}`);
        }

        log.debug(`Kling ${label} polling`, { taskId, status: taskStatus });
      }
    },
    maxPollTime,
    `Kling ${label}`
  );
}

export async function generateVideoWithKling(
  prompt: string,
  imageUrl: string,
  characterReference?: KlingCharacterReference
): Promise<{ videoUrl: string; coverUrl?: string }> {
  if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
    throw new Error("Kling API key not configured. Set KLING_ACCESS_KEY and KLING_SECRET_KEY.");
  }

  const token = createToken(KLING_ACCESS_KEY, KLING_SECRET_KEY);

  const body: Record<string, unknown> = {
    model: process.env.KLING_VIDEO_MODEL || KLING_MODEL,
    prompt,
    image_url: imageUrl,
    size: process.env.KLING_VIDEO_SIZE || "1280x720",
    duration: Number(process.env.KLING_VIDEO_DURATION || "5"),
  };

  if (characterReference) {
    body.character_reference = {
      image_url: characterReference.imageUrl,
      type: characterReference.type,
    };
    log.info(`Using Kling video character reference`, {
      type: characterReference.type,
    });
  }

  const submitResponse = await withRetry(
    async () => {
      const res = await fetch(`${KLING_BASE_URL}/v1/videos/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kling video submit error: ${res.status} - ${text}`);
      }

      return res.json() as Promise<KlingJobResponse>;
    },
    { maxRetries: 3, baseDelayMs: 2000 }
  );

  if (submitResponse.code !== 0) {
    throw new Error(`Kling video task submit failed: ${submitResponse.message}`);
  }

  const taskId = submitResponse.data.task_id;
  log.info(`Kling video task submitted`, { taskId });

  if (submitResponse.data.videos && submitResponse.data.videos.length > 0) {
    const v = submitResponse.data.videos[0];
    return { videoUrl: v.url, coverUrl: v.cover };
  }

  const videoUrl = await pollKlingTask(
    taskId,
    "/v1/videos/generations",
    VIDEO_POLL_INTERVAL,
    MAX_VIDEO_POLL_TIME,
    "videos",
    "video generation"
  );

  return { videoUrl };
}
