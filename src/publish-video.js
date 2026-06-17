"use strict";
/**
 * publish-video.js — flip an uploaded (private) video to Public after QC.
 * Usage: npm run publish -- <youtubeId>
 */
const {authedYouTube} = require("./youtube-client");
const manifest = require("./manifest");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npm run publish -- <youtubeId>");
    process.exit(1);
  }
  const youtube = authedYouTube();
  await youtube.videos.update({
    part: ["status"],
    requestBody: {id, status: {privacyStatus: "public", selfDeclaredMadeForKids: false}},
  });
  manifest.updateStatusByYoutubeId(id, "published");
  console.log(`✅ Published: https://youtu.be/${id}`);
  console.log("🌍 Status: Public");
}

main().catch((err) => {
  console.error(`❌ Publish failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
