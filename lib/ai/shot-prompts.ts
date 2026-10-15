// 分镜 prompt 组装与角色引用构建（storyboard 路由与单镜头重跑共用）
import type { Shot, Character } from "@/types/drama";

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
