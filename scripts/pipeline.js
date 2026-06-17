#!/usr/bin/env node
/**
 * pipeline.js — Spec 6 Part C: end-to-end for one theme.
 *   quotes (skip if exists) → footage (skip if 5+) → produce (render+thumbnail) → upload.
 *
 * Usage: node scripts/pipeline.js "grinding in obscurity"   (npm run pipeline -- "<theme>")
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const QUOTES_MANIFEST = path.join(ROOT, "quotes", "manifest.json");
const FOOTAGE_MANIFEST = path.join(ROOT, "footage", "manifest.json");
const OUTPUT_MANIFEST = path.join(ROOT, "output", "manifest.json");

function readJsonSafe(p, fallback) {
  try {
    return fs.readJsonSync(p);
  } catch (_) {
    return fallback;
  }
}

function themeMatches(a, b) {
  const x = (a || "").toLowerCase().trim();
  const y = (b || "").toLowerCase().trim();
  return x === y || x.includes(y) || y.includes(x);
}

function run(args, step) {
  const res = spawnSync("node", args, { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`❌ Pipeline failed at step: ${step}`);
    process.exit(1);
  }
}

function main() {
  const theme = process.argv[2];
  if (!theme || !theme.trim()) {
    console.error('Usage: node scripts/pipeline.js "<theme>"');
    process.exit(1);
  }

  // a. quotes — skip if a quote file for this theme already exists.
  const qm = readJsonSafe(QUOTES_MANIFEST, { quote_files: [] });
  const hasQuotes = (qm.quote_files || []).some((q) => themeMatches(q.theme, theme));
  if (hasQuotes) console.log(`⏭  Quotes already exist for "${theme}" — skipping generate.`);
  else run(["scripts/generate-quotes.js", theme], "generate-quotes");

  // b. footage — Shorts strategy reuses the existing clip pool (render-video selects by
  // keyword overlap + backfills from the whole pool), so we skip fetching when the pool
  // already has 5+ clips. This avoids per-theme Pexels calls. Only fetch if the pool is bare.
  const fm = readJsonSafe(FOOTAGE_MANIFEST, { clips: [] });
  const poolSize = (fm.clips || []).length;
  if (poolSize >= 5) console.log(`⏭  Footage pool has ${poolSize} clips — reusing (no fetch).`);
  else run(["scripts/fetch-footage.js", theme], "fetch-footage");

  // c. produce video + thumbnail
  run(["scripts/produce-video.js", theme], "produce-video");

  // d. upload to YouTube (private)
  run(["scripts/upload-youtube.js", "--theme", theme], "upload-youtube");

  // e. master summary
  const om = readJsonSafe(OUTPUT_MANIFEST, { renders: [] });
  let entry = null;
  for (const e of om.renders || []) if (themeMatches(e.theme, theme)) entry = e; // last = newest
  const video = entry ? entry.file.replace(/\//g, "\\") : "(unknown)";
  const thumb = entry && entry.thumbnail ? entry.thumbnail.replace(/\//g, "\\") : "(unknown)";
  const url = entry && entry.youtube_url ? entry.youtube_url : "(unknown)";
  const id = entry && entry.youtube_id ? entry.youtube_id : "<id>";

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎬 PIPELINE COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📋 Theme:     "${theme}"`);
  console.log(`🎥 Video:     ${video}`);
  console.log(`🖼  Thumbnail: ${thumb}`);
  console.log(`📺 YouTube:   ${url}`);
  console.log("🔒 Status:    Private — awaiting your review");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`To publish:  npm run publish -- ${id}`);
  console.log(`To reject:   npm run reject -- ${id}`);
}

main();
