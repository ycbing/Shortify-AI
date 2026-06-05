// @ts-nocheck
import { createLogger } from "@/lib/logger";
import { createHmac, createHash } from "crypto";
import WebSocket from "ws";
import fs from "fs/promises";
import path from "path";

const log = createLogger("xunfei-asr");

const XUNFEI_APPID = process.env.XUNFEI_APPID || "";
const XUNFEI_API_KEY = process.env.XUNFEI_API_KEY || "";
const XUNFEI_API_SECRET = process.env.XUNFEI_API_SECRET || "";

// 讯飞实时语音转写 WebSocket API
const ASR_URL_BASE = "wss://iat-api.xfyun.cn/v2/iat";
const ASR_HOST = "iat-api.xfyun.cn";

interface XunfeiASRResult {
  text: string;
  segments: {
    startMs: number;
    endMs: number;
    text: string;
  }[];
  duration: number;
}

/**
 * 讯飞语音听写 ASR
 * WebSocket 流式识别，支持中文、英文等多种语言
 * 优势：中文识别效果顶级，国内访问稳定
 * 
 * @param audioFilePath 音频文件路径（支持 mp3/wav/pcm）
 * @param options 配置选项
 */
export async function transcribeWithXunfei(
  audioFilePath: string,
  options?: {
    language?: string;   // "zh_cn" | "en_us"，默认 "zh_cn"
    ptt?: number;        // 标点符号 0-2，1=添加
    pd?: string;         // 领域 "general" | "finance" | "medicine" 等
  }
): Promise<XunfeiASRResult> {
  if (!XUNFEI_APPID || !XUNFEI_API_KEY || !XUNFEI_API_SECRET) {
    throw new Error(
      "讯飞 ASR 未配置。请设置 XUNFEI_APPID, XUNFEI_API_KEY, XUNFEI_API_SECRET。"
    );
  }

  const language = options?.language || "zh_cn";
  const ptt = options?.ptt ?? 1;
  const pd = options?.pd || "general";

  // Read audio file
  const audioBuffer = await fs.readFile(audioFilePath);
  const ext = path.extname(audioFilePath).toLowerCase();

  // Convert to PCM 16kHz 16bit mono if needed (讯飞 ASR 要求)
  const pcmBuffer = await convertToPCM16(audioBuffer, ext);

  log.info("Starting Xunfei ASR transcription", {
    appId: XUNFEI_APPID.substring(0, 4) + "***",
    language,
    fileSize: `${pcmBuffer.length / 1024}KB`,
    duration: `${(pcmBuffer.length / 32000).toFixed(1)}s (estimated)`,
  });

  // Generate auth URL
  const wsUrl = generateAuthUrl(ASR_URL_BASE, ASR_HOST, XUNFEI_API_SECRET);

  // Send audio in chunks via WebSocket
  const result = await new Promise<XunfeiASRResult>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let allText = "";
    let startTime: number | null = null;
    let endTime: number | null = null;
    const segments: { startMs: number; endMs: number; text: string }[] = [];

    ws.on("open", () => {
      // Send parameters
      const params = JSON.stringify({
        common: { app_id: XUNFEI_APPID },
        business: {
          language,
          domain: pd,
          accent: "mandarin",
          vad_eos: 5000,     // 静音检测超时 5s
          dwa: "wbs",        // 动态修正
          ptt: ptt,
        },
        data: {
          status: 0,         // First frame
          format: "audio/L16;rate=16000",
          encoding: "raw",
          audio: pcmBuffer.slice(0, 1280).toString("base64"),
        },
      });
      ws.send(params);

      // Send remaining audio in chunks (1280 bytes = 80ms at 16kHz 16bit)
      let offset = 1280;
      const chunkSize = 1280;
      const intervalMs = 40; // ~80ms of audio, send every 40ms

      const sendChunk = () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (offset < pcmBuffer.length) {
          const end = Math.min(offset + chunkSize, pcmBuffer.length);
          const chunk = pcmBuffer.slice(offset, end);
          const isLast = end >= pcmBuffer.length;

          const frame = JSON.stringify({
            data: {
              status: isLast ? 2 : 1,
              format: "audio/L16;rate=16000",
              encoding: "raw",
              audio: chunk.toString("base64"),
            },
          });
          ws.send(frame);

          offset = end;

          if (!isLast) {
            setTimeout(sendChunk, intervalMs);
          }
        }
      };

      setTimeout(sendChunk, intervalMs);
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        const code = msg.code;

        if (code !== 0) {
          log.error("Xunfei ASR error", { code, message: msg.message });
          return;
        }

        const resultData = msg.data?.result;
        if (!resultData) return;

        // Parse words array from xunfei response
        // Each item has bg (start time ms) and cw (chars) array
        const wordItems = resultData.ws || [];
        if (wordItems.length > 0) {
          for (const item of wordItems) {
            if (!item.cw) continue;
            const itemText = item.cw.map(c => c.w).join("");
            if (itemText.trim()) {
              const bg = item.bg || 0;
              // End time is next item's bg, or estimated from text length
              segments.push({
                startMs: bg,
                endMs: bg + 1000,
                text: itemText,
              });
            }
          }
          // Collect full text from ws
          const fullText = wordItems.map(w => (w.cw || []).map(c => c.w).join("")).join("");
          if (fullText) {
            allText = fullText;
          }
        } else if (resultData.rg) {
          // rg (result global) is the final normalized result
          const rgWords = resultData.rg[0]?.ws || [];
          const fullText = rgWords.map(w => (w.cw || []).map(c => c.w).join("")).join("");
          if (fullText) allText = fullText;
        }

        // Update end time for last segment using current data
        const ed = resultData.ed || 0;
        if (ed > 0 && segments.length > 0) {
          segments[segments.length - 1].endMs = ed;
        }

        // Check if recognition is complete
        if (msg.data?.status === 2) {
          endTime = Date.now();
        }
      } catch (err) {
        log.warn("Failed to parse ASR message", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ws.on("error", (err) => {
      log.error("Xunfei ASR WebSocket error", {
        error: err.message,
      });
      reject(new Error(`讯飞 ASR WebSocket 错误: ${err.message}`));
    });

    ws.on("close", (code, reason) => {
      log.info("Xunfei ASR WebSocket closed", { code, reason: reason.toString() });
      const durationSec = pcmBuffer.length / 32000;
      resolve({
        text: allText.trim(),
        segments,
        duration: durationSec,
      });
    });

    // Timeout: audio duration + 5s buffer
    const estimatedDuration = (pcmBuffer.length / 32000) * 1000 + 10000;
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, estimatedDuration);
  });

  log.info("Xunfei ASR transcription complete", {
    textLength: result.text.length,
    segmentCount: result.segments.length,
  });

  return result;
}

