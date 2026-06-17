"use strict";
/**
 * upload-youtube.js — upload a finished Short to YouTube as PRIVATE and set its thumbnail.
 *   const { uploadToYouTube } = require("./upload-youtube");
 *   const youtubeId = await uploadToYouTube(videoPath, thumbnailPath, title, description, hashtags);
 */
const fs = require("fs");
const {authedYouTube} = require("./youtube-client");

const CATEGORY_ID = "22"; // People & Blogs
const TITLE_MAX = 100;
const UPLOAD_TIMEOUT_MS = 600000; // 10 min — a 38s Short can take 60-120s to ingest

function buildTitle(firstCaption) {
  const suffix = " 😂 #ElderBark #Shorts";
  let base = (firstCaption || "The Elder Bark").trim();
  if ((base + suffix).length > TITLE_MAX) {
    base = base.slice(0, TITLE_MAX - suffix.length - 1).trimEnd() + "…";
  }
  return base + suffix;
}

function buildDescription(captions, hashtags) {
  return (
    captions.join("\n") +
    "\n\n" +
    hashtags.join(" ") +
    "\n\nSenior dog comedy. Every day. 🐾\n\nThe Elder Bark"
  );
}

function buildTags(hashtags) {
  return (hashtags || []).map((h) => h.replace(/^#+/, "").trim()).filter(Boolean);
}

async function uploadToYouTube(videoPath, thumbnailPath, title, description, hashtags) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
  const youtube = authedYouTube();
  const tags = buildTags(hashtags);

  const res = await youtube.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {title, description, tags, categoryId: CATEGORY_ID},
        status: {privacyStatus: "private", selfDeclaredMadeForKids: false},
      },
      media: {body: fs.createReadStream(videoPath)},
    },
    {maxContentLength: Infinity, maxBodyLength: Infinity, timeout: UPLOAD_TIMEOUT_MS}
  );

  const youtubeId = res.data.id;
  if (!youtubeId) throw new Error("YouTube upload returned no video id");

  // Custom thumbnail (best-effort — never fail the upload over a thumbnail).
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    try {
      await youtube.thumbnails.set({
        videoId: youtubeId,
        media: {body: fs.createReadStream(thumbnailPath)},
      });
    } catch (e) {
      console.warn(`⚠️  Thumbnail set failed (video still uploaded): ${e.message}`);
    }
  }

  return youtubeId;
}

module.exports = {uploadToYouTube, buildTitle, buildDescription, buildTags, CATEGORY_ID};
