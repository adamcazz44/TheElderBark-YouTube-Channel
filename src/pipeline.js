"use strict";
/**
 * pipeline.js — full Elder Bark pipeline for one Short.
 *   node src/pipeline.js "<theme>" <stone 1-5> [--id <runId>]
 *
 * image -> script -> video -> thumbnail -> upload (Private) -> manifest entry.
 * Resumable: each step is skipped if its output for the run id already exists. A new run
 * (no --id) always gets a fresh timestamped id, so re-running a theme makes a separate Short.
 */
const path = require("path");
const fs = require("fs");

const {generateDogImage} = require("./generate-image");
const {generateScript} = require("./generate-script");
const {renderShort} = require("./render");
const {generateThumbnail} = require("./generate-thumbnail");
const {uploadToYouTube, buildTitle, buildDescription} = require("./upload-youtube");
const manifest = require("./manifest");

const ROOT = path.join(__dirname, "..");

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "short";
}

function compactStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function parseArgs(argv) {
  const out = {theme: null, stone: null, id: null};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--id") out.id = argv[++i];
    else positional.push(argv[i]);
  }
  out.theme = positional[0];
  out.stone = positional[1];
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.theme || !args.theme.trim() || args.stone === undefined) {
    console.error('Usage: npm run pipeline -- "<theme>" <stone 1-5> [--id <runId>]');
    process.exit(1);
  }
  const stone = Number(args.stone);
  if (!Number.isInteger(stone) || stone < 1 || stone > 5) {
    console.error(`❌ stone must be an integer 1-5 (got: ${args.stone})`);
    process.exit(1);
  }
  const theme = args.theme.trim();

  // b. run id
  const id = args.id || `${compactStamp(new Date())}-${slugify(theme)}`;
  const imagePath = path.join(ROOT, "out", "images", `${id}.png`);
  const scriptPath = path.join(ROOT, "out", "scripts", `${id}.json`);
  const videoPath = path.join(ROOT, "out", "videos", `${id}.mp4`);
  const thumbPath = path.join(ROOT, "out", "thumbnails", `${id}.jpg`);

  console.log(`🐾 Pipeline run: ${id}  (theme="${theme}", stone=${stone})\n`);

  // c. image
  if (fs.existsSync(imagePath)) {
    console.log("⏭  [1/6] image exists — skipping generation");
  } else {
    const r = await generateDogImage(theme, imagePath);
    console.log(`🖼  [1/6] image generated (source: ${r.source})`);
  }

  // d. script
  let script;
  if (fs.existsSync(scriptPath)) {
    script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
    console.log("⏭  [2/6] script exists — skipping generation");
  } else {
    script = await generateScript(theme, stone);
    fs.mkdirSync(path.dirname(scriptPath), {recursive: true});
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
    console.log(`📝 [2/6] script generated (${script.captions.length} captions)`);
  }
  const {captions, hashtags} = script;

  // e. video
  if (fs.existsSync(videoPath)) {
    console.log("⏭  [3/6] video exists — skipping render");
  } else {
    await renderShort({imagePath, captions, outputPath: videoPath});
    console.log(`🎬 [3/6] video rendered`);
  }

  // f. thumbnail
  if (fs.existsSync(thumbPath)) {
    console.log("⏭  [4/6] thumbnail exists — skipping");
  } else {
    await generateThumbnail(imagePath, captions, thumbPath);
    console.log(`🖼  [4/6] thumbnail generated`);
  }

  // g. upload (skip if this id already has a youtubeId in the manifest)
  const already = manifest.load().find((e) => e.id === id && e.youtubeId);
  let youtubeId;
  const title = buildTitle(captions[0]);
  if (already) {
    youtubeId = already.youtubeId;
    console.log("⏭  [5/6] already uploaded — skipping");
  } else {
    const description = buildDescription(captions, hashtags);
    console.log("⬆️  [5/6] uploading to YouTube (Private)...");
    youtubeId = await uploadToYouTube(videoPath, thumbPath, title, description, hashtags);

    // h. manifest entry (append-only)
    manifest.append({
      id,
      theme,
      stone,
      imagePath: rel(imagePath),
      videoPath: rel(videoPath),
      thumbnailPath: rel(thumbPath),
      youtubeId,
      status: "private",
      createdAt: new Date().toISOString(),
      title,
      captions,
      hashtags,
    });
    console.log(`💾 [6/6] manifest updated`);
  }

  // i. summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Done! https://studio.youtube.com/video/${youtubeId}/edit`);
  console.log(`Publish: npm run publish -- ${youtubeId}`);
  console.log(`Reject:  npm run reject -- ${youtubeId}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error(`❌ Pipeline failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
