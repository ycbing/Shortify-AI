// AI 生成合成内容标识 — 合规实现
//
// 依据《人工智能生成合成内容标识办法》（国家网信办等四部门，2025-09-01 施行）：
//   显式标识：视频/图片应在适当位置添加用户可直接感知的显著提示标识
//   隐式标识：文件元数据中嵌入标识，字段名称必须包含 "AIGC" 标识符号，
//             需涵盖生成合成确认状态、服务提供方、内容唯一编号、数字签名/哈希校验值
//
// 本模块负责把这两类标识落到导出的成片上：
//   - 显式：ffmpeg drawtext 在画面固定角位烧录可见文案（避开底部字幕区）
//   - 隐式：ffmpeg mov muxer 写入 AIGC_* 元数据（需 -movflags +use_metadata_tags）
//   - 附带输出同名 .aigc.json sidecar，便于平台侧溯源与批量核验
//
// 注意：哈希是「未写入元数据的母版」内容哈希。文件内元数据无法包含自身字节的哈希
// （先有鸡还是先有蛋），因此这里记录母版哈希 + 算法标识，sidecar 中同时记录
// 标识后文件的哈希，便于校验链路完整性。

import { exec } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { createReadStream } from "fs";
import path from "path";
import fs from "fs/promises";
import { createLogger } from "@/lib/logger";

const log = createLogger("aigc-label");

const execAsync = promisify(exec);

/** 标识格式版本，便于后续演进与核验 */
export const AIGC_LABEL_VERSION = "1";

/** 元数据字段前缀（规范要求字段名包含 AIGC 标识符号） */
const META_PREFIX = "AIGC";

export type AigcLabelPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export interface AigcLabelConfig {
  /** 总开关（默认开启：面向公众提供生成服务时属于强制要求） */
  enabled: boolean;
  /** 是否烧录可见标识（关闭后仅写隐式元数据） */
  visible: boolean;
  /** 可见标识文案 */
  text: string;
  /** 角位，默认右上角（避开底部字幕） */
  position: AigcLabelPosition;
  /** 生成服务提供方名称 */
  serviceProvider: string;
  /** 字体文件路径，未配置时按候选列表探测 */
  fontFile?: string;
  /** 字号占视频高度的比例 */
  fontScale: number;
  /** 边距占视频高度的比例 */
  marginScale: number;
  /** 文案不透明度 0-1 */
  opacity: number;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "on", "yes"].includes(raw.toLowerCase());
}

function envNumber(name: string, defaultValue: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

export function getAigcLabelConfig(): AigcLabelConfig {
  const position = (process.env.AIGC_LABEL_POSITION || "top-right").toLowerCase();
  const allowedPositions: AigcLabelPosition[] = [
    "top-right",
    "top-left",
    "bottom-right",
    "bottom-left",
  ];
  return {
    enabled: envFlag("AIGC_LABEL_ENABLED", true),
    visible: envFlag("AIGC_LABEL_VISIBLE", true),
    text: process.env.AIGC_LABEL_TEXT || "AI 生成",
    position: allowedPositions.includes(position as AigcLabelPosition)
      ? (position as AigcLabelPosition)
      : "top-right",
    serviceProvider: process.env.AIGC_SERVICE_PROVIDER || "Shortify AI",
    fontFile: process.env.AIGC_LABEL_FONT || undefined,
    fontScale: envNumber("AIGC_LABEL_FONT_SCALE", 0.032),
    marginScale: envNumber("AIGC_LABEL_MARGIN_SCALE", 0.03),
    opacity: Number(process.env.AIGC_LABEL_OPACITY) || 0.85,
  };
}

/**
 * 候选字体路径。容器（alpine）路径已按官方包实际安装位置核对：
 *   font-noto-cjk → /usr/share/fonts/noto/NotoSansCJK-Regular.ttc
 *   font-dejavu   → /usr/share/fonts/dejavu/DejaVuSans.ttf
 * 其余为 Debian/Ubuntu、macOS 本地开发的回退路径。
 */
const FONT_CANDIDATES = [
  // alpine（Dockerfile 安装）
  "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto/NotoSansCJK-Bold.ttc",
  // Debian / Ubuntu
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  // alpine / Debian 的 DejaVu（无中文字形，仅作最后兜底）
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  // macOS 本地开发
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
];

/** 含中文（或日韩）字形的字体特征；用于判断能否安全渲染中文标识文案 */
const CJK_FONT_HINTS = [
  "noto",
  "cjk",
  "wqy",
  "pingfang",
  "arial unicode",
  "sourcehan",
  "source han",
  "songti",
  "heiti",
  "msyh",
  "simhei",
];

/** 中文文案在不含中文字形的字体下会渲染成方块，此时回退为该拉丁文案 */
export const LATIN_FALLBACK_TEXT = "AI GENERATED";

/** 判断字体是否大概率含中文字形（仅按文件名启发式，避免上线出现方块字） */
export function fontLikelySupportsCjk(fontPath: string): boolean {
  const lower = fontPath.toLowerCase();
  return CJK_FONT_HINTS.some((hint) => lower.includes(hint));
}

/** 探测可用字体，找不到返回 null（调用方回退为依赖 fontconfig 默认字体） */
export async function resolveLabelFont(
  configured?: string
): Promise<string | null> {
  const candidates = [configured, ...FONT_CANDIDATES].filter(
    (p): p is string => Boolean(p)
  );
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 继续探测
    }
  }
  return null;
}

