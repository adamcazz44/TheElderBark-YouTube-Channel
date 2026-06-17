#!/usr/bin/env node
/**
 * reject-video.js — Spec 6: delete a rejected video from YouTube after QC.
 * Usage: node scripts/reject-video.js <youtube_id>   (npm run reject -- <id>)
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { ROOT, authedYouTube } = require("./youtube-client");

const OUTPUT_MANIFEST = path.join(ROOT, "output", "manifest.json");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: node scripts/reject-video.js <youtube_id>");
    process.exit(1);
  }
  const youtube = authedYouTube();

  try {
    await youtube.videos.delete({ id });
  } catch (e) {
    console.error(`❌ Delete failed: ${e.message}`);
    process.exit(1);
  }

  if (fs.existsSync(OUTPUT_MANIFEST)) {
    try {
      const m = fs.readJsonSync(OUTPUT_MANIFEST);
      const e = (m.renders || []).find((r) => r.youtube_id === id);
      if (e) {
        e.status = "rejected";
        fs.writeJsonSync(OUTPUT_MANIFEST, m, { spaces: 2 });
      }
    } catch (_) {
      /* best-effort */
    }
  }

  console.log(`🗑  Rejected and deleted: ${id}`);
}

main().catch((err) => {
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
