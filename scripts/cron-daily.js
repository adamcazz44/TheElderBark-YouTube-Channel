#!/usr/bin/env node
/**
 * cron-daily.js — run the pipeline for the next theme, chosen by TONE ROTATION.
 *
 * themes.js is now an array of { theme, tone } objects (5 tones x 10 = 50). Each run:
 *   1. pick today's tone from tone-state.json — lowest count, ties random, never the
 *      same tone two runs in a row;
 *   2. pick the first theme of that tone not yet in cron-state.completed[]
 *      (falling back to any unused theme of any tone);
 *   3. run the pipeline with the theme STRING (never the object);
 *   4. on success: advance cron-state.completed[] and bump tone-state counts/history.
 *
 * Both state files are machine-local (gitignored). On pipeline failure nothing is advanced,
 * so the same tone/theme is retried next run.
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { spawnSync } = require("child_process");
const themes = require("./themes");

const ROOT = path.join(__dirname, "..");
const STATE = path.join(__dirname, "cron-state.json");
const TONE_STATE = path.join(__dirname, "tone-state.json");
const ERR_LOG = path.join(__dirname, "cron-error.log");
const HISTORY_CAP = 30;

const TONES = ["classic", "warm", "silly", "proud", "relatable"];
const TONE_INFO = {
  classic: "dry, wry, weary-elder humor",
  warm: "heartfelt, nostalgic, tender",
  silly: "goofy, absurd, lighthearted",
  proud: "dignified, boastful, self-satisfied",
  relatable: "slice-of-life moments every dog owner recognizes",
};

// --- state I/O ---------------------------------------------------------------
function loadState() {
  if (fs.existsSync(STATE)) {
    try {
      const s = fs.readJsonSync(STATE);
      if (s && Array.isArray(s.completed) && typeof s.current_index === "number") return s;
    } catch (_) {
      /* recreate below */
    }
  }
  return { completed: [], current_index: 0, phase: "launch" };
}

function defaultToneState() {
  return { history: [], counts: { classic: 0, warm: 0, silly: 0, proud: 0, relatable: 0 } };
}

function loadToneState() {
  if (fs.existsSync(TONE_STATE)) {
    try {
      const s = fs.readJsonSync(TONE_STATE);
      if (s && s.counts && Array.isArray(s.history)) return { ...defaultToneState(), ...s };
    } catch (_) {
      /* recreate below */
    }
  }
  return defaultToneState();
}

function logError(msg) {
  fs.appendFileSync(ERR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

// --- rotation logic (pure, exported for tests) -------------------------------
/** Lowest-count tone, ties broken at random, never the same tone as the last history entry. */
function pickTone(toneState) {
  const counts = toneState.counts || {};
  const last = toneState.history && toneState.history.length
    ? toneState.history[toneState.history.length - 1].tone
    : null;
  let candidates = TONES.filter((t) => t !== last);
  if (!candidates.length) candidates = [...TONES]; // safety (shouldn't happen with 5 tones)
  const minCount = Math.min(...candidates.map((t) => counts[t] || 0));
  const tied = candidates.filter((t) => (counts[t] || 0) === minCount);
  return tied[Math.floor(Math.random() * tied.length)];
}

/** First unused theme of `todaysTone`; else any unused theme (any tone); else null. */
function selectTheme(themeList, todaysTone, completed) {
  const used = new Set(completed);
  return (
    themeList.find((t) => t.tone === todaysTone && !used.has(t.theme)) ||
    themeList.find((t) => !used.has(t.theme)) ||
    null
  );
}

/** Record a successful run into tone-state (count + capped history). Mutates + returns it. */
function recordToneRun(toneState, tone, theme) {
  toneState.counts[tone] = (toneState.counts[tone] || 0) + 1;
  toneState.history.push({ tone, theme, date: new Date().toISOString() });
  if (toneState.history.length > HISTORY_CAP) {
    toneState.history = toneState.history.slice(-HISTORY_CAP);
  }
  return toneState;
}

// --- main --------------------------------------------------------------------
function main() {
  const state = loadState();
  const toneState = loadToneState();

  const todaysTone = pickTone(toneState);
  const chosen = selectTheme(themes, todaysTone, state.completed);

  if (!chosen) {
    state.phase = "sustained";
    fs.writeJsonSync(STATE, state, { spaces: 2 });
    console.log(
      `✅ All ${themes.length} themes used — phase set to "sustained". ` +
        "Switch the Hermes cron job to a 3–4x/week schedule (or reset completed[])."
    );
    return;
  }

  // The recorded tone is the chosen theme's actual tone (== todaysTone unless we fell back).
  const tone = chosen.tone;
  const theme = chosen.theme; // STRING passed to the pipeline — never the object

  console.log(`▶️  Tone: ${tone.toUpperCase()} — ${TONE_INFO[tone]}`);
  console.log(`📋 Theme: "${theme}"  (${state.completed.length + 1}/${themes.length})\n`);

  const res = spawnSync("node", ["scripts/pipeline.js", theme], { cwd: ROOT, stdio: "inherit" });

  if (res.status !== 0) {
    const msg = `pipeline failed for tone "${tone}" theme "${theme}" (exit ${res.status}) — state NOT advanced, will retry next run.`;
    logError(msg);
    console.error(`❌ ${msg} (logged to scripts/cron-error.log)`);
    process.exit(1);
  }

  // success: advance cron-state + tone-state
  state.completed.push(theme);
  state.current_index += 1;
  if (state.current_index >= themes.length) state.phase = "sustained";
  fs.writeJsonSync(STATE, state, { spaces: 2 });

  recordToneRun(toneState, tone, theme);
  fs.writeJsonSync(TONE_STATE, toneState, { spaces: 2 });

  console.log("");
  console.log(`✅ cron-daily complete — Tone ${tone.toUpperCase()} | "${theme}".`);
  console.log(`   Progress: ${state.completed.length}/${themes.length} | tone counts: ${JSON.stringify(toneState.counts)}`);
}

module.exports = { TONES, TONE_INFO, pickTone, selectTheme, recordToneRun };

if (require.main === module) {
  main();
}