// ============ 唯一编号 ============

/** 单集成片的内容唯一编号 */
export function episodeContentId(dramaId: string, episodeNumber: number): string {
  return `AIGC-${dramaId}-E${episodeNumber}`;
}

/** 合集成片的内容唯一编号 */
export function mergedContentId(dramaId: string): string {
  return `AIGC-${dramaId}-FULL`;
}

// ============ 哈希 ============

/** 流式计算文件 SHA-256（大文件不占内存） */
export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// ============ 隐式标识（元数据） ============

export interface AigcMetadataInput {
  contentId: string;
  /** 生成合成确认状态，默认表明由 AI 生成合成 */
  generateState?: string;
  /** 母版内容哈希（写入元数据前的文件） */
  hash?: string;
  serviceProvider?: string;
}

/**
 * 生成写入 mp4 的 AIGC_* 元数据键值。
 * 键名统一以 AIGC 前缀，满足「字段名称必须包含 AIGC 标识符号」。
 */
export function buildAigcMetadata(
  input: AigcMetadataInput
): Record<string, string> {
  const config = getAigcLabelConfig();
  const meta: Record<string, string> = {
    [`${META_PREFIX}`]: "1",
    [`${META_PREFIX}_LabelVersion`]: AIGC_LABEL_VERSION,
    [`${META_PREFIX}_GenerateState`]: input.generateState || "AI-generated",
    [`${META_PREFIX}_ServiceProvider`]:
      input.serviceProvider || config.serviceProvider,
    [`${META_PREFIX}_ContentId`]: input.contentId,
    [`${META_PREFIX}_CreatedAt`]: new Date().toISOString(),
  };
  if (input.hash) {
    meta[`${META_PREFIX}_Hash`] = input.hash;
    meta[`${META_PREFIX}_HashAlgorithm`] = "sha256";
    meta[`${META_PREFIX}_HashScope`] = "pre-label-master";
  }
  return meta;
}

/** 元数据 → ffmpeg -metadata 参数（附带 use_metadata_tags 所需的 movflags） */
export function buildMetadataArgs(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([key, value]) => `-metadata ${key}=${shellSafe(value)}`)
    .join(" ");
}

/** movflags：faststart 便于在线播放，use_metadata_tags 才允许写入自定义键 */
export const AIGC_MOVFLAGS = "+faststart+use_metadata_tags";

// ============ 显式标识（画面烧录） ============

/** 允许的文案字符：中英文数字与常见标点，剔除会破坏 ffmpeg/shell 的字符 */
function sanitizeLabelText(text: string): string {
  return text.replace(/[^\p{Script=Han}\p{L}\p{N} 　·.。\-_()（）]/gu, "").trim();
}

