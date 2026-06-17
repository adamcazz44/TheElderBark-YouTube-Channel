"use strict";
/**
 * cron-runner.js — daily automation: pick today's stone+theme via a fair random rotation
 * (all 5 stones get a turn before any repeats, new shuffle each cycle), run the full pipeline,
 * and print a machine-parseable final status line for the Hermes cron job.
 *
 * Usage: npm run cron:daily
 */
const path = require("path");
const fs = require("fs");
const {exec} = require("child_process");
const {STEPPING_STONES} = require("./stepping-stones");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "out", "cron-state.json");
const ERR_LOG = path.join(ROOT, "out", "cron-error.log");
const MANIFEST_PATH = path.join(ROOT, "out", "manifest.json");
const HISTORY_CAP = 30;
const THEMES_PER_STONE = 6;

function defaultState() {
  return {
    currentCycle: [],
    stoneProgress: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
    lastRun: null,
    history: [],
  };
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (s && Array.isArray(s.currentCycle) && s.stoneProgress) return {...defaultState(), ...s};
  } catch (_) {
    /* missing/corrupt -> defaults */
  }
  return defaultState();
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), {recursive: true});
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Fisher-Yates in-place shuffle (plain JS, no lodash). */
function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Mutate `state` to select today's stone + theme (steps a-e of the spec). Returns
 * {todayStone, theme, stoneLabel}. Caller persists the state before running the pipeline.
 */
function advanceState(state) {
  // a. start a fresh shuffled cycle when the current one is exhausted
  if (!state.currentCycle.length) {
    state.currentCycle = fisherYates([1, 2, 3, 4, 5]);
    console.log(`🔀 New cycle: stones in order [${state.currentCycle.join(",")}]`);
  }
  // b. today's stone
  const todayStone = state.currentCycle.shift();
  // c. today's theme (sub-themes used sequentially)
  const progress = state.stoneProgress[todayStone] || 0;
  const theme = STEPPING_STONES[todayStone].themes[progress];
  // d. advance the sub-theme pointer
  state.stoneProgress[todayStone] = progress + 1;
  // e. reset when all 6 sub-themes have been used
  if (state.stoneProgress[todayStone] >= THEMES_PER_STONE) {
    state.stoneProgress[todayStone] = 0;
    console.log(`🔄 Stone ${todayStone} themes exhausted — resetting to first theme`);
  }
  return {todayStone, theme, stoneLabel: STEPPING_STONES[todayStone].label};
}

function runPipeline(theme, stone) {
  return new Promise((resolve) => {
    exec(
      `node src/pipeline.js "${theme}" ${stone}`,
      {cwd: ROOT, maxBuffer: 64 * 1024 * 1024},
      (err, stdout, stderr) => resolve({err, stdout: stdout || "", stderr: stderr || ""})
    );
  });
}

function parseYoutubeId(stdout) {
  const m = stdout.match(/studio\.youtube\.com\/video\/([A-Za-z0-9_-]+)\/edit/);
  return m ? m[1] : null;
}

/** pipeline.js doesn't print the title; read it from the manifest entry it just appended. */
function titleFromManifest(youtubeId, fallback) {
  try {
    const arr = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const e = Array.isArray(arr) ? arr.find((x) => x.youtubeId === youtubeId) : null;
    if (e && e.title) return e.title;
  } catch (_) {
    /* fall through */
  }
  return fallback;
}

function logError(msg) {
  fs.mkdirSync(path.dirname(ERR_LOG), {recursive: true});
  fs.appendFileSync(ERR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

async function main() {
  const state = loadState();
  const {todayStone, theme, stoneLabel} = advanceState(state);

  // f. persist state BEFORE running the pipeline (crash safety: never re-use the same stone)
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log(`▶️  Stone ${todayStone} (${stoneLabel}) — theme "${theme}"\n`);

  // g. run the pipeline
  const {err, stdout, stderr} = await runPipeline(theme, todayStone);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (err) {
    // i. failure: log full detail, print FAILED line, exit 1
    const summary = ((stderr || err.message || "unknown error").trim().split("\n").pop() || "").slice(0, 200);
    logError(`Stone ${todayStone} "${theme}" failed: ${err.message}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);
    console.log(`FAILED: ${summary}`);
    process.exit(1);
  }

  // h. success: parse id + title, append history (cap 30), save, print SUCCESS line
  const youtubeId = parseYoutubeId(stdout);
  if (!youtubeId) {
    logError(`Stone ${todayStone} "${theme}": pipeline exited 0 but no YouTube id found in stdout.\n${stdout}`);
    console.log("FAILED: pipeline succeeded but no YouTube video id was found in output");
    process.exit(1);
  }
  const title = titleFromManifest(youtubeId, theme);

  state.history.push({stone: todayStone, theme, youtubeId, title, ranAt: new Date().toISOString()});
  if (state.history.length > HISTORY_CAP) state.history = state.history.slice(-HISTORY_CAP);
  saveState(state);

  console.log(
    `SUCCESS: ${youtubeId} | Stone ${todayStone}: ${stoneLabel} | ${theme} | https://studio.youtube.com/video/${youtubeId}/edit`
  );
}

module.exports = {STEPPING_STONES, defaultState, loadState, saveState, fisherYates, advanceState};

if (require.main === module) {
  main().catch((e) => {
    logError(`cron-runner crashed: ${e && e.stack ? e.stack : e}`);
    console.log(`FAILED: ${String((e && e.message) || e).slice(0, 200)}`);
    process.exit(1);
  });
}
