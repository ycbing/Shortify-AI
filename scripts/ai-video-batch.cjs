#!/usr/bin/env node
/**
 * Batch generate AI videos for all shots using CogVideoX-3
 * Usage: node scripts/ai-video-batch.cjs [start_episode]
 */

const { Pool } = require("pg");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const DRAMA_ID = "e0655c7b-2fd6-4a68-ab06-45234d974dff";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const API_KEY = process.env.GLM_API_KEY || "6d71bd03d31b4bddbaa340ab01f56035.SxjuGfZg2CHpI75h";
const BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const START_EPISODE = parseInt(process.argv[2] || "1");
const DB_CONFIG = { host: "172.17.0.1", port: 5432, database: "shortify_ai", user: "storycraft", password: "YOUR_DB_PASSWORD" };

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.trim());
    });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
 const fullUrl = `${BASE_URL}${urlPath}`;
    const url = new URL(fullUrl);
    const opts = {
      hostname: url.hostname, path: url.pathname, method,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); } catch { resolve({ raw: text }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function pollTask(taskId, maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await apiRequest("GET", `/async-result/${taskId}`);
    if (result.task_status === "SUCCESS" && result.video_result?.length) {
      return result.video_result[0];
    }
    if (result.task_status === "FAIL") {
      const msg = result.error?.message || result.choices?.[0]?.message?.content || "Unknown";
      throw new Error(`Task failed: ${msg}`);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error("Poll timeout");
}

async function downloadToStore(url, destPath) {
  const buffer = await httpGet(url);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

async function main() {
  const pool = new Pool(DB_CONFIG);
  
  try {
    const epRes = await pool.query(
      `SELECT id, episode_number, shot_data FROM episodes WHERE drama_id = $1 AND episode_number >= $2 ORDER BY episode_number`,
      [DRAMA_ID, START_EPISODE]
    );
    
    log(`Loaded ${epRes.rows.length} episodes (starting from EP${START_EPISODE})`);
    
    let totalShots = 0, completedShots = 0, failedShots = 0;
    
    for (const ep of epRes.rows) {
      const shots = ep.shot_data || [];
      log(`\n=== EP${ep.episode_number}: ${shots.length} shots ===`);
      
      for (const shot of shots) {
        totalShots++;
        const shotNum = shot.shotNumber;
        const imagePath = path.join(UPLOAD_DIR, "images", DRAMA_ID, `episode-${ep.episode_number}`, `shot-${shotNum}.jpg`);
        const aiVideoPath = path.join(UPLOAD_DIR, "videos", DRAMA_ID, `episode-${ep.episode_number}`, `ai-shot-${shotNum}.mp4`);
        
        // Skip if already generated
        if (fs.existsSync(aiVideoPath) && fs.statSync(aiVideoPath).size > 10000) {
          log(`  Shot${shotNum}: already exists (${(fs.statSync(aiVideoPath).size / 1024 / 1024).toFixed(1)}MB), skipping`);
          completedShots++;
          continue;
        }
        
        // Convert image to base64
        if (!fs.existsSync(imagePath)) {
          log(`  Shot${shotNum}: image not found, skipping`);
          failedShots++;
          continue;
        }
        
        const imgBuffer = fs.readFileSync(imagePath);
        const b64 = imgBuffer.toString("base64");
        const dataUri = `data:image/jpeg;base64,${b64}`;
        
        // Build prompt
        const visual = shot.visual || shot.subtitle || "cinematic scene";
        const prompt = `基于这张图片生成短视频：${visual}。电影感画面，平滑运动。`;
        
        // Submit task
        log(`  Shot${shotNum}: submitting...`);
        try {
          const submitResult = await apiRequest("POST", "/videos/generations", {
            model: "cogvideox-3",
            prompt,
            image_url: dataUri,
          });
          
          if (!submitResult.id) {
            throw new Error(`No task ID: ${JSON.stringify(submitResult)}`);
          }
          
          log(`  Shot${shotNum}: task ${submitResult.id}, polling...`);
          const videoResult = await pollTask(submitResult.id);
          
          // Download video
          await downloadToStore(videoResult.url, aiVideoPath);
          const size = (fs.statSync(aiVideoPath).size / 1024 / 1024).toFixed(1);
          log(`  Shot${shotNum}: DONE (${size}MB)`);
          completedShots++;
          
          // Rate limit: wait between requests
          if (shotNum < shots.length || ep.episode_number < epRes.rows[epRes.rows.length - 1].episode_number) {
            await new Promise(r => setTimeout(r, 3000));
          }
        } catch (err) {
          log(`  Shot${shotNum}: FAILED - ${err.message}`);
          failedShots++;
          
          // Wait longer after failure (likely rate limit)
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }
    
    log(`\n=== COMPLETE ===`);
    log(`Total: ${totalShots} | Success: ${completedShots} | Failed: ${failedShots}`);
    
    if (completedShots > 0) {
      // Re-compose videos with AI shots
      log("\nNow re-composing videos with AI clips...");
      log("Run: node scripts/recompose-with-ai.cjs");
    }
    
  } catch (err) {
    log(`FATAL: ${err.message}`);
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
