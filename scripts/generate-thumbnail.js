#!/usr/bin/env node
/**
 * generate-thumbnail.js — Spec 5: cinematic YouTube thumbnail generator.
 *
 * Extracts a still from a rendered video, resizes to 1280x720, and composites a
 * dark/vignetted background with a bold centered headline + accent line → PNG
 * (JPEG fallback if >2MB). Updates output/manifest.json and thumbnails/manifest.json.
 *
 * Usage:
 *   node scripts/generate-thumbnail.js --video "output/<file>.mp4"
 *   node scripts/generate-thumbnail.js --theme "grinding in obscurity"
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { createCanvas, loadImage, registerFont } = require("canvas");

// node-canvas does not resolve Windows system fonts by family name on its own, so the
// "Arial Black"/Impact film-poster weight won't appear unless we register the TTF files.
function tryRegisterFont(file, family) {
  try {
    if (fs.existsSync(file)) registerFont(file, { family });
  } catch (_) {
    /* fall back to default bold sans */
  }
}
tryRegisterFont("C:\\Windows\\Fonts\\ariblk.ttf", "Arial Black");
tryRegisterFont("C:\\Windows\\Fonts\\impact.ttf", "Impact");

const ROOT = path.join(__dirname, "..");
const REMOTION_NM = path.join(ROOT, "remotion", "short-renderer", "node_modules");
const OUTPUT_MANIFEST = path.join(ROOT, "output", "manifest.json");
const FOOTAGE_MANIFEST = path.join(ROOT, "footage", "manifest.json");
const THUMBS_DIR = path.join(ROOT, "thumbnails");
const THUMBS_MANIFEST = path.join(THUMBS_DIR, "manifest.json");
const TEMP_DIR = path.join(ROOT, "temp");

const W = 1280;
const H = 720;
const MAX_BYTES = 2 * 1024 * 1024;

function fwd(p) {
  return p.replace(/\\/g, "/");
}
function sanitize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function stamp(d) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
function words(s) {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--video") out.video = a[++i];
    else if (a[i] === "--theme") out.theme = a[++i];
  }
  return out;
}

/** Bounded BFS for a binary under a node_modules tree; falls back to PATH. */
function findBinary(root, name, cap = 40000) {
  if (!fs.existsSync(root)) return null;
  const queue = [root];
  let count = 0;
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      if (++count > cap) return null;
      const fp = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return fp;
      if (e.isDirectory()) queue.push(fp);
    }
  }
  return null;
}

function loadOutputManifest() {
  if (!fs.existsSync(OUTPUT_MANIFEST)) return { renders: [] };
  try {
    const d = fs.readJsonSync(OUTPUT_MANIFEST);
    if (d && Array.isArray(d.renders)) return d;
  } catch (_) {
    /* ignore */
  }
  return { renders: [] };
}

/** Resolve the render entry to thumbnail, by --video path or --theme. */
function resolveEntry(manifest, args) {
  const entries = manifest.renders;
  if (args.video) {
    const want = fwd(args.video).replace(/^\.\//, "");
    const base = path.basename(want);
    return (
      entries.find((e) => fwd(e.file) === want) ||
      entries.find((e) => path.basename(e.file) === base) ||
      null
    );
  }
  // --theme: most recent (last appended) matching entry
  const t = (args.theme || "").toLowerCase().trim();
  let match = null;
  const tw = new Set(words(args.theme));
  for (const e of entries) {
    const et = (e.theme || "").toLowerCase().trim();
    if (et === t || et.includes(t) || t.includes(et)) match = e; // last wins = most recent
  }
  if (match) return match;
  // word-overlap fallback (also last-wins)
  for (const e of entries) {
    if (words(e.theme).some((w) => tw.has(w))) match = e;
  }
  return match;
}

function selectHeadline(phrases) {
  const chosen =
    phrases.find((p) => p.style === "short") ||
    phrases.find((p) => p.style === "medium") ||
    phrases[0];
  const text = (chosen.text || "").trim();
  const ws = text.split(/\s+/);
  return ws.length > 8 ? ws.slice(0, 8).join(" ") + "…" : text;
}

function wrapLines(ctx, text, maxWidth) {
  const ws = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of ws) {
    const test = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(test).width <= maxWidth) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function extractFrame(video, seekSeconds, outPng, ffmpegBin) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(video).seekInput(seekSeconds).frames(1).output(outPng);
    if (ffmpegBin && ffmpegBin !== "ffmpeg") cmd.setFfmpegPath(ffmpegBin);
    cmd.on("end", () => resolve()).on("error", reject).run();
  });
}

