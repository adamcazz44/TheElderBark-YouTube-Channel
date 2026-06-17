"use strict";
/**
 * manifest.js — out/manifest.json is an APPEND-ONLY JSON array of video entries.
 * Never overwrites existing entries; publish/reject only mutate the matching entry's status.
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "out", "manifest.json");

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    if (Array.isArray(data)) return data;
  } catch (_) {
    /* missing/corrupt -> empty */
  }
  return [];
}

function save(arr) {
  fs.mkdirSync(path.dirname(MANIFEST), {recursive: true});
  fs.writeFileSync(MANIFEST, JSON.stringify(arr, null, 2));
}

function append(entry) {
  const arr = load();
  arr.push(entry);
  save(arr);
  return entry;
}

function updateStatusByYoutubeId(youtubeId, status) {
  const arr = load();
  let updated = false;
  for (const e of arr) {
    if (e.youtubeId === youtubeId) {
      e.status = status;
      updated = true;
    }
  }
  if (updated) save(arr);
  return updated;
}

module.exports = {MANIFEST, load, save, append, updateStatusByYoutubeId};
