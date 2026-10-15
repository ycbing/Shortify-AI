/**
 * 镜头语言冒烟测试（纯逻辑，不需要 API Key / ffmpeg）
 *
 * 用法: npx tsx scripts/test-shot-language.ts
 *
 * 覆盖三件容易出错、且出错后很难在成片里定位的事：
 *   1. 逐镜头转场在「二叉树 pair-wise 合并」中的 junction 映射 —— 必须不漏不重
 *   2. LLM 输出的镜头语言归一化 —— 中文标签/近似词/非法值
 *   3. cameraMove → Ken Burns 运镜映射，以及旧数据（无 cameraMove）的回退
 */
import type { CameraMove, Shot } from "@/types/drama";
import {
  CAMERA_MOVE_OPTIONS,
  normalizeShotLanguage,
  normalizeShotData,
  applyShotUpdates,
} from "@/types/drama";
import { junctionIndexForMerge, resolveKenBurnsEffect, resolveShotTransition } from "@/lib/ai/video-composer";

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

// ============ 1. junction 映射 ============
section("1. 逐镜头转场 → junction 索引映射");

/**
 * 复刻 concatWithXfade 的 pair-wise 合并循环，收集每轮实际用到的 junction 序号。
 */
function collectJunctions(clipCount: number): number[] {
  const collected: number[] = [];
  let remaining = clipCount;
  let pass = 0;
  while (remaining > 1) {
    pass++;
    const nextCount = Math.ceil(remaining / 2);
    for (let i = 0; i < remaining; i += 2) {
      if (i + 1 >= remaining) continue; // 落单顺延，无 junction
      collected.push(junctionIndexForMerge(pass, i));
    }
    remaining = nextCount;
  }
  return collected;
}

for (let n = 2; n <= 12; n++) {
  const junctions = collectJunctions(n).sort((a, b) => a - b);
  const expected = Array.from({ length: n - 1 }, (_, k) => k);
  const ok =
    junctions.length === expected.length &&
    junctions.every((v, idx) => v === expected[idx]);
  check(
    `${n} 个镜头 → junction 覆盖 0..${n - 2} 且无重复`,
    ok,
    ok ? undefined : `实际得到 [${junctions.join(", ")}]`
  );
}

// ============ 2. 转场枚举映射 ============
section("2. Shot.transition → 合成器转场");

check("cut → none（硬切）", resolveShotTransition("cut") === "none");
check("fade → fade", resolveShotTransition("fade") === "fade");
check("fadeblack → fadeblack", resolveShotTransition("fadeblack") === "fadeblack");
check("dissolve → dissolve", resolveShotTransition("dissolve") === "dissolve");
check("circleopen → circleopen", resolveShotTransition("circleopen") === "circleopen");
check("未设置 → undefined（由调用方回退全局转场）", resolveShotTransition(undefined) === undefined);
check("非法值 → undefined", resolveShotTransition("wobble" as never) === undefined);

// ============ 3. 归一化容错 ============
section("3. 镜头语言归一化（LLM 输出容错）");

const normalizeCases: [string, Record<string, unknown>, Record<string, string>][] = [
  ["规范英文 key 原样保留", { shotSize: "close_up", cameraMove: "push_in" }, { shotSize: "close_up", cameraMove: "push_in" }],
  ["中文标签解析", { shotSize: "特写", cameraMove: "推近", lighting: "暖光", cameraAngle: "俯视" }, { shotSize: "close_up", cameraMove: "push_in", lighting: "warm", cameraAngle: "high_angle" }],
  ["「大特写」不被「特写」抢占", { shotSize: "大特写" }, { shotSize: "extreme_close_up" }],
  ["「中近景」归到近景", { shotSize: "中近景" }, { shotSize: "close" }],
  ["连字符/空格写法", { shotSize: "close-up", cameraMove: "push in", cameraAngle: "low angle" }, { shotSize: "close_up", cameraMove: "push_in", cameraAngle: "low_angle" }],
  ["别名表兜底", { cameraAngle: "航拍", cameraMove: "固定", transition: "叠化" }, { cameraAngle: "aerial", cameraMove: "static", transition: "dissolve" }],
  ["中文括注中提取标签", { shotSize: "景别 close_up 特写" }, { shotSize: "close_up" }],
  ["非法值被丢弃", { shotSize: "随便写", cameraMove: 123, lighting: null }, {}],
  ["空串不产生字段", { shotSize: "", cameraMove: "   " }, {}],
];

