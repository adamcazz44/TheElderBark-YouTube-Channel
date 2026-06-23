#!/usr/bin/env node
/**
 * fetch-footage.js — footage sourcer (Pexels + Coverr + Mixkit).
 *
 * For a keyword, fetches up to 3 clips from EACH source independently and upserts
 * footage/manifest.json. New entries carry a `source` field and a source-prefixed id
 * (pexels_/coverr_/mixkit_). Existing (legacy, unprefixed) entries are left untouched.
 *
 *   - Pexels: official Video API (needs PEXELS_API_KEY). Search/rank/pick logic unchanged.
 *   - Coverr: keyless site API (https://coverr.co/api/videos). MP4 from the CDN.
 *   - Mixkit: best-effort only — has no usable JSON API; if it doesn't return JSON we
 *     log a warning and skip (never crashes the run).
 *
 * Usage:
 *   node scripts/fetch-footage.js "old dog sleeping"
 *   npm run fetch:footage -- "dog on couch"
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const FOOTAGE_DIR = path.join(ROOT, "footage");
const MANIFEST_PATH = path.join(FOOTAGE_DIR, "manifest.json");

const PEXELS_ENDPOINT = "https://api.pexels.com/videos/search";
const COVERR_ENDPOINT = "https://coverr.co/api/videos";
const MIXKIT_ENDPOINT = "https://mixkit.co/api/clips/search/"; // best-effort; no real API

const PER_SOURCE = 3; // download at most this many NEW clips per source per keyword
const PAGE_SIZE = 10; // candidates to pull per source before dedup/selection
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

require("dotenv").config({ path: ENV_PATH });

function sanitizeKeyword(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { clips: [] };
  try {
    const data = fs.readJsonSync(MANIFEST_PATH);
    if (data && Array.isArray(data.clips)) return data;
  } catch (_) {
    /* corrupt -> start fresh */
  }
  return { clips: [] };
}

function saveManifest(manifest) {
  fs.ensureDirSync(FOOTAGE_DIR);
  fs.writeJsonSync(MANIFEST_PATH, manifest, { spaces: 2 });
}

// --- Pexels helpers (unchanged logic) -------------------------------------
/** Pick the highest-resolution downloadable MP4 from a Pexels video object. */
function pickBestFile(video) {
  const files = (video.video_files || []).filter(
    (f) => f && f.file_type === "video/mp4" && f.link
  );
  if (!files.length) return null;
  files.sort(
    (a, b) => (b.width || 0) - (a.width || 0) || (b.height || 0) - (a.height || 0)
  );
  return files[0];
}

/** Rank: prefer >=1920x1080, then >=10s, then higher-res/longer. */
function rankCandidates(videos) {
  const score = (v) => ({
    hd: v.width >= 1920 && v.height >= 1080 ? 1 : 0,
    long: (v.duration || 0) >= 10 ? 1 : 0,
  });
  return [...videos].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb.hd !== sa.hd) return sb.hd - sa.hd;
    if (sb.long !== sa.long) return sb.long - sa.long;
    return (b.width || 0) - (a.width || 0) || (b.duration || 0) - (a.duration || 0);
  });
}

async function downloadFile(url, dest, headers = {}) {
  const writer = fs.createWriteStream(dest);
  const resp = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 120000,
    maxRedirects: 5,
    headers,
  });
  await new Promise((resolve, reject) => {
    resp.data.pipe(writer);
    let errored = false;
    const fail = (err) => {
      if (errored) return;
      errored = true;
      writer.close();
      reject(err);
    };
    writer.on("finish", resolve);
    writer.on("error", fail);
    resp.data.on("error", fail);
  });
}

// --- Source fetchers: each returns normalized candidates [{rawId,url,width,height,duration}]
//     and NEVER throws (failures are logged and yield []). ---------------------

async function fetchPexels(keyword) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn("⚠️  Pexels: no PEXELS_API_KEY in .env — skipping this source.");
    return [];
  }
  try {
    const resp = await axios.get(PEXELS_ENDPOINT, {
      params: { query: keyword, per_page: PAGE_SIZE, orientation: "landscape", size: "large" },
      headers: { Authorization: apiKey },
      timeout: 30000,
    });
    const videos = (resp.data && resp.data.videos) || [];
    return rankCandidates(videos)
      .map((v) => {
        const best = pickBestFile(v);
        if (!best) return null;
        return {
          rawId: String(v.id),
          url: best.link,
          width: best.width || v.width,
          height: best.height || v.height,
          duration: v.duration,
        };
      })
      .filter(Boolean);
  } catch (err) {
    const status = err.response ? ` (HTTP ${err.response.status})` : "";
    console.warn(`⚠️  Pexels fetch failed for "${keyword}"${status}: ${err.message} — skipping.`);
    return [];
  }
}

