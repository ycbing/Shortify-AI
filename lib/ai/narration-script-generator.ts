import { createLogger } from "@/lib/logger";
import { chatCompletion } from "./glm-client";

const log = createLogger("narration-script");

/**
 * Call GLM API and return text content.
 */
async function generateContent(prompt: string, maxTokens = 2048): Promise<string> {
  try {
    const result = await chatCompletion([
      { role: "user", content: prompt },
    ], {
      maxTokens,
      temperature: 0.7,
    });
    return result?.choices?.[0]?.message?.content || "";
  } catch (err) {
    log.error("GLM API call failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Generate a narration script for a video subject.
 * Returns the script text and extracted search terms.
 */
export async function generateNarrationScript(
  subject: string,
  options: {
    language?: string;
    paragraphNumber?: number;
  } = {}
): Promise<{ script: string; terms: string[] }> {
  const language = options.language || "zh-CN";
  const paragraphNumber = options.paragraphNumber || 5;

  // Step 1: Generate script
  const scriptPrompt = buildScriptPrompt(subject, language, paragraphNumber);
  log.info("Generating narration script", { subject, language, paragraphNumber });

  const script = await generateContent(scriptPrompt, 2048);
  if (!script) {
    throw new Error("Failed to generate narration script");
  }

  log.info("Script generated", { scriptLength: script.length });

  // Step 2: Extract search terms from script
  const termsPrompt = buildTermsPrompt(subject, script, language);
  const termsStr = await generateContent(termsPrompt, 512);

  let terms: string[] = [];
  if (termsStr) {
    // Parse comma-separated terms, could be Chinese commas or English commas
    terms = termsStr
      .split(/[,，、\n]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 50)
      .slice(0, 10);
  }

  // Always include the subject itself as a search term
  if (subject && !terms.includes(subject)) {
    terms.unshift(subject);
  }

  log.info("Search terms extracted", { terms });

  return { script, terms };
}

/**
 * Generate subtitle paragraphs from script.
 * Splits script by punctuation and assigns approximate timing.
 */
export function generateSubtitleParagraphs(script: string): {
  text: string;
  index: number;
}[] {
  // Split by sentence-ending punctuation
  const sentences = script
    .split(/(?<=[。！？.!?])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.map((text, index) => ({
    text,
    index: index + 1,
  }));
}

// ============ Prompts ============

function buildScriptPrompt(
  subject: string,
  _language: string,
  paragraphNumber: number
): string {
  return `你是一位专业的短视频解说文案编剧。请为主题"${subject}"创作一段适合短视频的解说文案。

要求：
1. 总共 ${paragraphNumber} 个段落，每个段落 3-5 句话
2. 语言生动有趣，适合口播风格，有节奏感
3. 内容要有信息量，让观众学到新知识
4. 每个段落之间有自然的过渡
5. 总字数控制在 300-800 字
6. 直接输出文案内容，不要包含标题、序号或额外说明
7. 不要用"首先""其次""最后"等套话，要自然流畅

主题：${subject}

文案：`;
}

function buildTermsPrompt(
  subject: string,
  script: string,
  _language: string
): string {
  return `我需要为一段短视频搜索匹配的视频素材。请根据以下解说文案，提取 5-8 个适合在 Pexels 视频网站上搜索素材的英文关键词。

这些关键词应该：
1. 是文案中提到的具体场景、物体或概念
2. 适合搜索到真实视频素材（如 city night, rain, ocean, office, technology, money 等）
3. 每个关键词 1-3 个英文单词

主题：${subject}

解说文案：
${script}

请直接输出逗号分隔的英文关键词，不要其他说明：`;
}
