import COS from "cos-nodejs-sdk-v5";
import { readFile } from "fs/promises";
import path from "path";

// Check if COS is configured
export function isCosConfigured(): boolean {
  return !!(
    process.env.COS_SECRET_ID &&
    process.env.COS_SECRET_KEY &&
    process.env.COS_BUCKET &&
    process.env.COS_REGION
  );
}

// Lazy-initialized COS client
let cosClient: COS | null = null;

function getCosClient(): COS | null {
  if (!isCosConfigured()) return null;
  if (cosClient) return cosClient;

  cosClient = new COS({
    SecretId: process.env.COS_SECRET_ID!,
    SecretKey: process.env.COS_SECRET_KEY!,
  });

  return cosClient;
}

const BUCKET = () => process.env.COS_BUCKET!;
const REGION = () => process.env.COS_REGION!;

/**
 * Get the public URL for a COS object key (no signature).
 */
export function getCosUrl(cosKey: string): string {
  const bucket = BUCKET();
  const region = REGION();
  return `https://${bucket}.cos.${region}.myqcloud.com/${cosKey}`;
}

/**
 * Generate a temporary signed URL for a COS object (default 2 hours).
 */
export function getSignedCosUrl(cosKey: string, expires: number = 7200): string {
  const client = getCosClient();
  if (!client) return getCosUrl(cosKey);

  // getObjectUrl is synchronous when Sign=true (returns URL directly)
  const url = client.getObjectUrl({
    Bucket: BUCKET(),
    Region: REGION(),
    Key: cosKey,
    Sign: true,
    Expires: expires,
  });

  return url || getCosUrl(cosKey);
}

/**
 * Check if a URL is a COS URL for this bucket.
 */
export function isCosUrl(url: string): boolean {
  if (!url || !url.startsWith("http")) return false;
  const bucket = process.env.COS_BUCKET;
  return bucket ? url.includes(`${bucket}.cos.`) : false;
}

/**
 * Extract COS key from a full COS URL.
 */
export function cosKeyFromUrl(url: string): string | null {
  const prefix = `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/`;
  if (url.startsWith(prefix)) {
    return url.slice(prefix.length);
  }
  return null;
}

/**
 * Upload a local file to COS, returns the COS URL.
 * If COS is not configured, returns null.
 */
export async function uploadToCos(
  localPath: string,
  cosKey: string
): Promise<string | null> {
  const client = getCosClient();
  if (!client) return null;

  const buffer = await readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();

  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".srt": "text/plain",
  };

  const contentType = mimeMap[ext] || "application/octet-stream";

  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: BUCKET(),
        Region: REGION(),
        Key: cosKey,
        Body: buffer,
        ContentType: contentType,
      },
      (err, _data) => {
        if (err) {
          console.error(`COS upload failed for ${cosKey}:`, err.message);
          reject(err);
        } else {
          resolve(getCosUrl(cosKey));
        }
      }
    );
  });
}

/**
 * Delete a file from COS.
 * If COS is not configured, silently succeeds.
 */
export async function deleteFromCos(cosKey: string): Promise<void> {
  const client = getCosClient();
  if (!client) return;

  return new Promise((resolve, reject) => {
    client.deleteObject(
      {
        Bucket: BUCKET(),
        Region: REGION(),
        Key: cosKey,
      },
      (err, _data) => {
        if (err) {
          console.error(`COS delete failed for ${cosKey}:`, err.message);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Make a COS object temporarily public-readable, then return its public URL.
 * Use this when an external service (e.g., LibLib API) needs to access the file.
 * The ACL is set to public-read; caller should call restoreCosObjectAcl after use.
 */
export async function makeCosObjectPublic(cosKey: string): Promise<string> {
  const client = getCosClient();
  if (!client) return getCosUrl(cosKey);

  return new Promise((resolve, reject) => {
    client.putObjectAcl(
      {
        Bucket: BUCKET(),
        Region: REGION(),
        Key: cosKey,
        ACL: 'public-read',
      },
      (err, _data) => {
        if (err) {
          console.error(`Failed to set public-read ACL for ${cosKey}:`, err.message);
          reject(err);
        } else {
          resolve(getCosUrl(cosKey));
        }
      }
    );
  });
}

/**
 * Restore a COS object's ACL to private (after external service is done).
 */
export async function restoreCosObjectAcl(cosKey: string): Promise<void> {
  const client = getCosClient();
  if (!client) return;

  return new Promise((resolve) => {
    client.putObjectAcl(
      {
        Bucket: BUCKET(),
        Region: REGION(),
        Key: cosKey,
        ACL: 'private',
      },
      (err) => {
        if (err) {
          console.warn(`Failed to restore private ACL for ${cosKey}:`, err.message);
        }
        resolve();
      }
    );
  });
}

/**
 * Upload a file to COS. If COS is not configured, return the local path as-is.
 * This is the main function to call from other modules.
 */
export async function uploadFileToCos(
  localPath: string,
  cosKey: string
): Promise<string> {
  if (!isCosConfigured()) {
    return localPath;
  }

  try {
    const cosUrl = await uploadToCos(localPath, cosKey);
    if (cosUrl) {
      console.log(`COS upload success: ${cosKey} -> ${cosUrl}`);
      return cosUrl;
    }
    // Fallback to local path
    return localPath;
  } catch (err) {
    console.warn(
      `COS upload failed for ${cosKey}, falling back to local path:`,
      err
    );
    return localPath;
  }
}

/**
 * Get a publicly accessible URL for a COS object for external services.
 * Temporarily sets the object to public-read ACL.
 * Returns a plain COS URL (no signature) that external services can fetch.
 */
export async function getPublicAccessibleUrl(cosKey: string): Promise<string> {
  if (!isCosConfigured()) {
    return getCosUrl(cosKey);
  }
  return makeCosObjectPublic(cosKey);
}

/**
 * Helper: Build COS key for a shot image.
 */
export function imageCosKey(
  dramaId: string,
  episodeNumber: number,
  shotNumber: number
): string {
  return `${dramaId}/images/episode-${episodeNumber}/shot-${shotNumber}.jpg`;
}

/**
 * Helper: Build COS key for an episode video.
 */
export function videoCosKey(
  dramaId: string,
  episodeNumber: number,
  filename: string = "episode.mp4"
): string {
  return `${dramaId}/videos/episode-${episodeNumber}/${filename}`;
}

/**
 * Helper: Build COS key for an AI shot video.
 */
export function aiVideoCosKey(
  dramaId: string,
  episodeNumber: number,
  shotNumber: number
): string {
  return `${dramaId}/videos/episode-${episodeNumber}/shot-${shotNumber}.mp4`;
}
