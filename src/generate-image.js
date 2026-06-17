"use strict";
/**
 * generate-image.js — Spec 2: senior-dog image generator.
 *
 * Primary source: local ComfyUI/Flux (POST a workflow, poll history, download the result).
 * Automatic fallback: Pexels Photos API when ComfyUI is unreachable (or otherwise fails).
 * Both sources are post-processed with sharp to EXACTLY 1080x1920 (center-crop cover).
 *
 *   const { generateDogImage } = require("./generate-image");
 *   await generateDogImage(theme, outputPath); // -> { outputPath, source: "comfyui" | "pexels" }
 *
 * CLI:  npm run generate:image -- "<theme>"
 */
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const TARGET_W = 1080;
const TARGET_H = 1920;
const COMFYUI_URL = (process.env.COMFYUI_URL || "http://localhost:8188").replace(/\/+$/, "");
const WORKFLOW_PATH = path.join(__dirname, "comfyui-workflow.json");

// Prompt templates live in JS (per spec); model names live only in the workflow JSON.
const POSITIVE_TEMPLATE =
  "photorealistic senior golden retriever dog, [THEME], soft natural lighting, " +
  "shallow depth of field, cozy home environment, slightly graying muzzle, wise gentle eyes, " +
  "ultra detailed fur, 8k, portrait composition, no text, no watermark";
const NEGATIVE_PROMPT =
  "cartoon, anime, illustration, text, watermark, human, blurry, distorted, young puppy";

const COMFY_CONNECT_TIMEOUT = 10000; // 10s with no response => treat ComfyUI as unreachable
const COMFY_POLL_INTERVAL = 2000; // poll /history every 2s
const COMFY_POLL_MAX = 120000; // give up after 120s

// --- helpers ----------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Best human-readable reason for an error (axios conn errors can have an empty message). */
function reasonOf(err) {
  if (!err) return "unknown error";
  return err.message || err.code || String(err);
}

