// ============================================
// 初始化脚本：将环境变量中的模型配置写入 model_configs 表
// 用法: npx tsx scripts/init-model-configs.ts
// ============================================

import { Pool } from "pg";
import crypto from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

// 手动解析 .env.local
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  } catch {
    // ignore
  }
  return env;
}

const env = { ...process.env, ...loadEnv() };

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

// AES-256-GCM 加密
function encrypt(plaintext: string): string {
  const keyHex = env.ENCRYPTION_KEY || "";
  if (!keyHex) {
    throw new Error("ENCRYPTION_KEY 未设置");
  }
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let ciphertext = Buffer.alloc(0);
  ciphertext = Buffer.concat([ciphertext, cipher.update(plaintext, "utf-8")]);
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

async function init() {
  console.log("=== 初始化模型默认配置 ===\n");

  // 检查是否已有配置
  const existing = await pool.query("SELECT COUNT(*) FROM model_configs");
  if (parseInt(existing.rows[0].count, 10) > 0) {
    console.log("model_configs 表已有数据，跳过初始化");
    console.log("如需重新初始化，请先清空表: TRUNCATE model_configs;");
    await pool.end();
    return;
  }

  const configs = [
    {
      service_type: "llm",
      provider: "glm",
      model_name: env.LLM_MODEL || "glm-4-flash",
      api_key: env.GLM_API_KEY || null,
      base_url: env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
      is_default: true,
      config: {},
    },
    {
      service_type: "image",
      provider: "glm",
      model_name: env.IMAGE_MODEL || "cogview-3-flash",
      api_key: env.GLM_API_KEY || null,
      base_url: env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
      is_default: true,
      config: {},
    },
    {
      service_type: "tts",
      provider: env.XUNFEI_API_KEY ? "xunfei" : "edge",
      model_name: env.XUNFEI_API_KEY ? "x4_xiaorui" : "edge-tts",
      api_key: env.XUNFEI_API_KEY || null,
      base_url: null,
      is_default: true,
      config: env.XUNFEI_APPID
        ? {
            appId: env.XUNFEI_APPID,
            appSecret: env.XUNFEI_API_SECRET,
          }
        : {},
    },
    {
      service_type: "video",
      provider: "glm",
      model_name: env.VIDEO_MODEL || "cogvideox-3",
      api_key: env.GLM_API_KEY || null,
      base_url: env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
      is_default: true,
      config: {
        quality: env.VIDEO_QUALITY || "speed",
        size: env.VIDEO_SIZE || "1920x1080",
        fps: parseInt(env.VIDEO_FPS || "30", 10),
        duration: parseInt(env.VIDEO_DURATION || "5", 10),
      },
    },
  ];

  for (const c of configs) {
    const encryptedKey = c.api_key ? encrypt(c.api_key) : null;
    const result = await pool.query(
      `INSERT INTO model_configs (service_type, provider, model_name, api_key, base_url, is_default, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (service_type, provider, model_name) DO NOTHING
       RETURNING id`,
      [c.service_type, c.provider, c.model_name, encryptedKey, c.base_url, c.is_default, JSON.stringify(c.config)]
    );

    if (result.rows.length > 0) {
      console.log(`✅ ${c.service_type}: ${c.provider}/${c.model_name} (id=${result.rows[0].id})`);
    } else {
      console.log(`⏭️  ${c.service_type}: ${c.provider}/${c.model_name} (已存在，跳过)`);
    }
  }

  console.log("\n=== 初始化完成 ===");
  await pool.end();
}

init().catch((err) => {
  console.error("初始化失败:", err);
  process.exit(1);
});
