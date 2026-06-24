import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs/promises";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { generateImage } from "@/lib/ai/image-generator";

const DRAMA_ID = "ca5472e9-f9ea-4c61-9d29-9e7cbc69aaf0";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");

async function main() {
  console.log("Resuming storyboard generation...\n");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const dramaResult = await pool.query("SELECT style FROM dramas WHERE id=$1", [DRAMA_ID]);
  const dramaStyle = dramaResult.rows[0]?.style || "realistic";

  const eps = (await pool.query(
    "SELECT id, episode_number, shot_data FROM episodes WHERE drama_id=$1 ORDER BY episode_number",
    [DRAMA_ID]
  )).rows;

  for (const ep of eps) {
    const shots = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;
    if (!Array.isArray(shots)) continue;

    console.log(`\n📽 Episode ${ep.episode_number} (${shots.length} shots)`);
    let firstImageUrl = "";
    let updated = false;

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      
      // Skip if already has a COS URL
      if (shot.imageUrl && shot.imageUrl.includes("cos.ap-shanghai")) {
        console.log(`  ✅ shot ${shot.shotNumber}: already has COS URL (skip)`);
        if (!firstImageUrl) firstImageUrl = shot.imageUrl;
        continue;
      }

      const localPath = path.join(UPLOAD_DIR, "images", DRAMA_ID, `episode-${ep.episode_number}`, `shot-${shot.shotNumber}.jpg`);
      let exists = false;
      try { await fs.access(localPath); exists = true; } catch {}

      if (exists) {
        const stats = await fs.stat(localPath);
        const cosKey = `${DRAMA_ID}/images/episode-${ep.episode_number}/shot-${shot.shotNumber}.jpg`;
        const cosUrl = await uploadFileToCos(localPath, cosKey);
        if (cosUrl && cosUrl.startsWith("http")) {
          shots[i] = { ...shots[i], imageUrl: cosUrl };
          if (!firstImageUrl) firstImageUrl = cosUrl;
          updated = true;
          console.log(`  ✅ shot ${shot.shotNumber}: uploaded (${(stats.size/1024/1024).toFixed(1)}MB)`);
        } else {
          console.log(`  ❌ shot ${shot.shotNumber}: upload failed, generating new...`);
          await generateAndSave(shot, dramaStyle, shots, i);
          updated = true;
        }
      } else {
        console.log(`  🆕 shot ${shot.shotNumber}: no local file, generating...`);
        // Rate limit between shots
        if (i > 0) await new Promise(r => setTimeout(r, 1500));
        await generateAndSave(shot, dramaStyle, shots, i);
        updated = true;
      }
    }

    // Save shot_data and episode image_url
    if (updated) {
      await pool.query(
        "UPDATE episodes SET shot_data=$1::jsonb, image_url=$2 WHERE id=$3",
        [JSON.stringify(shots), firstImageUrl, ep.id]
      );
      console.log(`  💾 Episode ${ep.episode_number} saved`);
    }
  }

  await pool.query("UPDATE dramas SET status='storyboard_ready', updated_at=NOW() WHERE id=$1", [DRAMA_ID]);
  console.log("\n✅ Storyboard generation complete!");
  await pool.end();
}

async function generateAndSave(shot: any, dramaStyle: string, shots: any[], i: number) {
  const prompt = shot.visual || shot.imagePrompt || shot.subtitle || `Scene from short drama - ${shot.shotNumber}`;
  console.log(`    Generating image for shot ${shot.shotNumber}...`);
  const start = Date.now();
  const epNum = shots[i]?.shotNumber || (i + 1);
  
  try {
    const imageUrl = await generateImage(prompt, dramaStyle);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    
    const localDir = UPLOAD_DIR;
    await fs.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, `shot-${epNum}.jpg`);
    const imgResp = await fetch(imageUrl);
    if (imgResp.ok) {
      const buf = Buffer.from(await imgResp.arrayBuffer());
      await fs.writeFile(localPath, buf);
    }
    
    const cosKey = `${DRAMA_ID}/images/tmp/shot-${epNum}.jpg`;
    const cosUrl = await uploadFileToCos(localPath, cosKey);
    shots[i] = { ...shots[i], imageUrl: cosUrl || imageUrl };
    console.log(`    ✅ shot ${shot.shotNumber}: ${elapsed}s, COS uploaded`);
  } catch (err: any) {
    console.error(`    ❌ shot ${shot.shotNumber}: ${err.message.substring(0, 80)}`);
  }
}

main().catch(e => console.error(e));