function probeDuration(video) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(video, (err, data) => {
      if (err) return reject(err);
      resolve(Number(data.format && data.format.duration) || 0);
    });
  });
}

function loadFootageManifest() {
  if (!fs.existsSync(FOOTAGE_MANIFEST)) return { clips: [] };
  try {
    const d = fs.readJsonSync(FOOTAGE_MANIFEST);
    if (d && Array.isArray(d.clips)) return d;
  } catch (_) {
    /* ignore */
  }
  return { clips: [] };
}

function loadThumbsManifest() {
  if (!fs.existsSync(THUMBS_MANIFEST)) return { thumbnails: [] };
  try {
    const d = fs.readJsonSync(THUMBS_MANIFEST);
    if (d && Array.isArray(d.thumbnails)) return d;
  } catch (_) {
    /* ignore */
  }
  return { thumbnails: [] };
}

async function main() {
  const args = parseArgs();
  if (!args.video && !args.theme) {
    console.error('Usage: node scripts/generate-thumbnail.js --theme "<theme>" | --video "output/<file>.mp4"');
    process.exit(1);
  }

  const manifest = loadOutputManifest();
  if (!manifest.renders.length) {
    console.error("❌ output/manifest.json has no renders. Render a video first: npm run render:video -- \"<theme>\"");
    process.exit(1);
  }
  const entry = resolveEntry(manifest, args);
  if (!entry) {
    console.error(`❌ No render found for ${args.video ? `video "${args.video}"` : `theme "${args.theme}"`}. Available themes:`);
    [...new Set(manifest.renders.map((e) => e.theme))].forEach((t) => console.error(`   - ${t}`));
    process.exit(1);
  }

  const videoAbs = path.join(ROOT, entry.file);
  if (!fs.existsSync(videoAbs)) {
    console.error(`❌ Source video missing on disk: ${entry.file}`);
    process.exit(1);
  }

  // Headline from the render's quote file.
  const quoteAbs = path.join(ROOT, entry.quote_file);
  if (!fs.existsSync(quoteAbs)) {
    console.error(`❌ Quote file missing on disk: ${entry.quote_file}`);
    process.exit(1);
  }
  const phrases = (fs.readJsonSync(quoteAbs).phrases || []).filter((p) => p && p.text);
  if (!phrases.length) {
    console.error(`❌ Quote file has no phrases: ${entry.quote_file}`);
    process.exit(1);
  }
  const headlineText = selectHeadline(phrases);

  // FFmpeg (prefer a Remotion-bundled binary, else system).
  const ffmpegBin = findBinary(REMOTION_NM, "ffmpeg.exe") || "ffmpeg";
  await fs.ensureDir(TEMP_DIR);
  const now = new Date();
  const ts = stamp(now);
  const extractPng = path.join(TEMP_DIR, `thumb_extract_${ts}.png`);
  const resizedPng = path.join(TEMP_DIR, `thumb_resized_${ts}.png`);

  // Step 1 — extract the background still from a SOURCE footage clip (clean, no text)
  // rather than the rendered MP4, whose every frame carries a baked-in caption that
  // would double up text and clutter the thumbnail ("one powerful phrase, nothing
  // else"). Falls back to the rendered video only if no source clip is resolvable.
  let bgFile = videoAbs;
  let seek;
  const footage = loadFootageManifest();
  const byId = new Map(footage.clips.map((c) => [String(c.id), c]));
  let chosenClip = null;
  for (const id of entry.clips_used || []) {
    const c = byId.get(String(id));
    if (c && fs.existsSync(path.join(ROOT, c.file))) {
      chosenClip = c;
      break;
    }
  }
  if (chosenClip) {
    bgFile = path.join(ROOT, chosenClip.file);
    const cd = Number(chosenClip.duration) || 0;
    seek = cd > 0 ? cd * 0.3 : 1;
  } else {
    let dur = 0;
    try {
      dur = await probeDuration(videoAbs);
    } catch (_) {
      dur = 0;
    }
    seek = dur > 0 ? dur * 0.15 : 2;
  }
  try {
    await extractFrame(bgFile, seek, extractPng, ffmpegBin);
  } catch (err) {
    if (ffmpegBin === "ffmpeg") {
      console.error("❌ FFmpeg not found. Ensure Remotion is installed (Spec 1).");
    } else {
      console.error(`❌ Frame extraction failed: ${err.message}`);
    }
    process.exit(1);
  }
  if (!fs.existsSync(extractPng)) {
    console.error("❌ FFmpeg produced no frame.");
    process.exit(1);
  }

  // Step 2 — resize to 1280x720 cover.
  await sharp(extractPng).resize(W, H, { fit: "cover" }).png().toFile(resizedPng);

  // Step 4 — composite.
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = await loadImage(resizedPng);
  ctx.drawImage(bg, 0, 0, W, H);

  // vignette
  const vg = ctx.createRadialGradient(640, 360, 200, 640, 360, 900);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // bottom gradient
  const bgg = ctx.createLinearGradient(0, 360, 0, 720);
  bgg.addColorStop(0, "rgba(0,0,0,0)");
  bgg.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = bgg;
  ctx.fillRect(0, 360, W, 360);

  // headline
  const wordCount = headlineText.replace("…", "").trim().split(/\s+/).length;
  const fontSize = wordCount <= 5 ? 90 : 72;
  ctx.font = `bold ${fontSize}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxWidth = 1100;
  const lineHeight = fontSize * 1.15;
  const lines = wrapLines(ctx, headlineText, maxWidth);
  const blockH = lines.length * lineHeight;
  const blockTop = 360 - blockH / 2;

  // accent line — 3px tall, 200px wide, 28px above the text block
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillRect(640 - 100, blockTop - 28 - 3, 200, 3);

  // text with manual drop shadow (draw dark offset copy, then white)
  lines.forEach((ln, i) => {
    const cy = blockTop + lineHeight * i + lineHeight / 2;
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillText(ln, 640 + 4, cy + 4);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(ln, 640, cy);
  });

  // Step 5 — save (PNG, JPEG fallback if >2MB).
  await fs.ensureDir(THUMBS_DIR);
  const base = `${sanitize(entry.theme)}_${ts}`;
  let outAbs = path.join(THUMBS_DIR, `${base}.png`);
  fs.writeFileSync(outAbs, canvas.toBuffer("image/png"));
  if (fs.statSync(outAbs).size > MAX_BYTES) {
    const jpgAbs = path.join(THUMBS_DIR, `${base}.jpg`);
    await sharp(outAbs).jpeg({ quality: 92 }).toFile(jpgAbs);
    fs.removeSync(outAbs);
    outAbs = jpgAbs;
  }
  const relThumb = `thumbnails/${path.basename(outAbs)}`;
  const sizeKb = Math.round(fs.statSync(outAbs).size / 1024);

  // cleanup temp
  fs.removeSync(extractPng);
  fs.removeSync(resizedPng);

  // Step 6 — manifests.
  entry.thumbnail = relThumb;
  fs.writeJsonSync(OUTPUT_MANIFEST, manifest, { spaces: 2 });

  const tm = loadThumbsManifest();
  tm.thumbnails.push({
    file: relThumb,
    theme: entry.theme,
    headline: headlineText,
    source_video: entry.file,
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  fs.writeJsonSync(THUMBS_MANIFEST, tm, { spaces: 2 });

  console.log(`✅ Thumbnail generated: ${relThumb}`);
  console.log(`💬 Headline: "${headlineText}"`);
  console.log(`📐 Size: ${W}×${H} | ${sizeKb} KB`);
}

main().catch((err) => {
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
