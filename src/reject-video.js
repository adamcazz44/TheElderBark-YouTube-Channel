"use strict";
/**
 * reject-video.js — delete a rejected video from YouTube and mark the manifest entry "rejected".
 * Usage: npm run reject -- <youtubeId>
 */
const {authedYouTube} = require("./youtube-client");
const manifest = require("./manifest");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npm run reject -- <youtubeId>");
    process.exit(1);
  }
  const youtube = authedYouTube();
  await youtube.videos.delete({id});
  manifest.updateStatusByYoutubeId(id, "rejected");
  console.log(`🗑  Rejected and deleted: ${id}`);
}

main().catch((err) => {
  console.error(`❌ Reject failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
