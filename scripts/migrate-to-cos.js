const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');
const { Pool } = require('pg');

// Load .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[2]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
});
const BUCKET = process.env.COS_BUCKET;
const REGION = process.env.COS_REGION;
const UPLOAD_DIR = path.resolve('./uploads');

function getCosUrl(cosKey) {
  return `https://${BUCKET}.cos.${REGION}.myqcloud.com/${cosKey}`;
}

function uploadToCos(localPath, cosKey) {
  return new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
    };
    cos.putObject({
      Bucket: BUCKET, Region: REGION, Key: cosKey,
      Body: buffer, ContentType: mimeMap[ext] || 'application/octet-stream',
    }, (err, _data) => {
      if (err) reject(err);
      else resolve(getCosUrl(cosKey));
    });
  });
}

async function main() {
  const pool = new Pool({
    host: 'localhost', port: 5432,
    user: 'storycraft', password: 'YOUR_DB_PASSWORD', database: 'shortify_ai'
  });

  const { rows: episodes } = await pool.query(
    'SELECT id, drama_id, episode_number, image_url, video_url, shot_data FROM episodes ORDER BY drama_id, episode_number'
  );

  let uploaded = 0, failed = 0;

  for (const ep of episodes) {
    const dramaId = ep.drama_id;
    const epNum = ep.episode_number;
    const updates = [];

    // Upload shot images
    if (ep.shot_data && Array.isArray(ep.shot_data)) {
      for (const shot of ep.shot_data) {
        const shotDir = path.join(UPLOAD_DIR, 'images', dramaId, `episode-${epNum}`);
        for (const ext of ['.jpg', '.jpeg', '.png']) {
          const localPath = path.join(shotDir, `shot-${shot.shotNumber}${ext}`);
          if (fs.existsSync(localPath)) {
            const cosKey = `${dramaId}/images/episode-${epNum}/shot-${shot.shotNumber}.jpg`;
            try {
              const url = await uploadToCos(localPath, cosKey);
              uploaded++;
              process.stdout.write(`+ ${cosKey}\n`);
            } catch(e) { failed++; process.stderr.write(`FAIL ${cosKey}: ${e.message}\n`); }
            break;
          }
        }
      }
    }

    // Upload episode video
    if (ep.video_url && !ep.video_url.startsWith('http')) {
      const localPath = path.join(UPLOAD_DIR, '..', ep.video_url);
      if (fs.existsSync(localPath)) {
        const cosKey = `${dramaId}/videos/episode-${epNum}.mp4`;
        try {
          const url = await uploadToCos(localPath, cosKey);
          updates.push(`video_url = '${url}'`);
          uploaded++;
          process.stdout.write(`+ ${cosKey}\n`);
        } catch(e) { failed++; process.stderr.write(`FAIL ${cosKey}: ${e.message}\n`); }
      }
    }

    // Upload episode cover image
    if (ep.image_url && !ep.image_url.startsWith('http')) {
      const localPath = path.join(UPLOAD_DIR, '..', ep.image_url);
      if (fs.existsSync(localPath)) {
        const ext = path.extname(localPath);
        const cosKey = `${dramaId}/images/episode-${epNum}/cover${ext}`;
        try {
          const url = await uploadToCos(localPath, cosKey);
          updates.push(`image_url = '${url}'`);
          uploaded++;
          process.stdout.write(`+ ${cosKey}\n`);
        } catch(e) { failed++; process.stderr.write(`FAIL ${cosKey}: ${e.message}\n`); }
      }
    }

    if (updates.length > 0) {
      await pool.query(`UPDATE episodes SET ${updates.join(', ')} WHERE id = '${ep.id}'`);
      console.log(`  -> Updated EP${epNum} for ${dramaId.substring(0,8)}`);
    }
  }

  console.log(`\nDone! Uploaded: ${uploaded}, Failed: ${failed}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
