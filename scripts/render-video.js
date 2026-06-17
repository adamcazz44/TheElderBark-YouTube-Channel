#!/usr/bin/env node
/**
 * render-video.js — Spec 4: motion video render orchestrator.
 *
 * Consumes a quotes JSON file + footage clips and renders the Remotion `ElderBarkShort`
 * composition to output/<sanitized_theme>_<ts>.mp4, then upserts output/manifest.json.
 * Reads only — never modifies the footage/quotes manifests.
 *
 * Usage:
 *   node scripts/render-video.js "selective hearing in old age"
 *   npm run render:video -- "selective hearing in old age"
 */
"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REMOTION_DIR = path.join(ROOT, "remotion", "short-renderer");
const ENTRY = "src/index.ts"; // relative to REMOTION_DIR
const QUOTES_MANIFEST = path.join(ROOT, "quotes", "manifest.json");
const FOOTAGE_MANIFEST = path.join(ROOT, "footage", "manifest.json");
const MUSIC_DIR = path.join(ROOT, "music");
const OUTPUT_DIR = path.join(ROOT, "output");
const OUTPUT_MANIFEST = path.join(OUTPUT_DIR, "manifest.json");
const PROPS_FILE = path.join(ROOT, ".render-props.json"); // no spaces in this path
const RENDER_PUBLIC = path.join(ROOT, ".render-public"); // lean per-render public dir

const MIN_CLIPS = 5;
const MIN_MATCHING = 3;

// Target Short length (seconds). Viral *entertaining* Shorts cluster at ~28-33s and retention
// drops off sharply past ~45s, so we treat the 10 generated captions as a POOL and render a
// tight subset near TARGET, never exceeding MAX (keeps us in the high-retention band and safely
// under YouTube's 60s Shorts boundary). Override per-run: TEB_TARGET_SECONDS / TEB_MAX_SECONDS.
const TARGET_SECONDS = Number(process.env.TEB_TARGET_SECONDS) || 30;
const MAX_SECONDS = Number(process.env.TEB_MAX_SECONDS) || 35;

function fwd(p) {
  return p.replace(/\\/g, "/");
}

