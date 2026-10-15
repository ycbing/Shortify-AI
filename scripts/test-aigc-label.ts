/**
 * AI 生成合成内容标识 冒烟测试（纯逻辑，不需要 API Key / ffmpeg）
 *
 * 用法: npx tsx scripts/test-aigc-label.ts
 *
 * 覆盖「合规标识」里最容易静默出错、且出事时无法在成片里看出来的部分：
 *   1. 隐式标识：元数据键名必须包含 AIGC，且覆盖规范要求的四类信息
 *   2. 显式标识：drawtext 滤镜拼装（角位、按比例字号、路径/文案转义）
 *   3. shell 注入面：滤镜与元数据参数不得带出可逃逸引号的字符
 *   4. 配置解析与母版哈希
 */
import os from "os";
import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";
import {
  AIGC_LABEL_VERSION,
  AIGC_MOVFLAGS,
  LATIN_FALLBACK_TEXT,
  buildAigcMetadata,
  buildDrawtextFilter,
  buildMetadataArgs,
  episodeContentId,
  fontLikelySupportsCjk,
  getAigcLabelConfig,
  mergedContentId,
  resolveLabelFont,
  sha256File,
} from "@/lib/ai/aigc-label";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  // ============ 1. 隐式标识：元数据 ============
  section("1. 隐式标识（AIGC_* 元数据）");

  process.env.AIGC_SERVICE_PROVIDER = "Shortify AI";
  const meta = buildAigcMetadata({
    contentId: episodeContentId("drama-123", 2),
    hash: "a".repeat(64),
  });

  const keys = Object.keys(meta);
  check(
    "所有元数据键名都包含 AIGC 标识符",
    keys.every((k) => k.startsWith("AIGC")),
    keys.join(", ")
  );
  check("含生成合成确认状态", Boolean(meta.AIGC_GenerateState));
  check("含服务提供方", meta.AIGC_ServiceProvider === "Shortify AI");
  check("含内容唯一编号", meta.AIGC_ContentId === "AIGC-drama-123-E2");
  check("含哈希与算法标识", meta.AIGC_Hash === "a".repeat(64) && meta.AIGC_HashAlgorithm === "sha256");
  check("含标识版本", meta.AIGC_LabelVersion === AIGC_LABEL_VERSION);
  check("含生成时间（ISO 格式）", !Number.isNaN(Date.parse(meta.AIGC_CreatedAt)));

  check("单集编号格式", episodeContentId("d1", 10) === "AIGC-d1-E10");
  check("合集成片编号格式", mergedContentId("d1") === "AIGC-d1-FULL");

  const metaArgs = buildMetadataArgs(meta);
  check("元数据参数包含 -metadata", metaArgs.includes("-metadata AIGC_ContentId="));
  check(
    "元数据值以单引号包裹",
    /-metadata AIGC_ContentId='AIGC-drama-123-E2'/.test(metaArgs)
  );
  check("movflags 同时启用 faststart 与自定义元数据标签", AIGC_MOVFLAGS === "+faststart+use_metadata_tags");

  // 注入面：用真实 shell 解析转义后的参数，验证能否往返还原（比数引号更可靠）
  const evilValue = "a'; rm -rf /; #$(whoami)`id`";
  const evilArgs = buildMetadataArgs({ AIGC_X: evilValue });
  const evilArg = evilArgs.slice("-metadata AIGC_X=".length);
  const roundTripped = execSync(`printf '%s' ${evilArg}`, { encoding: "utf8" });
  check(
    "元数据值经 shell 解析可往返还原（转义正确且无命令替换）",
    roundTripped === evilValue,
    `期望 ${JSON.stringify(evilValue)}，实际 ${JSON.stringify(roundTripped)}`
  );
  check("元数据参数不含可逃逸的换行", !/[\r\n]/.test(evilArgs));

  // ============ 2. 显式标识：drawtext ============
  section("2. 显式标识（drawtext 烧录）");

  const baseParams = {
    textFilePath: "/tmp/label.txt",
    videoHeight: 1080,
    fontFile: "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    fontScale: 0.032,
    marginScale: 0.03,
    opacity: 0.85,
  };

  const topRight = buildDrawtextFilter({ ...baseParams, position: "top-right" });
  check("top-right：x 靠右、y 靠上", topRight.includes("x=w-tw-32") && topRight.includes("y=32"));
  check("带 fontfile 时输出 fontfile 参数", topRight.includes("fontfile='"));
  check("字号按视频高度换算（1080 × 0.032 ≈ 35）", topRight.includes("fontsize=35"));
  check("使用 textfile 而非内联文案（避免文案被滤镜语法解释）", topRight.includes("textfile='"));
  check("带半透明底衬（保证弱背景也可辨识）", topRight.includes("box=1") && topRight.includes("boxcolor=black@"));

  const bottomLeft = buildDrawtextFilter({ ...baseParams, position: "bottom-left" });
  check("bottom-left：x 靠左、y 靠下", bottomLeft.includes("x=32") && bottomLeft.includes("y=h-th-32"));

  const noFont = buildDrawtextFilter({ ...baseParams, fontFile: null, position: "top-left" });
  check("字体缺失时不输出 fontfile（回退 fontconfig 默认）", !noFont.includes("fontfile="));

  const vertical = buildDrawtextFilter({ ...baseParams, position: "top-right", videoHeight: 1920 });
  check("竖屏按 1920 高换算字号（更大）", vertical.includes("fontsize=61"));

  // ============ 3. shell 注入面 ============
  section("3. shell 注入面（滤镜整体处于 -vf \"...\" 内）");

  const tricky = buildDrawtextFilter({
    ...baseParams,
    position: "top-right",
    textFilePath: '/tmp/ev"il`$(whoami)`.txt',
    fontFile: '/tmp/f"ont;rm -rf /',
  });
  check("滤镜中不含未转义的双引号", !tricky.includes('"'));
  check(
    "路径中的命令替换字符（$ ` ; 引号）已被剔除",
    !/[$`;"]/.test(tricky) && tricky.includes("/tmp/fontrm -rf /"),
    tricky.slice(0, 90)
  );
  check("路径中的冒号被转义（ffmpeg 选项分隔符）", buildDrawtextFilter({ ...baseParams, position: "top-right", textFilePath: "/a:b/c.txt" }).includes("/a\\:b/c.txt"));

  // 滤镜实际处于 `-vf "..."` 内：用真实 shell 验证不会被截断或发生命令替换
  const shellParsed = execSync(`printf '%s' "${tricky}"`, { encoding: "utf8" });
  check(
    "滤镜在 -vf 双引号中可原样往返（无截断/无命令替换）",
    shellParsed === tricky,
    `实际 ${JSON.stringify(shellParsed.slice(0, 120))}`
  );

  // ============ 4. 配置与哈希 ============
  section("4. 配置解析与母版哈希");

  delete process.env.AIGC_LABEL_ENABLED;
  delete process.env.AIGC_LABEL_VISIBLE;
  delete process.env.AIGC_LABEL_TEXT;
  delete process.env.AIGC_LABEL_POSITION;
  const defaults = getAigcLabelConfig();
  check("默认开启（合规默认值）", defaults.enabled === true);
  check("默认烧录可见标识", defaults.visible === true);
  check("默认文案为「AI 生成」", defaults.text === "AI 生成");
  check("默认角位 top-right（避开底部字幕）", defaults.position === "top-right");

  process.env.AIGC_LABEL_ENABLED = "false";
  process.env.AIGC_LABEL_POSITION = "middle-center";
  const overridden = getAigcLabelConfig();
  check("显式关闭生效", overridden.enabled === false);
  check("非法角位回退到 top-right", overridden.position === "top-right");
  delete process.env.AIGC_LABEL_ENABLED;
  delete process.env.AIGC_LABEL_POSITION;

  const tmpFile = path.join(os.tmpdir(), `aigc-test-${Date.now()}.bin`);
  await fs.writeFile(tmpFile, "hello-aigc");
  const hash = await sha256File(tmpFile);
  check(
    "sha256 流式计算结果正确",
    hash === "af17a694a3e7f5616176823ee5ca15fa55135558bf2e6054ab2b634ce087e984",
    hash
  );
  await fs.rm(tmpFile, { force: true });

  // ============ 5. 字体探测与方块字防护 ============
  section("5. 字体探测与方块字防护（上线最常见的静默失败点）");

  check(
    "alpine 的 Noto CJK 路径被识别为含中文字形",
    fontLikelySupportsCjk("/usr/share/fonts/noto/NotoSansCJK-Regular.ttc") === true
  );
  check(
    "alpine 的 DejaVu 路径被识别为不含中文字形",
    fontLikelySupportsCjk("/usr/share/fonts/dejavu/DejaVuSans.ttf") === false
  );
  check(
    "macOS 苹方被识别为含中文字形",
    fontLikelySupportsCjk("/System/Library/Fonts/PingFang.ttc") === true
  );
  check("拉丁回退文案已定义", LATIN_FALLBACK_TEXT === "AI GENERATED");

  // 指定一个必不存在的字体时应回退到探测（不得抛错）
  const resolvedMissing = await resolveLabelFont("/nonexistent/font.ttf");
  check(
    "指定不存在的字体时不抛错（回退探测）",
    resolvedMissing === null || typeof resolvedMissing === "string",
    String(resolvedMissing)
  );

  console.log(
    failures === 0
      ? "\n✅ 全部通过：元数据字段、drawtext 拼装、注入面加固、配置解析与字体防护均符合预期\n"
      : `\n❌ ${failures} 项失败\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
