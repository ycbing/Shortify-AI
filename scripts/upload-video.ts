import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import * as path from "path";

async function main() {
  const localPath = path.resolve(process.env.UPLOAD_DIR || "./uploads", "videos/demo/wan2.7-demo.mp4");
  const cosKey = "shortify-ai/videos/demo/wan2.7-sample.mp4";
  console.log("Uploading:", localPath, "->", cosKey);
  const cosUrl = await uploadFileToCos(localPath, cosKey);
  console.log("COS URL:", cosUrl);
  if (cosUrl && cosUrl.startsWith("http")) {
    console.log("\n✅ Uploaded!");
    console.log("COS:", cosUrl);
    const encoded = encodeURIComponent(cosKey);
    console.log("Proxy:", "http://localhost:8000/api/uploads/cos/" + encoded);
    console.log("Web:  ", "https://craftmind.cn/api/uploads/cos/" + encoded);
  } else {
    console.log("❌ Upload failed, fallback path:", cosUrl);
  }
}
main().catch(e => console.error(e));