for (const [name, input, expected] of normalizeCases) {
  const got = normalizeShotLanguage(input);
  const ok =
    Object.keys(got).length === Object.keys(expected).length &&
    Object.entries(expected).every(([k, v]) => (got as Record<string, string>)[k] === v);
  check(name, ok, ok ? undefined : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(got)}`);
}

// ============ 4. 运镜映射与回退 ============
section("4. cameraMove → Ken Burns 运镜");

const expectedEffect: Record<CameraMove, string | null> = {
  static: null,
  push_in: "zoom-in",
  pull_out: "zoom-out",
  pan_left: "pan-left",
  pan_right: "pan-right",
  tilt_up: "pan-up",
  tilt_down: "pan-down",
  follow: "zoom-in-right",
};

for (const move of Object.keys(CAMERA_MOVE_OPTIONS) as CameraMove[]) {
  const shot = { shotNumber: 1, visual: "x", duration: 3, cameraMove: move } as Shot;
  const got = resolveKenBurnsEffect(shot);
  check(`${move} → ${expectedEffect[move] ?? "静止"}`, got === expectedEffect[move], `实际 ${got}`);
}

check(
  "「固定机位」返回 null（走静止分支，不加运动）",
  resolveKenBurnsEffect({ shotNumber: 3, visual: "x", duration: 3, cameraMove: "static" } as Shot) === null
);

// 旧数据：无 cameraMove → 回退到按镜头序号轮换
const legacyEffects = [1, 2, 3, 4].map((n) =>
  resolveKenBurnsEffect({ shotNumber: n, visual: "x", duration: 3 } as Shot)
);
check(
  "旧数据（无 cameraMove）回退到轮换运镜",
  new Set(legacyEffects).size === 4 && legacyEffects.every((e) => e !== null),
  `实际 [${legacyEffects.join(", ")}]`
);

check(
  "非法 cameraMove 同样回退到轮换",
  resolveKenBurnsEffect({ shotNumber: 2, visual: "x", duration: 3, cameraMove: "nope" as never } as Shot) === "pan-right"
);

// ============ 5. 空串=清除 的落库语义 ============
section('5. 空串清除语义（编辑弹窗把「未设置」提交为空串）');

const cleared = applyShotUpdates(
  { shotNumber: 1, visual: "x", duration: 3, shotSize: "close_up", cameraMove: "push_in", emotion: "紧张" } as Shot,
  { shotSize: "", cameraMove: "", emotion: "", visual: "y", lighting: "warm", duration: undefined }
);
check("空串删除 shotSize 键（回退默认运镜）", !("shotSize" in cleared));
check("空串删除 cameraMove 键", !("cameraMove" in cleared));
check("空串删除 emotion 键", !("emotion" in cleared));
check("非空值正常写入", cleared.lighting === "warm");
check("非可清除字段（visual）空串保持原样语义", cleared.visual === "y");
check("duration=undefined 被跳过（保留原值）", cleared.duration === 3);

const sanitized = normalizeShotData([
  { shotNumber: 1, visual: "a", shotSize: "特写", cameraMove: "推近", emotion: "" },
  { shotNumber: 2, visual: "b", shotSize: "非法值", transition: "" },
  { shotNumber: 3, visual: "c", cameraAngle: "low angle", lighting: "暖光" },
]) as Shot[];
check("normalizeShotData：中文标签被归一化", sanitized[0].shotSize === "close_up" && sanitized[0].cameraMove === "push_in");
check("normalizeShotData：空 emotion 被移除", !("emotion" in sanitized[0]));
check("normalizeShotData：非法值被移除", !("shotSize" in sanitized[1]) && !("transition" in sanitized[1]));
check(
  "normalizeShotData：空格写法归一化",
  sanitized[2].cameraAngle === "low_angle" && sanitized[2].lighting === "warm"
);

// ============ 汇总 ============
console.log(
  failures === 0
    ? "\n✅ 全部通过：镜头语言字段、归一化、运镜映射与逐镜头转场 junction 映射均符合预期\n"
    : `\n❌ ${failures} 项失败\n`
);
process.exit(failures === 0 ? 0 : 1);
