import { submitVideoGeneration, waitForVideoCompletion, downloadVideo, imageToBase64 } from '../lib/ai/video-generator';
import path from 'path';
import fs from 'fs/promises';

const imagePath = path.resolve('./uploads/images/a7f86b03-5313-4891-a7e6-6037f4482e1b/episode-1/shot-1.jpg');

async function main() {
  console.log('1. Converting image to base64...');
  const base64 = await imageToBase64(imagePath);
  console.log('   Base64 length:', base64.length);

  console.log('2. Submitting to CogVideoX-3...');
  const { taskId } = await submitVideoGeneration(
    '阳光下的校园，青春的气息弥漫在空气中。',
    base64,
    'realistic'
  );
  console.log('   Task ID:', taskId);

  console.log('3. Polling for completion (this may take 1-3 min)...');
  const result = await waitForVideoCompletion(taskId, 300000, 8000);
  console.log('   Video URL:', result.videoUrl?.substring(0, 100));
  console.log('   Cover URL:', result.coverUrl?.substring(0, 100) || 'none');

  console.log('4. Downloading video...');
  const outputPath = path.resolve('./uploads/videos/a7f86b03-5313-4891-a7e6-6037f4482e1b/episode-1-ai/shot-1.mp4');
  await downloadVideo(result.videoUrl, outputPath);
  const stat = await fs.stat(outputPath);
  console.log('   Saved:', outputPath);
  console.log('   Size:', (stat.size / 1024).toFixed(1), 'KB');
  console.log('DONE!');
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
