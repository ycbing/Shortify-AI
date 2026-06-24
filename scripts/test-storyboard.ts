import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { generateImage } from "@/lib/ai/image-generator";
import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs/promises";
import { uploadFileToCos, imageCosKey } from "@/lib/ai/cos-storage";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const DRAMA_ID = "ca5472e9-f9ea-4c61-9d29-9e7cbc69aaf0";

async function downloadFile(url: string, localPath: string): Promise<string> {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(localPath, buf);
  return localPath;
}

async function main() {
  console.log("Testing storyboard generation...\n");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Get first episode
  const ep = (await pool.query(
    "SELECT id, episode_number, shot_data, style FROM episodes WHERE drama_id=$1 ORDER BY episode_number LIMIT 1",
    [DRAMA_ID]
  )).rows[0];
  if (!ep) { console.log("No episode found"); return; }

  const shots = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;
  const firstShot = shots?.[0];
  if (!firstShot) { console.log("No shots"); return; }

  const description = firstShot.imagePrompt || firstShot.subtitle || firstShot.narration || "cinematic scene";
  const style = "realistic"; // ep.style || "realistic"
  
  console.log(`Episode ${ep.episode_number}, shot ${firstShot.shotNumber}`);
  console.log(`Description: ${description.substring(0, 80)}...`);
  console.log(`Style: ${style}`);
  console.log("Calling generateImage...\n");

  const start = Date.now();
  try {
    const imageUrl = await generateImage(description, style);
    console.log(`✅ Image generated (${((Date.now() - start)/1000).toFixed(1)}s)`);
    console.log(`URL: ${imageUrl.substring(0, 80)}...`);
    
    // Download
    const localDir = path.join(UPLOAD_DIR, "images", DRAMA_ID, `episode-${ep.episode_number}`);
    const localPath = path.join(localDir, `shot-${firstShot.shotNumber}.jpg`);
    await downloadFile(imageUrl, localPath);
    console.log(`✅ Saved to: ${localPath}`);
    
    // Upload to COS
    const cosKey = imageCosKey(DRAMA_ID, ep.episode_number, firstShot.shotNumber);
    const cosUrl = await uploadFileToCos(localPath, cosKey);
    console.log(`✅ COS: ${cosUrl?.substring(0, 80)}`);
    
  } catch (err: any) {
    console.error(`❌ Failed: ${err.message}`);
    console.error(err.stack?.substring(0, 300));
  }

  await pool.end();
}
main().catch(e => console.error(e));
