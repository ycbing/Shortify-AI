import https from "https";
import http from "http";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { createWriteStream } from "fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("pexels-material");

// ============ Types ============

export interface PexelsVideoItem {
  url: string; // direct download URL
  duration: number;
  width: number;
  height: number;
  provider: "pexels";
}

export interface PexelsSearchResult {
  id: number;
  duration: number;
  image: string;
  video_files: Array<{
    id: number;
    quality: string;
    file_type: string;
    width: number;
    height: number;
    link: string;
  }>;
}

// ============ API ============

function getPexelsApiKey(): string {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    throw new Error(
      "PEXELS_API_KEY is not set. Please add it to .env.local.\n" +
      "Get a free API key at https://www.pexels.com/api/"
    );
  }
  return key;
}

function getResolution(orientation: "portrait" | "landscape"): { width: number; height: number } {
  return orientation === "portrait"
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

/**
 * Search Pexels for videos matching a query.
 */
export async function searchVideos(
  searchTerm: string,
  orientation: "portrait" | "landscape" = "landscape",
  minDuration = 3
): Promise<PexelsVideoItem[]> {
  const apiKey = getPexelsApiKey();
  const targetRes = getResolution(orientation);

  const params = new URLSearchParams({
    query: searchTerm,
    per_page: "15",
    orientation,
  });
  if (minDuration > 0) {
    params.set("min_duration", String(minDuration));
  }

  const url = `https://api.pexels.com/videos/search?${params}`;
  log.info(`Searching Pexels: "${searchTerm}" (${orientation})`);

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: apiKey,
          "User-Agent": "ShortifyAI/1.0",
        },
        timeout: 30_000,
      },
      (response) => {
        if (response.statusCode === 429) {
          reject(new Error("Pexels API rate limit reached (429). Try again later."));
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Pexels API returned status ${response.statusCode}`));
          return;
        }

        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            const json = JSON.parse(data);
            const videos: PexelsSearchResult[] = json.videos || [];
            const items: PexelsVideoItem[] = [];

            for (const v of videos) {
              if (v.duration < minDuration) continue;
              // Pick best quality matching target resolution
              let bestFile = v.video_files[0];
              for (const vf of v.video_files) {
                if (vf.width >= targetRes.width && vf.height >= targetRes.height) {
                  bestFile = vf;
                  break;
                }
              }
              items.push({
                url: bestFile.link,
                duration: v.duration,
                width: bestFile.width,
                height: bestFile.height,
                provider: "pexels",
              });
            }

            log.info(`Found ${items.length} videos for "${searchTerm}"`);
            resolve(items);
          } catch (err) {
            reject(new Error(`Failed to parse Pexels response: ${err}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Pexels API request timed out"));
    });
  });
}

// ============ Download ============

/**
 * Download a video from URL to local file. Skips if already downloaded.
 */
export async function downloadVideo(
  videoUrl: string,
  saveDir: string
): Promise<string> {
  const cacheDir = path.resolve(saveDir);
  await fs.promises.mkdir(cacheDir, { recursive: true });

  // Hash URL for cache key
  const urlHash = crypto.createHash("md5").update(videoUrl).digest("hex");
  const videoId = `vid-${urlHash}`;
  const localPath = path.join(cacheDir, `${videoId}.mp4`);

  // Check if already downloaded
  try {
    const stat = await fs.promises.stat(localPath);
    if (stat.size > 0) {
      log.info(`Using cached video: ${videoId}`);
      return localPath;
    }
  } catch {
    // Not cached, proceed to download
  }

  log.info(`Downloading video: ${videoUrl.substring(0, 80)}...`);

  return new Promise((resolve, reject) => {
    const doGet = (targetUrl: string) => {
      const mod = targetUrl.startsWith("https") ? https : http;
      const req = mod.get(targetUrl, (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading video`));
          return;
        }

        const file = createWriteStream(localPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          // Verify the downloaded file
          fs.promises
            .stat(localPath)
            .then((stat) => {
              if (stat.size > 0) {
                log.info(`Downloaded video: ${videoId} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
                resolve(localPath);
              } else {
                fs.promises.unlink(localPath).catch(() => {});
                reject(new Error("Downloaded video is empty"));
              }
            })
            .catch(reject);
        });
      });

      req.on("error", reject);
      req.setTimeout(120_000, () => {
        req.destroy();
        reject(new Error("Video download timed out"));
      });
    };

    doGet(videoUrl);
  });
}

// ============ Search + Download ============

/**
 * Search and download enough videos to cover the required total duration.
 * Iterates through search terms until enough footage is collected.
 */
