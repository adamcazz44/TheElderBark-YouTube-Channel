#!/usr/bin/env node
/**
 * produce-video.js — Spec 5 Part B: chain render (Spec 4) + thumbnail (Spec 5).
 *
 * Usage:
 *   node scripts/produce-video.js "grinding in obscurity"
 *   npm run produce -- "grinding in obscurity"
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUTPUT_MANIFEST = path.join(ROOT, "output", "manifest.json");

function run(scriptArgs, label) {
  const res = spawnSync("node", scriptArgs, { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`❌ ${label} failed (exit ${res.status}).`);
    process.exit(1);
  }
}

function main() {
  const theme = process.argv[2];
  if (!theme || !theme.trim()) {
    console.error('Usage: node scripts/produce-video.js "<theme>"');
    process.exit(1);
  }

  run(["scripts/render-video.js", theme], "render-video");
  run(["scripts/generate-thumbnail.js", "--theme", theme], "generate-thumbnail");

  // Read back the most recent matching render entry for the combined summary.
  let video = "(unknown)";
  let thumbnail = "(unknown)";
  try {
    const m = fs.readJsonSync(OUTPUT_MANIFEST);
    const t = theme.toLowerCase().trim();
    let entry = null;
    for (const e of m.renders) {
      const et = (e.theme || "").toLowerCase().trim();
      if (et === t || et.includes(t) || t.includes(et)) entry = e; // last = most recent
    }
    if (entry) {
      video = entry.file.replace(/\//g, "\\");
      if (entry.thumbnail) thumbnail = entry.thumbnail.replace(/\//g, "\\");
    }
  } catch (_) {
    /* summary best-effort */
  }

  console.log("");
  console.log(`🎬 Video:     ${video}`);
  console.log(`🖼  Thumbnail: ${thumbnail}`);
  console.log("✅ Ready for QC review.");
}

main();