async function fetchCoverr(keyword) {
  try {
    const resp = await axios.get(COVERR_ENDPOINT, {
      params: { query: keyword, page: 1, page_size: PAGE_SIZE },
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      timeout: 30000,
    });
    const hits = (resp.data && resp.data.hits) || [];
    return hits
      .filter((h) => h && !h.is_premium && h.base_filename)
      .map((h) => ({
        // MP4 == https://cdn.coverr.co/videos/<base_filename>/1080p.mp4 (verified keyless)
        rawId: String(h.id || h.video_id || h.objectID),
        url: `https://cdn.coverr.co/videos/${h.base_filename}/1080p.mp4`,
        width: Number(h.max_width) || 1920,
        height: Number(h.max_height) || 1080,
        duration: Math.round(parseFloat(h.duration) || 0),
      }));
  } catch (err) {
    const status = err.response ? ` (HTTP ${err.response.status})` : "";
    console.warn(`⚠️  Coverr fetch failed for "${keyword}"${status}: ${err.message} — skipping.`);
    return [];
  }
}

async function fetchMixkit(keyword) {
  // Mixkit has no official/public JSON API. Try the documented feed; if it isn't JSON
  // (it currently 404s with HTML), warn and skip — Mixkit is bonus footage only.
  try {
    const resp = await axios.get(MIXKIT_ENDPOINT, {
      params: { query: keyword, page: 1 },
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      timeout: 20000,
      validateStatus: () => true, // don't throw on 4xx/5xx
    });
    const ct = String(resp.headers["content-type"] || "");
    if (resp.status >= 400 || !ct.includes("json") || typeof resp.data !== "object" || !resp.data) {
      console.warn(`⚠️  Mixkit: no usable JSON feed for "${keyword}" (HTTP ${resp.status}) — skipping (bonus source).`);
      return [];
    }
    // Defensive extraction across plausible shapes if the feed ever returns JSON.
    const items = resp.data.clips || resp.data.results || resp.data.data || resp.data.hits || [];
    return items
      .map((it) => {
        const url = it.url || it.mp4 || (it.video && it.video.url) || (it.download && it.download.url);
        const rawId = String(it.id || it.slug || it.uuid || "");
        if (!url || !rawId) return null;
        return {
          rawId,
          url,
          width: Number(it.width) || 1920,
          height: Number(it.height) || 1080,
          duration: Math.round(Number(it.duration) || 0),
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`⚠️  Mixkit fetch failed for "${keyword}": ${err.message} — skipping (bonus source).`);
    return [];
  }
}

// Per-source download headers (Coverr/Mixkit CDNs prefer a browser UA + referer).
const DL_HEADERS = {
  pexels: {},
  coverr: { "User-Agent": BROWSER_UA, Referer: "https://coverr.co/" },
  mixkit: { "User-Agent": BROWSER_UA, Referer: "https://mixkit.co/" },
};

async function main() {
  const keyword = process.argv[2];
  if (!keyword || !keyword.trim()) {
    console.error('Usage: node scripts/fetch-footage.js "<keyword>"');
    process.exit(1);
  }

  await fs.ensureDir(FOOTAGE_DIR);
  const manifest = loadManifest();
  const existingIds = new Set(manifest.clips.map((c) => String(c.id)));

  const sources = [
    ["pexels", fetchPexels],
    ["coverr", fetchCoverr],
    ["mixkit", fetchMixkit],
  ];
  const perSource = { pexels: 0, coverr: 0, mixkit: 0 };
  let fetched = 0;
  let skipped = 0;

  for (const [name, fetchFn] of sources) {
    let candidates = [];
    try {
      candidates = await fetchFn(keyword);
    } catch (err) {
      // Fetchers shouldn't throw, but guarantee independence regardless.
      console.warn(`⚠️  ${name} fetch error for "${keyword}": ${err.message} — skipping.`);
      candidates = [];
    }

    let added = 0;
    for (const c of candidates) {
      if (added >= PER_SOURCE) break;
      const prefixedId = `${name}_${c.rawId}`;
      // Already present? (Pexels also matches legacy unprefixed ids so we never re-pull.)
      const present =
        existingIds.has(prefixedId) ||
        (name === "pexels" && existingIds.has(String(c.rawId)));
      if (present) {
        skipped += 1;
        continue;
      }

      const filename = `${prefixedId}_${sanitizeKeyword(keyword)}.mp4`;
      const dest = path.join(FOOTAGE_DIR, filename);
      try {
        await downloadFile(c.url, dest, DL_HEADERS[name]);
      } catch (err) {
        console.warn(`⚠️  ${name} download failed for ${c.rawId}: ${err.message} — skipping.`);
        await fs.remove(dest).catch(() => {});
        continue; // try the next candidate
      }
      if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
        console.warn(`⚠️  ${name} ${c.rawId}: empty download — skipping.`);
        await fs.remove(dest).catch(() => {});
        continue;
      }

      manifest.clips.push({
        id: prefixedId,
        keyword,
        source: name,
        file: `footage/${filename}`,
        width: c.width,
        height: c.height,
        duration: c.duration,
        downloaded_at: new Date().toISOString(),
      });
      existingIds.add(prefixedId);
      added += 1;
      fetched += 1;
      perSource[name] += 1;
    }
  }

  saveManifest(manifest);

  console.log("");
  console.log(`✅ Fetched ${fetched} clip${fetched === 1 ? "" : "s"} for "${keyword}"`);
  console.log(`   📦 Pexels: ${perSource.pexels}  |  Coverr: ${perSource.coverr}  |  Mixkit: ${perSource.mixkit}`);
  console.log(`⏭  Skipped ${skipped} (already in manifest)`);
  console.log(`📁 footage/ now contains ${manifest.clips.length} total clips`);
}

main().catch((err) => {
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
