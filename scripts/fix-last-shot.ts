import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { generateImage } from "@/lib/ai/image-generator";
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs/promises";

async function main() {
  console.log("Generating final missing shot...");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ep = (await pool.query("SELECT id, shot_data FROM episodes WHERE id='410883e3-e69a-47ee-b9f7-406346ea666e'")).rows[0];
  const shots = typeof ep.shot_data === "string" ? JSON.parse(ep.shot_data) : ep.shot_data;
  const shot = shots[6];
  const prompt = shot.visual || "Final cinematic scene";
  console.log("Prompt:", prompt.substring(0, 60) + "...");
  
  const url = await generateImage(prompt, "realistic");
  console.log("Done:", url.substring(0, 60));
  
  const localPath = path.resolve("uploads/fix/shot7.jpg");
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const resp = await fetch(url);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(localPath, buf);
  
  const cosUrl = await uploadFileToCos(localPath, "ca5472e9-f9ea-4c61-9d29-9e7cbc69aaf0/images/episode-5/shot-7.jpg");
  console.log("COS:", cosUrl);
  
  shots[6].imageUrl = cosUrl || url;
  await pool.query("UPDATE episodes SET shot_data=$1::jsonb, image_url=$2 WHERE id=$3",
    [JSON.stringify(shots), cosUrl || url, "410883e3-e69a-47ee-b9f7-406346ea666e"]);
  console.log("✅ Complete!");
  await pool.end();
}
main().catch(e => console.error(e));
