// ============================================
// AES-256-GCM 加密/解密工具
// 用于加密存储 API Key 等敏感信息
// ============================================

import crypto from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, GCM 推荐
const AUTH_TAG_LENGTH = 16;

/** 获取加密密钥（32 字节 hex → Buffer） */
function getEncryptionKey(): Buffer {
  let keyHex = process.env.ENCRYPTION_KEY;

  // 如果环境变量中没有，尝试从 .env.local 读取或自动生成
  if (!keyHex) {
    const envPath = path.resolve(process.cwd(), ".env.local");
    try {
      const envContent = fs.readFileSync(envPath, "utf-8");
      const match = envContent.match(/^ENCRYPTION_KEY=(.+)$/m);
      if (match) {
        keyHex = match[1].trim();
        process.env.ENCRYPTION_KEY = keyHex;
      }
    } catch {
      // .env.local 不存在或无法读取
    }
  }

  if (!keyHex) {
    // 自动生成 32 字节 hex 密钥并写入 .env.local
    keyHex = crypto.randomBytes(32).toString("hex");
    const envPath = path.resolve(process.cwd(), ".env.local");
    try {
      const existingContent = fs.existsSync(envPath)
        ? fs.readFileSync(envPath, "utf-8")
        : "";
      const newContent = existingContent.endsWith("\n")
        ? `${existingContent}ENCRYPTION_KEY=${keyHex}\n`
        : `${existingContent}\nENCRYPTION_KEY=${keyHex}\n`;
      fs.writeFileSync(envPath, newContent, "utf-8");
      process.env.ENCRYPTION_KEY = keyHex;
    } catch (err) {
      throw new Error(
        `无法写入 ENCRYPTION_KEY 到 .env.local: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY 必须为 64 个字符的 hex 字符串（32 字节）");
  }
  return key;
}

// 缓存密钥，避免每次都读取
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = getEncryptionKey();
  }
  return cachedKey;
}

// ----------------------------------------
// 加密 → hex 字符串
// 格式: iv_hex:authTag_hex:ciphertext_hex
// ----------------------------------------
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = Buffer.alloc(0);
  ciphertext = Buffer.concat([ciphertext, cipher.update(plaintext, "utf-8")]);
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // 拼接: iv:authTag:ciphertext
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

// ----------------------------------------
// 解密 hex 字符串 → 原始明文
// ----------------------------------------
export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("无效的加密格式");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = Buffer.alloc(0);
  plaintext = Buffer.concat([plaintext, decipher.update(ciphertext)]);
  plaintext = Buffer.concat([plaintext, decipher.final()]);

  return plaintext.toString("utf-8");
}

/** 遮蔽 API Key，只显示末尾 4 位 */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return "••••";
  return "••••••••" + key.slice(-4);
}
