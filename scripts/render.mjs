// Headless render of the ElderBarkShort composition to out/test.mp4 via @remotion/renderer
// (programmatic — no browser window opens). Run with: npm run render
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {bundle} from "@remotion/bundler";
import {selectComposition, renderMedia} from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const COMPOSITION_ID = "ElderBarkShort";

async function main() {
  console.log("📦 Bundling Remotion project...");
  const serveUrl = await bundle({entryPoint: path.join(ROOT, "src", "index.ts")});

  console.log(`🎬 Selecting composition "${COMPOSITION_ID}"...`);
  const composition = await selectComposition({serveUrl, id: COMPOSITION_ID});

  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, {recursive: true});
  const outputLocation = path.join(outDir, "test.mp4");

  console.log(`🎥 Rendering ${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames -> out/test.mp4`);
  await renderMedia({composition, serveUrl, codec: "h264", outputLocation});

  console.log(`✅ Rendered: ${outputLocation}`);
}

main().catch((err) => {
  console.error("❌ Render failed:", err);
  process.exit(1);
});
