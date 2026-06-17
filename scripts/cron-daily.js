#!/usr/bin/env node
/**
 * cron-daily.js — Spec 6 Part E: run the pipeline for the next unused theme.
 * Hermes cron invokes `npm run cron:daily`. State lives in cron-state.json
 * (machine-local, gitignored). On failure it logs and does NOT advance, so the
 * same theme is retried next run.
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");
const { spawnSync } = require("child_process");
const themes = require("./themes");

const ROOT = path.join(__dirname, "..");
const STATE = path.join(__dirname, "cron-state.json");
const ERR_LOG = path.join(__dirname, "cron-error.log");

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

function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(ERR_LOG, line);
}

function main() {
  const state = loadState();

  if (state.current_index >= themes.length) {
    state.phase = "sustained";
    fs.writeJsonSync(STATE, state, { spaces: 2 });
    console.log(
      `✅ Launch month complete — all ${themes.length} themes done. Phase set to "sustained". ` +
        "Switch the Hermes cron job to a 3–4x/week schedule."
    );
    return;
  }

  const theme = themes[state.current_index];
  console.log(`▶️  cron-daily: theme #${state.current_index + 1}/${themes.length} — "${theme}"`);

  const res = spawnSync("node", ["scripts/pipeline.js", theme], { cwd: ROOT, stdio: "inherit" });

  if (res.status !== 0) {
    const msg = `pipeline failed for theme "${theme}" (index ${state.current_index}, exit ${res.status}) — index NOT advanced, will retry next run.`;
    logError(msg);
    console.error(`❌ ${msg} (logged to scripts/cron-error.log)`);
    process.exit(1);
  }

  state.completed.push(theme);
  state.current_index += 1;
  if (state.current_index >= themes.length) state.phase = "sustained";
  fs.writeJsonSync(STATE, state, { spaces: 2 });

  console.log("");
  console.log(`✅ cron-daily complete for "${theme}".`);
  console.log(`   Progress: ${state.current_index}/${themes.length} | phase: ${state.phase}`);
}

main();