/**
 * Convert audio to PCM 16kHz 16bit mono using ffmpeg
 */
async function convertToPCM16(
  audioBuffer: Buffer,
  inputExt: string
): Promise<Buffer> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const tmpInput = `/tmp/xunfei-asr-input${inputExt}`;
  const tmpOutput = "/tmp/xunfei-asr-output.pcm";

  try {
    await fs.writeFile(tmpInput, audioBuffer);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i", tmpInput,
      "-f", "s16le",
      "-ar", "16000",
      "-ac", "1",
      tmpOutput,
    ], { timeout: 30000 });

    const pcmBuffer = await fs.readFile(tmpOutput);
    return pcmBuffer;
  } finally {
    await fs.unlink(tmpInput).catch(() => {});
    await fs.unlink(tmpOutput).catch(() => {});
  }
}

/**
 * Generate HMAC-SHA256 authentication URL for Xunfei WebSocket
 */
function generateAuthUrl(
  baseUrl: string,
  host: string,
  apiSecret: string
): string {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${new URL(baseUrl).pathname} HTTP/1.1`;

  const signatureSha = createHmac("sha256", apiSecret)
    .update(signatureOrigin)
    .digest("base64");

  const authorization = buildAuthorization(signatureSha);

  const params = new URLSearchParams({
    authorization,
    date,
    host,
  });

  return `${baseUrl}?${params.toString()}`;
}

function buildAuthorization(signatureSha: string): string {
  const authorizationOrigin = `api_key="${XUNFEI_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
  return Buffer.from(authorizationOrigin).toString("base64");
}

/**
 * Check if Xunfei ASR is configured
 */
export function isXunfeiAsrConfigured(): boolean {
  return !!(XUNFEI_APPID && XUNFEI_API_KEY && XUNFEI_API_SECRET);
}
