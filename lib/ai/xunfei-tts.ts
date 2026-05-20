import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "@/lib/logger";

const log = createLogger("xunfei-tts");

// ============ Config ============

const XUNFEI_APPID = process.env.XUNFEI_APPID || "";
const XUNFEI_API_KEY = process.env.XUNFEI_API_KEY || "";
const XUNFEI_API_SECRET = process.env.XUNFEI_API_SECRET || "";

const TTS_HOST = "tts-api.xfyun.cn";
const TTS_PATH = "/v2/tts";

export function isXunfeiConfigured(): boolean {
  return !!(XUNFEI_APPID && XUNFEI_API_KEY && XUNFEI_API_SECRET);
}

// ============ Voice mapping (iFlytek vcn → role label) ============

/** iFlytek voice names. Browse: https://www.xfyun.cn/services/online_tts */
export const XUNFEI_VOICES = {
  // Female voices
  "x4_xiaoyan": "讯飞小燕（女声-通用）",
  "x4_xiaorui": "讯飞小瑞（女声-温柔）",
  "x4_xiaoshuang": "讯飞小爽（女声-甜妹）",
  "xiaoyan": "小燕（女声-经典）",
  "aisjiuxu": "许久（女声-知性）",
  "aisxping": "小萍（女声-亲切）",
  "aisjinger": "小婧（女声-文艺）",
  "aisbabyxu": "许小宝（童声-女）",
  // Male voices
  "x4_lingling": "讯飞玲玲（男声-通用）",
  "x4_yezhi": "讯飞叶知（男声-沉稳）",
  "aisjiuxu_m": "许久（男声-知性）",
  "aisxping_m": "小萍（男声-亲切）",
  "aisbabyxu_m": "许小宝（童声-男）",
  // Narration
  "x4_yezi": "讯飞叶子（旁白）",
} as const;

/** Default voices for different roles */
export const XUNFEI_DEFAULTS = {
  "女声-年轻": "x4_xiaorui",
  "女声-中年": "x4_xiaoyan",
  "男声-年轻": "x4_lingling",
  "男声-中年": "x4_yezhi",
  "旁白": "x4_yezi",
} as const;

/** Map Edge-TTS voiceId to iFlytek vcn */
export function mapVoiceId(edgeVoiceId: string): string {
  // Map common Edge-TTS IDs to iFlytek voices
  const mapping: Record<string, string> = {
    "zh-CN-XiaoxiaoNeural": XUNFEI_DEFAULTS["女声-年轻"],
    "zh-CN-XiaomengNeural": XUNFEI_DEFAULTS["女声-中年"],
    "zh-CN-YunxiNeural": XUNFEI_DEFAULTS["男声-年轻"],
    "zh-CN-YunjianNeural": XUNFEI_DEFAULTS["男声-中年"],
    "zh-CN-YunyangNeural": XUNFEI_DEFAULTS["旁白"],
  };
  return mapping[edgeVoiceId] || XUNFEI_DEFAULTS["女声-年轻"];
}

// ============ Auth: HMAC-SHA256 signature ============

function generateAuthUrl(): string {
  const date = new Date().toUTCString();

  const signatureOrigin = `host: ${TTS_HOST}\ndate: ${date}\nGET ${TTS_PATH} HTTP/1.1`;
  const signatureSha = crypto
    .createHmac("sha256", XUNFEI_API_SECRET)
    .update(signatureOrigin)
    .digest("base64");

  const authorizationOrigin = `api_key="${XUNFEI_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");

  const url = new URL(`wss://${TTS_HOST}${TTS_PATH}`);
  url.searchParams.set("authorization", authorization);
  url.searchParams.set("date", date);
  url.searchParams.set("host", TTS_HOST);

  return url.toString();
}

// ============ TTS: synthesize text to mp3 file ============

export interface XunfeiTTSResult {
  filePath: string;
  durationSeconds: number;
  text: string;
}

/**
 * Synthesize text to an mp3 file using iFlytek WebSocket TTS.
 * Falls back to Edge-TTS if iFlytek is not configured.
 */
export async function xunfeiTts(
  text: string,
  outputPath: string,
  voice: string = "x4_xiaorui",
  speed: number = 50,
  volume: number = 50,
  pitch: number = 50
): Promise<XunfeiTTSResult> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const authUrl = generateAuthUrl();
  const textBase64 = Buffer.from(text).toString("base64");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(authUrl);
    const audioChunks: Buffer[] = [];
    let completed = false;

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        ws.terminate();
        reject(new Error("讯飞TTS超时（30秒）"));
      }
    }, 30000);

    ws.on("open", () => {
      // Send synthesis request
      const request = {
        common: { app_id: XUNFEI_APPID },
        business: {
          aue: "lame", // mp3
          sfl: 1,      // stream mp3
          auf: "audio/L16;rate=16000",
          vcn: voice,
          speed,
          volume,
          pitch,
          tte: "UTF8",
        },
        data: {
          status: 2, // all text at once
          text: textBase64,
        },
      };
      ws.send(JSON.stringify(request));
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.code !== 0) {
          clearTimeout(timeout);
          completed = true;
          ws.terminate();
          reject(new Error(`讯飞TTS错误 code=${msg.code}: ${msg.message}`));
          return;
        }

        if (msg.data && msg.data.audio) {
          audioChunks.push(Buffer.from(msg.data.audio, "base64"));
        }

        if (msg.data && msg.data.status === 2) {
          // Synthesis complete
          clearTimeout(timeout);
          completed = true;

          const fullAudio = Buffer.concat(audioChunks);

          fs.writeFile(outputPath, fullAudio)
            .then(async () => {
              const duration = await getAudioDurationFromFile(outputPath, text.length);
              resolve({
                filePath: outputPath,
                durationSeconds: duration,
                text,
              });
            })
            .catch((err) => {
              reject(new Error(`写入音频文件失败: ${err.message}`));
            })
            .finally(() => ws.close());
        }
      } catch (err) {
        // Parse error — ignore, wait for more frames
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      if (!completed) {
        completed = true;
        reject(new Error(`讯飞TTS WebSocket错误: ${err.message}`));
      }
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

// ============ Helpers ============

async function getAudioDurationFromFile(
  filePath: string,
  textLength: number
): Promise<number> {
  try {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return Math.ceil(parseFloat(stdout.trim()) * 10) / 10 || 3;
  } catch {
    return Math.max(3, Math.ceil(textLength / 4));
  }
}