function sanitizeTheme(theme) {
  return theme.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestampCompact(d) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function words(s) {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function fmtDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  return `${m}m ${pad(s % 60)}s`;
}

function readJson(p) {
  return fs.readJsonSync(p);
}

/** Find the quote-manifest entry whose theme best matches the requested theme. */
function matchQuoteEntry(entries, theme) {
  const t = theme.toLowerCase().trim();
  // 1) exact (case-insensitive)
  let hit = entries.find((e) => (e.theme || "").toLowerCase().trim() === t);
  if (hit) return hit;
  // 2) substring either direction
  hit = entries.find((e) => {
    const et = (e.theme || "").toLowerCase();
    return et.includes(t) || t.includes(et);
  });
  if (hit) return hit;
  // 3) best word overlap
  const tw = new Set(words(theme));
  let best = null;
  let bestScore = 0;
  for (const e of entries) {
    const score = words(e.theme).filter((w) => tw.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Select clips: prefer keyword-overlap with the theme; backfill to >=MIN_CLIPS. */
function selectClips(allClips, theme) {
  const tw = new Set(words(theme));
  const matching = allClips.filter((c) => words(c.keyword).some((w) => tw.has(w)));
  let selected = matching;
  if (matching.length < MIN_MATCHING) {
    const picked = [...matching];
    const seen = new Set(picked.map((c) => String(c.id)));
    for (const c of allClips) {
      if (picked.length >= MIN_CLIPS) break;
      if (!seen.has(String(c.id))) {
        picked.push(c);
        seen.add(String(c.id));
      }
    }
    selected = picked;
  }
  return selected;
}

/**
 * Trim the caption pool to a Short of ~target seconds without exceeding hardMax. Walks the
 * captions in order, accumulating until close to target; skips any single caption that would
 * blow the ceiling (a shorter later one may still fit). Always returns at least one caption.
 */
function selectPhrasesForTarget(allPhrases, target, hardMax) {
  const picked = [];
  let total = 0;
  for (const p of allPhrases) {
    const d = Number(p.screen_duration_seconds) || 0;
    if (d <= 0) continue;
    if (total + d > hardMax) continue; // would blow the ceiling — skip, try a shorter one
    picked.push(p);
    total += d;
    if (total >= target) break; // close enough to target — stop
  }
  if (!picked.length && allPhrases.length) picked.push(allPhrases[0]); // never render empty
  return picked;
}

function pickMusic() {
  if (!fs.existsSync(MUSIC_DIR)) return null;
  const tracks = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|wav)$/i.test(f));
  if (!tracks.length) return null;
  return path.join(MUSIC_DIR, tracks[Math.floor(Math.random() * tracks.length)]);
}

function loadOutputManifest() {
  if (!fs.existsSync(OUTPUT_MANIFEST)) return { renders: [] };
  try {
    const data = readJson(OUTPUT_MANIFEST);
    if (data && Array.isArray(data.renders)) return data;
  } catch (_) {
    /* corrupt -> start fresh */
  }
  return { renders: [] };
}

function main() {
  const theme = process.argv[2];
  if (!theme || !theme.trim()) {
    console.error('Usage: node scripts/render-video.js "<theme>"');
    process.exit(1);
  }

  // --- quotes ---
  if (!fs.existsSync(QUOTES_MANIFEST)) {
    console.error(
      "❌ No quotes/manifest.json found. Generate quotes first: npm run generate:quotes -- \"<theme>\""
    );
    process.exit(1);
  }
  const quotesManifest = readJson(QUOTES_MANIFEST);
  const quoteEntries = (quotesManifest && quotesManifest.quote_files) || [];
  if (!quoteEntries.length) {
    console.error("❌ quotes/manifest.json has no entries. Run npm run generate:quotes first.");
    process.exit(1);
  }
  const quoteEntry = matchQuoteEntry(quoteEntries, theme);
  if (!quoteEntry) {
    console.error(`❌ No quote file matches "${theme}". Available themes:`);
    for (const e of quoteEntries) console.error(`   - ${e.theme}`);
    process.exit(1);
  }
  const quoteFileAbs = path.join(ROOT, quoteEntry.file);
  if (!fs.existsSync(quoteFileAbs)) {
    console.error(`❌ Quote file missing on disk: ${quoteEntry.file}`);
    process.exit(1);
  }
  const allPhrases = readJson(quoteFileAbs).phrases || [];
  if (!allPhrases.length) {
    console.error(`❌ Quote file has no phrases: ${quoteEntry.file}`);
    process.exit(1);
  }
  // Trim the caption pool to a ~TARGET_SECONDS Short (viral entertaining retention band).
  const phrases = selectPhrasesForTarget(allPhrases, TARGET_SECONDS, MAX_SECONDS);

  // --- footage ---
  if (!fs.existsSync(FOOTAGE_MANIFEST)) {
    console.error(
      "❌ No footage/manifest.json found. Fetch footage first: npm run fetch:footage -- \"<keyword>\""
    );
    process.exit(1);
  }
  const allClips = (readJson(FOOTAGE_MANIFEST).clips || []).filter((c) =>
    fs.existsSync(path.join(ROOT, c.file))
  );
  if (!allClips.length) {
    console.error("❌ No usable footage clips on disk. Run npm run fetch:footage first.");
    process.exit(1);
  }
  const selected = selectClips(allClips, theme);
  // Paths are RELATIVE to the project root; the render passes --public-dir=<root> and the
  // composition resolves them with staticFile(). (OffthreadVideo serves assets over the
  // bundler's HTTP server — raw absolute/file:// paths are not served.)
  const clips = selected.map((c) => ({
    id: String(c.id),
    file: fwd(c.file),
    duration: Number(c.duration) || 10,
    width: Number(c.width) || 1920,
    height: Number(c.height) || 1080,
  }));

  // --- music (optional) ---
  const musicAbs = pickMusic();
  const musicFile = musicAbs ? `music/${path.basename(musicAbs)}` : undefined;

  // --- props + output paths ---
  const now = new Date();
  const stamp = timestampCompact(now);
  const base = `${sanitizeTheme(theme)}_${stamp}`;
  const outAbs = path.join(OUTPUT_DIR, `${base}.mp4`);
  fs.ensureDirSync(OUTPUT_DIR);

  const props = { phrases, clips, theme };
  if (musicFile) props.musicFile = musicFile;
  fs.writeJsonSync(PROPS_FILE, props, { spaces: 0 });

  // Build a LEAN public dir containing ONLY the assets this render uses, so Remotion
  // copies a few MB instead of the entire ~4.7 GB project root (node_modules/.git/all
  // 45 clips). staticFile() paths ("footage/x.mp4", "music/y.mp3") resolve inside it.
  fs.emptyDirSync(RENDER_PUBLIC);
  for (const c of selected) {
    fs.copySync(path.join(ROOT, c.file), path.join(RENDER_PUBLIC, c.file));
  }
  if (musicAbs) {
    fs.copySync(musicAbs, path.join(RENDER_PUBLIC, "music", path.basename(musicAbs)));
  }

  const videoSeconds = phrases.reduce(
    (sum, p) => sum + (Number(p.screen_duration_seconds) || 0),
    0
  );

  console.log(`🎬 Rendering "${theme}" — ${phrases.length}/${allPhrases.length} captions (~${Math.round(videoSeconds)}s, target ${TARGET_SECONDS}s), ${clips.length} clips${musicFile ? ", with music" : ", silent"}...`);

  const res = spawnSync(
    "npx",
    [
      "remotion",
      "render",
      ENTRY,
      "ElderBarkShort",
      fwd(outAbs),
      `--props=${fwd(PROPS_FILE)}`,
      `--public-dir=${fwd(RENDER_PUBLIC)}`,
    ],
    { cwd: REMOTION_DIR, stdio: "inherit", shell: true }
  );

  fs.removeSync(PROPS_FILE);
  fs.removeSync(RENDER_PUBLIC);

  if (res.status !== 0) {
    console.error("❌ Remotion render failed (see output above).");
    process.exit(1);
  }
  if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
    console.error("❌ Render reported success but output file is missing/empty.");
    process.exit(1);
  }

  // --- upsert output manifest ---
  const outputManifest = loadOutputManifest();
  outputManifest.renders.push({
    file: `output/${base}.mp4`,
    theme,
    quote_file: quoteEntry.file,
    captions_used: phrases.length,
    captions_pool: allPhrases.length,
    clips_used: clips.map((c) => c.id),
    music_used: musicAbs ? `music/${path.basename(musicAbs)}` : null,
    duration_seconds: videoSeconds,
    rendered_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    status: "pending_review",
  });
  fs.writeJsonSync(OUTPUT_MANIFEST, outputManifest, { spaces: 2 });

  console.log("");
  console.log(`✅ Rendered: output/${base}.mp4`);
  console.log(
    `⏱  Duration: ${fmtDuration(videoSeconds)} | Phrases: ${phrases.length} | Clips used: ${clips.length}`
  );
}

try {
  main();
} catch (err) {
  fs.removeSync(PROPS_FILE);
  fs.removeSync(RENDER_PUBLIC);
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
