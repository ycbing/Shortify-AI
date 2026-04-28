import { getStyleImagePrompt } from "./script-generator";

const COGVIEW_BASE_URL =
  process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
const GLM_API_KEY = process.env.GLM_API_KEY || "";

interface CogViewResponse {
  id: string;
  created: number;
  data: {
    url: string;
  }[];
}

export async function generateImage(
  prompt: string,
  style: string = "realistic",
  size: "1024x1024" | "1280x720" | "1728x960" = "1728x960"
): Promise<string> {
  const stylePrompt = getStyleImagePrompt(style as "realistic" | "anime" | "ink" | "cyberpunk");
  const fullPrompt = `${prompt}。画面风格：${stylePrompt}。宽屏16:9构图，电影感画面，专业摄影级别。`;

  const model = process.env.IMAGE_MODEL || "cogview-3-plus";

  // 1728x960: 16:9 比例, 均为16倍数, 像素数 1,658,880 < 2^21
  const imageSize = model.startsWith("glm-image") ? "1728x960" : size;

  const response = await fetch(`${COGVIEW_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      prompt: fullPrompt,
      size: imageSize,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CogView API error: ${response.status} - ${error}`);
  }

  const result: CogViewResponse = await response.json();

  if (!result.data?.[0]?.url) {
    throw new Error("No image URL returned from CogView");
  }

  return result.data[0].url;
}

export async function downloadImage(
  url: string,
  savePath: string
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const { writeFile, mkdir } = await import("fs/promises");
  await mkdir(require("path").dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);

  return savePath;
}
