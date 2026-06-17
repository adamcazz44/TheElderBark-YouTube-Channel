#!/usr/bin/env node
/**
 * publish-video.js — Spec 6: flip an uploaded (private) video to public after QC.
 * Usage: node scripts/publish-video.js <youtube_id>   (npm run publish -- <id>)
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { ROOT, authedYouTube } = require("./youtube-client");

const OUTPUT_MANIFEST = path.join(ROOT, "output", "manifest.json");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: node scripts/publish-video.js <youtube_id>");
    process.exit(1);
  }
  const youtube = authedYouTube();

  try {
    await youtube.videos.update({
      part: ["status"],
      requestBody: { id, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } },
    });
  } catch (e) {
    console.error(`❌ Publish failed: ${e.message}`);
    process.exit(1);
  }

  // manifest
  if (fs.existsSync(OUTPUT_MANIFEST)) {
    try {
      const m = fs.readJsonSync(OUTPUT_MANIFEST);
      const e = (m.renders || []).find((r) => r.youtube_id === id);
      if (e) {
        e.status = "approved";
        fs.writeJsonSync(OUTPUT_MANIFEST, m, { spaces: 2 });
      }
    } catch (_) {
      /* best-effort */
    }
  }

  console.log(`✅ Published: https://youtu.be/${id}`);
  console.log("🌍 Status: Public");
}

main().catch((err) => {
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