/** True for connection-level failures (refused / timed out / DNS) => "ComfyUI offline". */
function isConnError(err) {
  const code = err && err.code;
  if (["ECONNREFUSED", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(code)) {
    return true;
  }
  return !!(err && err.message && /timeout/i.test(err.message));
}

/** Resize/center-crop any image buffer to EXACTLY 1080x1920 PNG at outputPath. */
async function postprocessToTarget(buffer, outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(buffer)
    .resize(TARGET_W, TARGET_H, { fit: "cover", position: "centre" })
    .png()
    .toFile(outputPath);
}

function themeKeyword(theme) {
  return String(theme || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- ComfyUI -----------------------------------------------------------------
function buildWorkflow(theme) {
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
  const positive = POSITIVE_TEMPLATE.replace("[THEME]", theme);
  for (const id of Object.keys(workflow)) {
    const node = workflow[id];
    if (!node || !node.inputs) continue;
    const title = node._meta && node._meta.title;
    if (node.class_type === "CLIPTextEncode" && title === "Positive Prompt") node.inputs.text = positive;
    else if (node.class_type === "CLIPTextEncode" && title === "Negative Prompt") node.inputs.text = NEGATIVE_PROMPT;
    else if (node.class_type === "KSampler") node.inputs.seed = Math.floor(Math.random() * 1e15);
  }
  return workflow;
}

async function generateViaComfyUI(theme, outputPath) {
  const workflow = buildWorkflow(theme);

  // Submit. A short timeout here is the "unreachable" tripwire — generation itself
  // happens asynchronously and is awaited via /history polling below.
  const submit = await axios.post(
    `${COMFYUI_URL}/prompt`,
    { prompt: workflow },
    { timeout: COMFY_CONNECT_TIMEOUT }
  );
  const promptId = submit.data && submit.data.prompt_id;
  if (!promptId) throw new Error("ComfyUI did not return a prompt_id (check workflow / model names in comfyui-workflow.json)");

  const start = Date.now();
  let outputs = null;
  while (Date.now() - start < COMFY_POLL_MAX) {
    await sleep(COMFY_POLL_INTERVAL);
    let hist;
    try {
      hist = await axios.get(`${COMFYUI_URL}/history/${promptId}`, { timeout: 10000 });
    } catch (e) {
      if (isConnError(e)) throw e; // ComfyUI went away mid-render -> bubble up to fallback
      continue; // transient -> keep polling
    }
    const entry = hist.data && hist.data[promptId];
    if (entry && entry.outputs) {
      outputs = entry.outputs;
      break;
    }
  }
  if (!outputs) throw new Error(`ComfyUI render did not finish within ${COMFY_POLL_MAX / 1000}s`);

  let img = null;
  for (const nodeId of Object.keys(outputs)) {
    const imgs = outputs[nodeId] && outputs[nodeId].images;
    if (imgs && imgs.length) {
      img = imgs[0];
      break;
    }
  }
  if (!img) throw new Error("ComfyUI completed but produced no image output");

  const view = await axios.get(`${COMFYUI_URL}/view`, {
    params: { filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" },
    responseType: "arraybuffer",
    timeout: 30000,
  });
  await postprocessToTarget(Buffer.from(view.data), outputPath);
  return { outputPath, source: "comfyui" };
}

// --- Pexels fallback ---------------------------------------------------------
async function pexelsSearch(apiKey, query) {
  const resp = await axios.get("https://api.pexels.com/v1/search", {
    params: { query, orientation: "portrait", per_page: 15, size: "large" },
    headers: { Authorization: apiKey },
    timeout: 30000,
  });
  return (resp.data && resp.data.photos) || [];
}

async function generateViaPexels(theme, outputPath) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY missing from .env");

  let photos = [];
  try {
    photos = await pexelsSearch(apiKey, `senior dog ${themeKeyword(theme)}`.trim());
    if (!photos.length) photos = await pexelsSearch(apiKey, "old dog");
  } catch (e) {
    const status = e.response ? ` (HTTP ${e.response.status})` : "";
    throw new Error(`Pexels search failed${status}: ${e.message}`);
  }
  if (!photos.length) throw new Error("Pexels returned no photos for the query or the 'old dog' fallback");

  // Prefer true-portrait photos (height > width), then highest pixel count.
  photos.sort((a, b) => {
    const ap = a.height > a.width ? 1 : 0;
    const bp = b.height > b.width ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.width * b.height - a.width * a.height;
  });
  const best = photos[0];
  const url = best.src && (best.src.original || best.src.large2x || best.src.large);
  if (!url) throw new Error("Pexels photo had no downloadable src URL");

  let dl;
  try {
    dl = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  } catch (e) {
    throw new Error(`Pexels image download failed: ${e.message}`);
  }
  await postprocessToTarget(Buffer.from(dl.data), outputPath);
  return { outputPath, source: "pexels" };
}

// --- public API --------------------------------------------------------------
/**
 * Generate a 1080x1920 senior-dog PNG for `theme` at `outputPath`.
 * Tries ComfyUI, then falls back to Pexels. Throws (listing both reasons) only if BOTH fail.
 */
async function generateDogImage(theme, outputPath) {
  if (!theme || !String(theme).trim()) throw new Error("theme is required");
  if (!outputPath) throw new Error("outputPath is required");

  let comfyErr = null;
  try {
    return await generateViaComfyUI(theme, outputPath);
  } catch (err) {
    comfyErr = err;
    if (isConnError(err)) console.warn("⚠️  ComfyUI offline — using Pexels fallback");
    else console.warn(`⚠️  ComfyUI error (${reasonOf(err)}) — using Pexels fallback`);
  }

  try {
    return await generateViaPexels(theme, outputPath);
  } catch (pexErr) {
    throw new Error(
      "Image generation failed on BOTH sources — no image produced.\n" +
        `  • ComfyUI: ${reasonOf(comfyErr)}\n` +
        `  • Pexels:  ${reasonOf(pexErr)}`
    );
  }
}

module.exports = { generateDogImage };

// --- CLI ---------------------------------------------------------------------
function compactStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

if (require.main === module) {
  (async () => {
    const theme = process.argv[2];
    if (!theme || !theme.trim()) {
      console.error('Usage: npm run generate:image -- "<theme>"');
      process.exit(1);
    }
    const slug =
      theme.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "image";
    const outputPath = path.join(__dirname, "..", "out", "images", `${compactStamp(new Date())}-${slug}.png`);
    try {
      const res = await generateDogImage(theme, outputPath);
      const meta = await sharp(res.outputPath).metadata();
      console.log("");
      console.log(`✅ Image generated (source: ${res.source})`);
      console.log(`📄 ${path.relative(path.join(__dirname, ".."), res.outputPath)}`);
      console.log(`📐 ${meta.width}×${meta.height}`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  })();
}
