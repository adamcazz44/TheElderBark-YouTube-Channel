#!/usr/bin/env node
/**
 * fetch-footage.js — Spec 2: Pexels footage sourcer.
 *
 * Queries the Pexels Video API for cinematic stock clips matching a keyword,
 * downloads up to 5 of the best results into the local footage pool, and upserts
 * footage/manifest.json so downstream specs can reference clips by keyword without
 * re-downloading.
 *
 * Usage:
 *   node scripts/fetch-footage.js "mountain peak sunrise"
 *   npm run fetch:footage -- "open road freedom"
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const FOOTAGE_DIR = path.join(ROOT, "footage");
const MANIFEST_PATH = path.join(FOOTAGE_DIR, "manifest.json");
const PEXELS_ENDPOINT = "https://api.pexels.com/videos/search";

const MAX_SELECT = 5; // download at most this many clips per keyword
const PER_PAGE = 10;

// Load .env BEFORE anything else so process.env.PEXELS_API_KEY is populated.
require("dotenv").config({ path: ENV_PATH });

// Optional progress bar — degrade gracefully if the dep misbehaves.
let cliProgress = null;
try {
  cliProgress = require("cli-progress");
} catch (_) {
  cliProgress = null;
}

function sanitizeKeyword(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // spaces & special chars -> underscore
    .replace(/^_+|_+$/g, ""); // trim leading/trailing underscores
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { clips: [] };
  try {
    const data = fs.readJsonSync(MANIFEST_PATH);
    if (data && Array.isArray(data.clips)) return data;
  } catch (_) {
    // corrupt/empty manifest -> start fresh rather than crash
  }
  return { clips: [] };
}

function saveManifest(manifest) {
  fs.ensureDirSync(FOOTAGE_DIR);
  fs.writeJsonSync(MANIFEST_PATH, manifest, { spaces: 2 });
}

/** Pick the highest-resolution downloadable MP4 from a Pexels video object. */
function pickBestFile(video) {
  const files = (video.video_files || []).filter(
    (f) => f && f.file_type === "video/mp4" && f.link
  );
  if (!files.length) return null;
  files.sort(
    (a, b) => (b.width || 0) - (a.width || 0) || (b.height || 0) - (a.height || 0)
  );
  return files[0];
}

/**
 * Rank candidates by the spec's priority order:
 *   1) prefer resolution >= 1920x1080
 *   2) prefer longer clips (>= 10s)
 *   3) tiebreak: higher resolution, then longer
 */
function rankCandidates(videos) {
  const score = (v) => ({
    hd: v.width >= 1920 && v.height >= 1080 ? 1 : 0,
    long: (v.duration || 0) >= 10 ? 1 : 0,
  });
  return [...videos].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb.hd !== sa.hd) return sb.hd - sa.hd;
    if (sb.long !== sa.long) return sb.long - sa.long;
    return (b.width || 0) - (a.width || 0) || (b.duration || 0) - (a.duration || 0);
  });
}

async function downloadFile(url, dest) {
  const writer = fs.createWriteStream(dest);
  const resp = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 120000,
  });
  await new Promise((resolve, reject) => {
    resp.data.pipe(writer);
    let errored = false;
    const fail = (err) => {
      if (errored) return;
      errored = true;
      writer.close();
      reject(err);
    };
    writer.on("finish", resolve);
    writer.on("error", fail);
    resp.data.on("error", fail);
  });
}

function printSummary(keyword, fetched, skipped, totalClips) {
  console.log("");
  console.log(`✅ Fetched ${fetched} clip${fetched === 1 ? "" : "s"} for "${keyword}"`);
  console.log(`⏭  Skipped ${skipped} (already in manifest)`);
  console.log(`📁 footage/ now contains ${totalClips} total clips`);
}

async function main() {
  const keyword = process.argv[2];
  if (!keyword || !keyword.trim()) {
    console.error('Usage: node scripts/fetch-footage.js "<keyword>"');
    process.exit(1);
  }

  // .env must exist and carry the key. Key never hardcoded.
  if (!fs.existsSync(ENV_PATH)) {
    console.error("❌ Missing .env — copy .env.example and add your PEXELS_API_KEY");
    process.exit(1);
  }
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing PEXELS_API_KEY in .env — copy .env.example and add your PEXELS_API_KEY");
    process.exit(1);
  }

  await fs.ensureDir(FOOTAGE_DIR);
  const manifest = loadManifest();
  const existingIds = new Set(manifest.clips.map((c) => String(c.id)));

  // --- query Pexels ---
  let videos = [];
  try {
    const resp = await axios.get(PEXELS_ENDPOINT, {
      params: {
        query: keyword,
        per_page: PER_PAGE,
        orientation: "landscape",
        size: "large",
      },
      headers: { Authorization: apiKey },
      timeout: 30000,
    });
    videos = (resp.data && resp.data.videos) || [];
  } catch (err) {
    const status = err.response ? ` (HTTP ${err.response.status})` : "";
    console.error(`❌ Pexels API request failed for "${keyword}"${status}: ${err.message}`);
    process.exit(1);
  }

  if (!videos.length) {
    console.warn(`⚠️  No results for "${keyword}" — skipping.`);
    printSummary(keyword, 0, 0, manifest.clips.length);
    return;
  }

  // How many returned results are already in our pool (for the summary).
  const skipped = videos.filter((v) => existingIds.has(String(v.id))).length;

  // Choose up to MAX_SELECT new clips, ranked by priority.
  const candidates = videos.filter((v) => !existingIds.has(String(v.id)));
  const selected = rankCandidates(candidates).slice(0, MAX_SELECT);

  let bar = null;
  if (cliProgress && selected.length) {
    try {
      bar = new cliProgress.SingleBar(
        { format: "  downloading [{bar}] {value}/{total} clips" },
        cliProgress.Presets.shades_classic
      );
      bar.start(selected.length, 0);
    } catch (_) {
      bar = null;
    }
  }

  let fetched = 0;
  for (const v of selected) {
    const best = pickBestFile(v);
    if (!best) {
      console.warn(`⚠️  Clip ${v.id} has no MP4 file — skipping.`);
      if (bar) bar.increment();
      continue;
    }
    const filename = `${v.id}_${sanitizeKeyword(keyword)}.mp4`;
    const dest = path.join(FOOTAGE_DIR, filename);
    try {
      await downloadFile(best.link, dest);
    } catch (err) {
      console.error(`❌ Download failed for clip ${v.id}: ${err.message} — skipping.`);
      await fs.remove(dest).catch(() => {});
      if (bar) bar.increment();
      continue;
    }

    // Upsert: never duplicate, never overwrite an existing entry.
    if (!existingIds.has(String(v.id))) {
      manifest.clips.push({
        id: String(v.id),
        keyword,
        file: `footage/${filename}`,
        width: best.width || v.width,
        height: best.height || v.height,
        duration: v.duration,
        downloaded_at: new Date().toISOString(),
      });
      existingIds.add(String(v.id));
    }
    fetched += 1;
    if (bar) bar.increment();
  }
  if (bar) bar.stop();

  saveManifest(manifest);
  printSummary(keyword, fetched, skipped, manifest.clips.length);
}

main().catch((err) => {
  // Last-resort guard: never leave a cryptic stack trace.
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