export async function searchAndDownloadVideos(
  searchTerms: string[],
  orientation: "portrait" | "landscape",
  totalDuration: number,
  saveDir: string,
  maxClipDuration = 10
): Promise<string[]> {
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const cacheDir = path.resolve(uploadDir, "cache_videos");
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const allItems: PexelsVideoItem[] = [];
  const seenUrls = new Set<string>();

  for (const term of searchTerms) {
    if (!term.trim()) continue;
    try {
      const items = await searchVideos(term, orientation, Math.min(maxClipDuration, 3));
      for (const item of items) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allItems.push(item);
        }
      }
    } catch (err) {
      log.warn(`Failed to search "${term}": ${err instanceof Error ? err.message : err}`);
    }

    // Check if we have enough duration
    const foundDuration = allItems.reduce((sum, i) => sum + Math.min(i.duration, maxClipDuration), 0);
    if (foundDuration >= totalDuration) break;
  }

  if (allItems.length === 0) {
    throw new Error("No videos found for the given search terms");
  }

  // Download videos
  const videoPaths: string[] = [];
  let downloadedDuration = 0;

  for (const item of allItems) {
    if (downloadedDuration >= totalDuration) break;

    try {
      const localPath = await downloadVideo(item.url, cacheDir);
      videoPaths.push(localPath);
      downloadedDuration += Math.min(item.duration, maxClipDuration);
      log.info(`Accumulated ${downloadedDuration.toFixed(1)}s / ${totalDuration}s`);
    } catch (err) {
      log.warn(`Failed to download video: ${err instanceof Error ? err.message : err}`);
    }
  }

  log.info(`Downloaded ${videoPaths.length} videos (${downloadedDuration.toFixed(1)}s total)`);
  return videoPaths;
}

// ============ Keyword Extraction ============

/**
 * Chinese → English mapping for common scene keywords.
 * Pexels search works best in English.
 */
const CN_EN_MAP: Record<string, string> = {
  "城市": "city",
  "街道": "street",
  "办公室": "office",
  "夜晚": "night",
  "白天": "daylight",
  "日落": "sunset",
  "日出": "sunrise",
  "雨": "rain",
  "雪": "snow",
  "森林": "forest",
  "海滩": "beach",
  "大海": "ocean",
  "山": "mountain",
  "教室": "classroom",
  "医院": "hospital",
  "餐厅": "restaurant",
  "咖啡厅": "cafe",
  "公园": "park",
  "商场": "shopping mall",
  "火车站": "train station",
  "机场": "airport",
  "家里": "home interior",
  "厨房": "kitchen",
  "卧室": "bedroom",
  "客厅": "living room",
  "走廊": "hallway",
  "电梯": "elevator",
  "楼梯": "stairs",
  "天台": "rooftop",
  "停车场": "parking lot",
  "黑暗": "dark",
  "恐怖": "horror",
  "悬疑": "suspense",
  "浪漫": "romantic",
  "悲伤": "sad",
  "快乐": "happy",
  "战斗": "fight",
  "逃跑": "escape",
  "追逐": "chase",
  "拥抱": "embrace",
  "争吵": "argument",
  "哭泣": "crying",
  "微笑": "smile",
  "愤怒": "angry",
  "恐惧": "fear",
  "惊喜": "surprise",
  "婚礼": "wedding",
  "派对": "party",
  "烟花": "fireworks",
  "星空": "starry sky",
  "月亮": "moon",
  "樱花": "cherry blossom",
  "秋天": "autumn",
  "春天": "spring",
  "冬天": "winter",
  "夏天": "summer",
  "夜晚的城市": "city night",
  "霓虹灯": "neon lights",
  "赛博朋克": "cyberpunk",
  "科幻": "scifi futuristic",
  "动漫": "anime style",
  "水墨": "ink painting",
  "写实的": "realistic",
  "一个人": "person alone",
  "两人对话": "two people talking",
  "人群": "crowd",
  "雨中": "in the rain",
  "窗外": "window view",
  "镜子": "mirror reflection",
  "手机": "smartphone",
  "电脑": "computer screen",
  "开车": "driving car",
  "跑步": "running",
  "走路": "walking",
  "看书": "reading book",
  "做饭": "cooking",
  "喝酒": "drinking wine",
  "弹琴": "playing piano",
  "画画": "painting",
};

/**
 * Extract search keywords from shot visual descriptions.
 * Translates common Chinese terms to English for better Pexels results.
 */
export function extractSearchTerms(visuals: string[], maxTerms = 10): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const visual of visuals) {
    // Try full match first
    if (CN_EN_MAP[visual]) {
      const en = CN_EN_MAP[visual];
      if (!seen.has(en)) {
        seen.add(en);
        terms.push(en);
      }
      continue;
    }

    // Try sub-string matching (longest first)
    const sorted = Object.keys(CN_EN_MAP).sort((a, b) => b.length - a.length);
    let matched = false;
    for (const cn of sorted) {
      if (visual.includes(cn)) {
        const en = CN_EN_MAP[cn];
        if (!seen.has(en)) {
          seen.add(en);
          terms.push(en);
        }
        matched = true;
        break;
      }
    }

    // If no Chinese match, try using as-is (might be English)
    if (!matched) {
      const cleaned = visual
        .replace(/[，。！？、；：""''（）【】]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 1 && w.length <= 30);

      for (const word of cleaned) {
        if (!seen.has(word.toLowerCase()) && terms.length < maxTerms) {
          seen.add(word.toLowerCase());
          terms.push(word);
        }
      }
    }

    if (terms.length >= maxTerms) break;
  }

  return terms.slice(0, maxTerms);
}

/**
 * Extract search terms from Shot[] array directly.
 */
export function extractSearchTermsFromShots(shots: { visual: string }[]): string[] {
  return extractSearchTerms(shots.map((s) => s.visual));
}
