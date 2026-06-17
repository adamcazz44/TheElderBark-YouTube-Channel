"use strict";
/**
 * generate-thumbnail.js — compose a 1280x720 YouTube thumbnail from the dog image + captions.
 *   const { generateThumbnail } = require("./generate-thumbnail");
 *   await generateThumbnail(imagePath, captions, outputPath); // -> outputPath (jpg q90)
 *
 * Text is overlaid via an SVG composited with sharp (no extra canvas dependency). librsvg can't
 * render color emoji, so emoji are stripped from thumbnail text (the video captions keep them).
 *
 * CLI (for testing): node src/generate-thumbnail.js <imagePath> <outputPath> "<caption>" ...
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const W = 1280;
const H = 720;

function stripEmoji(s) {
  return String(s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (t.length <= maxChars || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function generateThumbnail(imagePath, captions, outputPath) {
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`Thumbnail base image not found: ${imagePath}`);
  if (!Array.isArray(captions) || !captions.length) throw new Error("captions (non-empty array) is required");

  const base = await sharp(imagePath).resize(W, H, {fit: "cover", position: "centre"}).toBuffer();

  const headline = stripEmoji(captions[0]) || "The Elder Bark";
  const fontSize = headline.length <= 22 ? 84 : 64;
  const maxChars = Math.max(8, Math.floor((W - 160) / (fontSize * 0.55)));
  const lines = wrap(headline, maxChars).slice(0, 3);
  const lineHeight = fontSize * 1.15;
  const blockH = lines.length * lineHeight;
  const baselineStart = 560 - blockH / 2 + fontSize * 0.8; // lower third, centered on y≈560

  const captionTspans = lines
    .map(
      (ln, i) =>
        `<text x="${W / 2}" y="${baselineStart + i * lineHeight}" text-anchor="middle" ` +
        `font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${fontSize}" ` +
        `fill="#ffffff" filter="url(#sh)">${xmlEscape(ln)}</text>`
    )
    .join("\n  ");

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.9"/>
    </filter>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="50%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${Math.round(H * 0.45)}" width="${W}" height="${Math.round(H * 0.55)}" fill="url(#grad)"/>
  ${captionTspans}
  <text x="${W - 28}" y="52" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="34" fill="#ffffff" filter="url(#sh)">The Elder Bark</text>
</svg>`;

  await fs.promises.mkdir(path.dirname(outputPath), {recursive: true});
  await sharp(base)
    .composite([{input: Buffer.from(svg), top: 0, left: 0}])
    .jpeg({quality: 90})
    .toFile(outputPath);
  return outputPath;
}

module.exports = {generateThumbnail};

// --- CLI (testing) ---
if (require.main === module) {
  (async () => {
    const imagePath = process.argv[2];
    const outputPath = process.argv[3];
    const captions = process.argv.slice(4);
    if (!imagePath || !outputPath || !captions.length) {
      console.error('Usage: node src/generate-thumbnail.js <imagePath> <outputPath> "<caption>" ...');
      process.exit(1);
    }
    try {
      await generateThumbnail(imagePath, captions, outputPath);
      const meta = await sharp(outputPath).metadata();
      console.log(`✅ Thumbnail: ${outputPath} (${meta.width}×${meta.height})`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  })();
}
