#!/usr/bin/env node
/**
 * upload-youtube.js — Spec 6: upload the latest pending_review render for a theme
 * to YouTube as PRIVATE, set its thumbnail, and record the id/url in the manifest.
 *
 * Usage: node scripts/upload-youtube.js --theme "grinding in obscurity"
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { ROOT, authedYouTube } = require("./youtube-client");

const OUTPUT_MANIFEST = path.join(ROOT, "output", "manifest.json");
const CHANNEL = "The Elder Bark";
const TITLE_MAX = 100;
const CATEGORY_ID = "15"; // Pets & Animals — the natural home for senior-dog comedy discovery

const DESCRIPTION = `Old dogs. Big attitudes. Zero regrets. 🐾

The Elder Bark is comedy for everyone who loves a gray-muzzled, set-in-their-ways senior dog — told from the old dog's own point of view. Selective hearing, couch ownership, and a proud refusal to follow the rules.

Got a senior dog of your own? Find the best food, beds, joint supplements, and gear for older dogs → https://petpickhq.com

#Shorts #seniordog #olddog #dogcomedy #funnydogs #dogsofyoutube #doglovers #petpickhq`;

const TAGS = [
  "senior dog", "old dog", "dog comedy", "funny dogs", "funny dog videos",
  "senior dog humor", "old dog problems", "dog memes", "dogs of youtube",
  "dog lovers", "gray muzzle", "senior pet", "aging dog", "dog shorts", "pets",
];

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--theme") out.theme = a[++i];
    else if (a[i] === "--video") out.video = a[++i];
  }
  return out;
}

function selectHeadline(phrases) {
  const chosen =
    phrases.find((p) => p.style === "short") ||
    phrases.find((p) => p.style === "medium") ||
    phrases[0];
  return (chosen.text || "").trim();
}

function buildTitle(headline) {
  const suffix = ` | ${CHANNEL}`;
  let h = headline;
  if ((h + suffix).length > TITLE_MAX) {
    h = h.slice(0, TITLE_MAX - suffix.length - 1).trimEnd() + "…";
  }
  return h + suffix;
}

function progressBar(read, total) {
  const pct = total ? Math.min(100, Math.round((read / total) * 100)) : 0;
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  process.stdout.write(`\r⬆️  Uploading ${bar} ${pct}% | ${(read / 1048576).toFixed(1)} MB`);
}

function loadManifest() {
  if (!fs.existsSync(OUTPUT_MANIFEST)) return { renders: [] };
  try {
    const d = fs.readJsonSync(OUTPUT_MANIFEST);
    if (d && Array.isArray(d.renders)) return d;
  } catch (_) {
    /* ignore */
  }
  return { renders: [] };
}

function resolveEntry(manifest, args) {
  const entries = manifest.renders;
  if (args.video) {
    const want = args.video.replace(/\\/g, "/").replace(/^\.\//, "");
    const base = path.basename(want);
    return entries.find((e) => e.file === want || path.basename(e.file) === base) || null;
  }
  // most recent pending_review entry matching the theme
  const t = (args.theme || "").toLowerCase().trim();
  let match = null;
  for (const e of entries) {
    const et = (e.theme || "").toLowerCase().trim();
    const themeOk = et === t || et.includes(t) || t.includes(et);
    if (themeOk && (e.status === "pending_review" || !e.status)) match = e; // last = most recent
  }
  return match;
}

async function main() {
  const args = parseArgs();
  if (!args.theme && !args.video) {
    console.error('Usage: node scripts/upload-youtube.js --theme "<theme>"');
    process.exit(1);
  }

  const youtube = authedYouTube(); // exits if creds missing

  const manifest = loadManifest();
  const entry = resolveEntry(manifest, args);
  if (!entry) {
    console.error(`❌ No pending_review render found for ${args.video ? `video "${args.video}"` : `theme "${args.theme}"`}.`);
    process.exit(1);
  }

  const videoAbs = path.join(ROOT, entry.file);
  if (!fs.existsSync(videoAbs)) {
    console.error(`❌ Video file missing on disk: ${entry.file}`);
    process.exit(1);
  }
  const quoteAbs = path.join(ROOT, entry.quote_file);
  if (!fs.existsSync(quoteAbs)) {
    console.error(`❌ Quote file missing on disk: ${entry.quote_file}`);
    process.exit(1);
  }
  const phrases = (fs.readJsonSync(quoteAbs).phrases || []).filter((p) => p && p.text);
  const headline = selectHeadline(phrases);
  const title = buildTitle(headline);

  const total = fs.statSync(videoAbs).size;
  console.log(`📺 Title: "${title}"`);

  let insertRes;
  try {
    insertRes = await youtube.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title, description: DESCRIPTION, tags: TAGS, categoryId: CATEGORY_ID },
          status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
        },
        media: { body: fs.createReadStream(videoAbs) },
      },
      { onUploadProgress: (evt) => progressBar(evt.bytesRead, total) }
    );
  } catch (e) {
    process.stdout.write("\n");
    console.error(`❌ Upload failed: ${e.message}`);
    process.exit(1);
  }
  process.stdout.write("\n");

  const youtubeId = insertRes.data.id;
  console.log(`✅ Video uploaded. YouTube ID: ${youtubeId}`);

  // thumbnail
  if (entry.thumbnail && fs.existsSync(path.join(ROOT, entry.thumbnail))) {
    try {
      await youtube.thumbnails.set({
        videoId: youtubeId,
        media: { body: fs.createReadStream(path.join(ROOT, entry.thumbnail)) },
      });
      console.log("🖼  Thumbnail set.");
    } catch (e) {
      console.error(`⚠️  Thumbnail upload failed (video still uploaded): ${e.message}`);
    }
  } else {
    console.error("⚠️  No thumbnail on disk — skipping thumbnails.set.");
  }

  // manifest
  entry.youtube_id = youtubeId;
  entry.youtube_url = `https://youtu.be/${youtubeId}`;
  entry.status = "pending_review";
  entry.uploaded_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  fs.writeJsonSync(OUTPUT_MANIFEST, manifest, { spaces: 2 });

  console.log("");
  console.log("✅ Upload complete.");
  console.log(`📺 Title:  "${title}"`);
  console.log(`🔗 URL:    https://youtu.be/${youtubeId}`);
  console.log("🔒 Status: Private (pending your QC review)");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

// Exported so other scripts can reuse the canonical description/metadata
// (e.g. backfilling the description on already-uploaded videos).
module.exports = { DESCRIPTION, TAGS, CATEGORY_ID, buildTitle, selectHeadline };
