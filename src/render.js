"use strict";
/**
 * render.js — headless renderer for the ElderBarkShort composition.
 *
 *   npm run render  -- --props '{"imagePath":"out/images/x.png","captions":["..."]}'
 *   npm run preview                       # renders frames 0-150 (~5s) to out/preview.mp4
 *
 * Exports renderShort() so the pipeline (Spec 5) can render in-process instead of shelling out.
 *
 * Remotion serves assets from a "public dir", not arbitrary paths, so we stage a lean per-render
 * public dir (image + the committed background.mp3), bundle against it, and the composition
 * resolves both via staticFile().
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "index.ts");
const MUSIC_SRC = path.join(ROOT, "src", "assets", "music", "background.mp3");
const RENDER_PUBLIC = path.join(ROOT, ".render-public");
const PREVIEW_FRAMES = 150; // ~5s @ 30fps

const SAMPLE_CAPTIONS = [
  "Day 47.",
  "The stairs have not moved.",
  "I have not moved.",
  "We are at a standstill.",
  "I respect them now. 🏔️",
];

function compactStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Render the ElderBarkShort composition to outputPath.
 *   opts: { imagePath, captions, outputPath, preview? }
 * Returns the outputPath.
 */
async function renderShort({imagePath, captions, outputPath, preview = false}) {
  if (!imagePath) throw new Error("renderShort: imagePath is required");
  if (!Array.isArray(captions) || !captions.length) throw new Error("renderShort: captions (non-empty array) is required");
  if (!outputPath) throw new Error("renderShort: outputPath is required");

  const imgAbs = path.isAbsolute(imagePath) ? imagePath : path.join(ROOT, imagePath);
  if (!fs.existsSync(imgAbs)) throw new Error(`Image not found: ${imagePath}`);
  if (!fs.existsSync(MUSIC_SRC)) {
    throw new Error(`Music asset missing: ${path.relative(ROOT, MUSIC_SRC)} — commit a track there (Spec 4).`);
  }

  // Stage the lean public dir: image + music.
  fs.rmSync(RENDER_PUBLIC, {recursive: true, force: true});
  fs.mkdirSync(RENDER_PUBLIC, {recursive: true});
  const ext = path.extname(imgAbs).toLowerCase() || ".png";
  const imageRel = `image${ext}`;
  fs.copyFileSync(imgAbs, path.join(RENDER_PUBLIC, imageRel));
  fs.copyFileSync(MUSIC_SRC, path.join(RENDER_PUBLIC, "background.mp3"));

  const inputProps = {imagePath: imageRel, captions};

  const {bundle} = await import("@remotion/bundler");
  const {selectComposition, renderMedia} = await import("@remotion/renderer");

  try {
    console.log("📦 Bundling Remotion project...");
    const serveUrl = await bundle({entryPoint: ENTRY, publicDir: RENDER_PUBLIC});
    const composition = await selectComposition({serveUrl, id: "ElderBarkShort", inputProps});

    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    const frameRange = preview ? [0, PREVIEW_FRAMES] : undefined;
    console.log(
      `🎥 Rendering ${preview ? `PREVIEW (frames 0-${PREVIEW_FRAMES})` : `${composition.durationInFrames} frames`}, ` +
        `${composition.width}x${composition.height} -> ${path.relative(ROOT, outputPath)}`
    );

    let lastPct = -10;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      frameRange,
      onProgress: ({progress}) => {
        const pct = Math.round(progress * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          process.stdout.write(`  ...${pct}%\n`);
        }
      },
    });
  } finally {
    fs.rmSync(RENDER_PUBLIC, {recursive: true, force: true});
  }
  return outputPath;
}

module.exports = {renderShort};

// --- CLI ---------------------------------------------------------------------
function parseArgs(argv) {
  const out = {preview: false, props: null};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--preview") out.preview = true;
    else if (argv[i] === "--props") out.props = argv[++i];
  }
  return out;
}

function latestImage() {
  const dir = path.join(ROOT, "out", "images");
  if (!fs.existsSync(dir)) return null;
  const imgs = fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => ({f, t: fs.statSync(path.join(dir, f)).mtimeMs}))
    .sort((a, b) => b.t - a.t);
  return imgs.length ? path.join(dir, imgs[0].f) : null;
}

function resolveProps(args) {
  let props = null;
  if (args.props) {
    try {
      props = JSON.parse(args.props);
    } catch (e) {
      throw new Error(`--props is not valid JSON: ${e.message}`);
    }
  }
  if (!props) {
    const img = latestImage();
    if (!img) {
      throw new Error(
        'No --props given and no image in out/images/. Pass --props \'{"imagePath":"...","captions":[...]}\' or run npm run generate:image first.'
      );
    }
    props = {imagePath: img, captions: SAMPLE_CAPTIONS};
    console.log(`ℹ️  No --props — using latest image ${path.relative(ROOT, img)} + sample captions.`);
  }
  if (!props.imagePath || typeof props.imagePath !== "string") throw new Error("props.imagePath (string) is required");
  if (!Array.isArray(props.captions) || !props.captions.length) throw new Error("props.captions (non-empty array) is required");
  return props;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    try {
      const props = resolveProps(args);
      const outputPath = args.preview
        ? path.join(ROOT, "out", "preview.mp4")
        : path.join(ROOT, "out", "videos", `${compactStamp(new Date())}.mp4`);
      await renderShort({imagePath: props.imagePath, captions: props.captions, outputPath, preview: args.preview});
      console.log(`✅ Rendered: ${path.relative(ROOT, outputPath)}`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  })();
}
