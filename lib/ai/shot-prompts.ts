// 分镜 prompt 组装与角色引用构建（storyboard 路由与单镜头重跑共用）
import type {
  Shot,
  Character,
  ShotSize,
  CameraAngle,
  CameraMove,
  LightingType,
} from "@/types/drama";

/**
 * Build appearance-enriched prompt for a shot.
 * If the shot references a character and that character has an appearance,
 * prepend the appearance description to the visual prompt.
 */
export function buildAppearancePrompt(
  shot: Shot,
  characters: Character[]
): string {
  if (!shot.visual) return shot.visual || "";

  // Find character appearances to include
  const referencedCharacters: Character[] = [];

  if (shot.type === "dialogue" && shot.character) {
    const char = characters.find(
      (c) => c.name === shot.character
    );
    if (char) referencedCharacters.push(char);
  }

  // Also try to find characters mentioned by name in the visual text
  for (const char of characters) {
    if (
      char.appearance &&
      !referencedCharacters.includes(char) &&
      shot.visual.includes(char.name)
    ) {
      referencedCharacters.push(char);
    }
  }

  if (referencedCharacters.length === 0) {
    return shot.visual;
  }

  // Prepend character appearances
  const appearanceDescs = referencedCharacters
    .filter((c) => c.appearance)
    .map((c) => c.appearance)
    .join("。");

  if (!appearanceDescs) return shot.visual;

  return `${appearanceDescs}。${shot.visual}`;
}

/**
 * Find characters referenced in a shot by dialogue or visual description.
 */
export function findCharactersInShot(
  shot: Shot,
  characters: Character[]
): Character[] {
  const found: Character[] = [];

  if (shot.type === "dialogue" && shot.character) {
    const char = characters.find((c) => c.name === shot.character);
    if (char) found.push(char);
  }

  for (const char of characters) {
    if (
      !found.includes(char) &&
      char.name &&
      shot.visual?.includes(char.name)
    ) {
      found.push(char);
    }
  }

  return found;
}

/**
 * Build character reference list for reference-image generation from the refMap.
 */
export function buildShotCharacterRefs(
  shot: Shot,
  characters: Character[],
  refMap: Map<string, string>
): { imageUrl: string; type: "face" | "full_body"; characterName: string }[] {
  const refs: { imageUrl: string; type: "face" | "full_body"; characterName: string }[] = [];
  const shotChars = findCharactersInShot(shot, characters);

  for (const c of shotChars) {
    const refUrl = refMap.get(c.name);
    if (refUrl) {
      refs.push({
        imageUrl: refUrl,
        type: "face",
        characterName: c.name,
      });
    }
  }

  return refs;
}

// ============ 镜头语言 → 提示词短语 ============
// 静态分镜图只能表达「景别 / 机位 / 光线」；「运镜」只在视频生成里有意义。
// 短语而不是裸标签，因为生图模型对"特写"这类词的理解远不如完整描述稳定。

const SHOT_SIZE_PHRASE: Record<ShotSize, string> = {
  wide: "远景，人物在广阔环境中占比较小，交代空间与地理关系",
  full: "全景，完整展现人物全身及其所处环境",
  medium: "中景，取景至人物腰部以上，兼顾动作与表情",
  close: "近景，取景至人物胸部以上，突出面部表情",
  close_up: "特写，画面以人物面部为主，强调情绪细节",
  extreme_close_up: "大特写，只取眼睛或局部细节，营造强烈情绪张力",
};

const CAMERA_ANGLE_PHRASE: Record<CameraAngle, string> = {
  eye_level: "平视视角，摄影机与人物视线齐平",
  high_angle: "俯视视角，摄影机高于人物向下拍摄，人物显得弱小",
  low_angle: "仰视视角，摄影机低于人物向上拍摄，人物显得强势有压迫感",
  over_shoulder: "过肩视角，从一人肩后越过肩膀拍摄对面人物",
  pov: "主观视角，模拟角色眼睛所见",
  aerial: "航拍俯瞰视角，从高处俯视全景",
  dutch: "倾斜构图，画面水平线倾斜，营造不安与失衡感",
};

const CAMERA_MOVE_PHRASE: Record<CameraMove, string> = {
  static: "固定机位，画面稳定不移动",
  push_in: "镜头缓缓推近，逐渐靠近主体",
  pull_out: "镜头缓缓拉远，逐渐远离主体",
  pan_left: "镜头向左平移",
  pan_right: "镜头向右平移",
  tilt_up: "镜头向上摇摄",
  tilt_down: "镜头向下摇摄",
  follow: "镜头跟随人物运动",
};

const LIGHTING_PHRASE: Record<LightingType, string> = {
  natural: "自然光，光线均匀柔和",
  warm: "暖色调光线，氛围温馨",
  cool: "冷色调光线，氛围清冷疏离",
  backlight: "逆光，人物边缘带轮廓光",
  neon: "霓虹灯光，彩色环境光映照",
  low_key: "低调布光，大面积暗部，明暗对比强烈",
};

/** 景别 + 机位 + 光线（适用于静态生图）；无任何镜头语言时返回空串 */
export function buildShotLanguagePrompt(shot: Shot): string {
  const parts: string[] = [];
  if (shot.shotSize) parts.push(SHOT_SIZE_PHRASE[shot.shotSize]);
  if (shot.cameraAngle) parts.push(CAMERA_ANGLE_PHRASE[shot.cameraAngle]);
  if (shot.lighting) parts.push(LIGHTING_PHRASE[shot.lighting]);
  return parts.length ? `镜头语言：${parts.join("；")}。` : "";
}

/**
 * 静态分镜图完整提示词 = 角色外貌（一致性）+ 画面描述 + 镜头语言。
 * 有镜头语言时景别/机位才真正生效，否则模型一律出中景。
 */
export function buildShotImagePrompt(shot: Shot, characters: Character[]): string {
  const base = buildAppearancePrompt(shot, characters);
  const language = buildShotLanguagePrompt(shot);
  return language ? `${base}。${language}` : base;
}

/**
 * AI 视频提示词：**画面描述优先**，镜头语言其次，台词仅作表情/口型参考。
 * （历史实现用 `subtitle || line || visual` 会让台词文本驱动画面运动）
 */
export function buildShotVideoPrompt(shot: Shot): string {
  const parts: string[] = [];
  const visual = shot.visual?.trim();
  if (visual) parts.push(visual);

  if (shot.cameraMove) parts.push(CAMERA_MOVE_PHRASE[shot.cameraMove]);
  if (shot.shotSize) parts.push(SHOT_SIZE_PHRASE[shot.shotSize]);
  if (shot.cameraAngle) parts.push(CAMERA_ANGLE_PHRASE[shot.cameraAngle]);
  if (shot.lighting) parts.push(LIGHTING_PHRASE[shot.lighting]);

  const dialogue = shot.type === "dialogue" ? shot.line?.trim() : shot.subtitle?.trim();
  if (dialogue) {
    parts.push(`画面中人物正在说话，语气与表情贴合台词："${dialogue}"`);
  }

  return parts.length ? parts.join("。") : "电影感场景";
}
