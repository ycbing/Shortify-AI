import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { uploadFileToCos } from "@/lib/ai/cos-storage";
import * as path from "path";

async function main() {
  const localPath = path.resolve("uploads/videos/81aec7c9-0fe0-4f6b-a951-a9b076bb7797/complete.mp4");
  const cosKey = "shortify-ai/videos/demo/shortify-complete-sample.mp4";
  console.log("Uploading:", localPath);
  const cosUrl = await uploadFileToCos(localPath, cosKey);
  console.log("COS:", cosUrl);
  const encoded = encodeURIComponent(cosKey);
  console.log("Proxy:", "http://localhost:8000/api/uploads/cos/" + encoded);
  console.log("Web:", "https://craftmind.cn/api/uploads/cos/" + encoded);
}
main().catch(e => console.error(e));