/** 单引号包裹的 shell 参数转义（剔除换行等控制字符） */
function shellSafe(value: string): string {
  const cleaned = value.replace(/[\r\n\t]/g, " ").trim();
  return `'${cleaned.replace(/'/g, "'\\''")}'`;
}

/**
 * ffmpeg 滤镜内的路径转义。
 * 滤镜整体是 `-vf "..."` 形式，因此先剔除可逃逸 shell 双引号的字符，
 * 再处理 ffmpeg 自己的 `\` 与 `:` 语义。
 */
function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/["`$;&|<>()\r\n\t]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

/** 角位 → drawtext 的 x/y 表达式（w/h 为视频宽高，tw/th 为文字宽高） */
function positionExpr(
  position: AigcLabelPosition,
  margin: number
): { x: string; y: string } {
  switch (position) {
    case "top-left":
      return { x: `${margin}`, y: `${margin}` };
    case "bottom-left":
      return { x: `${margin}`, y: `h-th-${margin}` };
    case "bottom-right":
      return { x: `w-tw-${margin}`, y: `h-th-${margin}` };
    case "top-right":
    default:
      return { x: `w-tw-${margin}`, y: `${margin}` };
  }
}

/**
 * 构造 drawtext 滤镜。
 * 文案通过 textfile 传入而不是内联，避免文案内容被 ffmpeg 滤镜语法或 shell 解释。
 */
export function buildDrawtextFilter(params: {
  textFilePath: string;
  videoHeight: number;
  fontFile: string | null;
  position: AigcLabelPosition;
  fontScale: number;
  marginScale: number;
  opacity: number;
}): string {
  const fontSize = Math.max(14, Math.round(params.videoHeight * params.fontScale));
  const margin = Math.max(8, Math.round(params.videoHeight * params.marginScale));
  const { x, y } = positionExpr(params.position, margin);
  const fontPart = params.fontFile
    ? `fontfile='${escapeFilterPath(params.fontFile)}':`
    : "";
  return (
    `drawtext=${fontPart}textfile='${escapeFilterPath(params.textFilePath)}':` +
    `fontsize=${fontSize}:fontcolor=white@${params.opacity}:` +
    `box=1:boxcolor=black@0.35:boxborderw=${Math.round(fontSize * 0.35)}:` +
    `x=${x}:y=${y}`
  );
}

// ============ 统一入口 ============

export interface ApplyAigcLabelOptions {
  /** 待标识的成片路径（会被原地替换） */
  inputPath: string;
  /** 内容唯一编号 */
  contentId: string;
  /** 生成合成确认状态 */
  generateState?: string;
  /** 视频高度（用于按比例计算字号/边距），默认 1080 */
  videoHeight?: number;
  /** 是否尝试烧录可见标识（受配置 visible 约束） */
  allowVisible?: boolean;
}

export interface ApplyAigcLabelResult {
  applied: boolean;
  visibleBurned: boolean;
  metadata: Record<string, string>;
  sidecarPath?: string;
  masterHash?: string;
}

/**
 * 对成片施加显式 + 隐式标识（原地覆盖 inputPath）。
 *
 * - 关闭标识时直接返回 { applied: false }
 * - 字体缺失或 drawtext 失败时降级为「仅元数据」，并记录 error 日志（不静默）
 * - 无论显式标识是否成功，隐式元数据都会尽力写入
 */
export async function applyAigcLabel(
  options: ApplyAigcLabelOptions
): Promise<ApplyAigcLabelResult> {
  const config = getAigcLabelConfig();
  if (!config.enabled) {
    return { applied: false, visibleBurned: false, metadata: {} };
  }

  const { inputPath, contentId } = options;
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const tempPath = path.join(dir, `${base}.aigc-tmp.mp4`);
  const textFilePath = path.join(dir, `${base}.aigc-label.txt`);

  // 母版哈希：标识前的内容指纹
  let masterHash: string | undefined;
  try {
    masterHash = await sha256File(inputPath);
  } catch (err) {
    log.warn("计算母版哈希失败，元数据将不含哈希", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const metadata = buildAigcMetadata({
    contentId,
    generateState: options.generateState,
    hash: masterHash,
  });
  const metadataArgs = buildMetadataArgs(metadata);

  const wantVisible = config.visible && options.allowVisible !== false;
  let visibleBurned = false;

  if (wantVisible) {
    let text = sanitizeLabelText(config.text) || "AI 生成";
    const fontFile = await resolveLabelFont(config.fontFile);

    // 字体不含中文字形时中文会渲染成方块，比没有标识更糟：换拉丁文案保证可读
    if (fontFile && !fontLikelySupportsCjk(fontFile) && /\p{Script=Han}/u.test(text)) {
      log.warn("探测到的字体可能不含中文字形，标识文案回退为拉丁文（建议安装 font-noto-cjk 或设 AIGC_LABEL_FONT）", {
        fontFile,
        originalText: text,
      });
      text = LATIN_FALLBACK_TEXT;
    }

    try {
      await fs.writeFile(textFilePath, text, "utf8");
      const filter = buildDrawtextFilter({
        textFilePath,
        videoHeight: options.videoHeight || 1080,
        fontFile,
        position: config.position,
        fontScale: config.fontScale,
        marginScale: config.marginScale,
        opacity: config.opacity,
      });
      // 重新编码视频以烧录标识；音频直接 copy
      const cmd =
        `ffmpeg -y -i "${inputPath}" -vf "${filter}" ` +
        `-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy ` +
        `-movflags ${AIGC_MOVFLAGS} ${metadataArgs} "${tempPath}"`;
      await execAsync(cmd, { timeout: 600000 });
      await fs.rename(tempPath, inputPath);
      visibleBurned = true;
      log.info("AI 标识已烧录", {
        contentId,
        position: config.position,
        font: fontFile || "(fontconfig default)",
      });
    } catch (err) {
      log.error(
        "显式 AI 标识烧录失败，降级为仅写隐式元数据（请检查容器是否安装中文字体，可设 AIGC_LABEL_FONT）",
        { contentId, error: err instanceof Error ? err.message : String(err) }
      );
      await fs.rm(tempPath, { force: true }).catch(() => {});
    } finally {
      await fs.rm(textFilePath, { force: true }).catch(() => {});
    }
  }

  // 隐式标识：显式成功时已在同一条命令写入；否则单独补写（无需重新编码）
  if (!visibleBurned) {
    try {
      const cmd =
        `ffmpeg -y -i "${inputPath}" -c copy ` +
        `-movflags ${AIGC_MOVFLAGS} ${metadataArgs} "${tempPath}"`;
      await execAsync(cmd, { timeout: 300000 });
      await fs.rename(tempPath, inputPath);
    } catch (err) {
      log.error("隐式 AIGC 元数据写入失败", {
        contentId,
        error: err instanceof Error ? err.message : String(err),
      });
      await fs.rm(tempPath, { force: true }).catch(() => {});
      return { applied: false, visibleBurned: false, metadata, masterHash };
    }
  }

  // sidecar：记录标识后文件哈希，便于核验链路完整性
  let sidecarPath: string | undefined;
  try {
    const finalHash = await sha256File(inputPath);
    const sidecar = {
      labelVersion: AIGC_LABEL_VERSION,
      contentId,
      generateState: metadata[`${META_PREFIX}_GenerateState`],
      serviceProvider: metadata[`${META_PREFIX}_ServiceProvider`],
      explicitLabel: visibleBurned
        ? { text: config.text, position: config.position }
        : { text: null, position: null, note: "visible label disabled or failed" },
      masterHash: masterHash || null,
      labeledFileHash: finalHash,
      hashAlgorithm: "sha256",
      createdAt: metadata[`${META_PREFIX}_CreatedAt`],
    };
    sidecarPath = path.join(dir, `${base}.aigc.json`);
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2), "utf8");
  } catch (err) {
    log.warn("写入 AIGC sidecar 失败（不影响成片）", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    applied: true,
    visibleBurned,
    metadata,
    sidecarPath,
    masterHash,
  };
}
