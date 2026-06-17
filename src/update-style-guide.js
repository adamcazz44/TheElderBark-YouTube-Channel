"use strict";
/**
 * update-style-guide.js — merge a winner analysis into src/style-guide.json (which
 * generate-script.js reads on every run) and commit + push it. style-guide.json is the
 * system's persistent memory and IS committed (not gitignored).
 *   const { updateStyleGuide } = require("./update-style-guide");
 *   const { version } = await updateStyleGuide(analysis);
 */
const path = require("path");
const fs = require("fs");
const {execSync} = require("child_process");

const ROOT = path.join(__dirname, "..");
const STYLE_GUIDE_PATH = path.join(ROOT, "src", "style-guide.json");
const ANALYSIS_HISTORY_CAP = 5;
const HIGH_STONES_CAP = 10;

function readStyleGuide() {
  return JSON.parse(fs.readFileSync(STYLE_GUIDE_PATH, "utf8"));
}

async function updateStyleGuide(analysis) {
  const sg = readStyleGuide();
  const u = analysis.styleGuideUpdate || {};

  // Scalars: overwrite when provided.
  if (u.preferredOpeningStyle != null) sg.preferredOpeningStyle = u.preferredOpeningStyle;
  if (u.preferredCaptionCount != null) sg.preferredCaptionCount = u.preferredCaptionCount;
  if (u.emojiGuidance != null) sg.emojiGuidance = u.emojiGuidance;
  if (u.toneNotes != null) sg.toneNotes = u.toneNotes;

  // highPerformingStones: append + dedupe + keep last 10.
  if (Array.isArray(u.highPerformingStones)) {
    const merged = [...(sg.highPerformingStones || []), ...u.highPerformingStones].map(Number).filter(Boolean);
    sg.highPerformingStones = [...new Set(merged)].slice(-HIGH_STONES_CAP);
  }

  sg.version = (Number(sg.version) || 1) + 1;
  sg.lastUpdated = new Date().toISOString();
  sg.lastWinner = analysis.winnerYoutubeId;
  sg.analysisHistory = [...(sg.analysisHistory || []), analysis].slice(-ANALYSIS_HISTORY_CAP);

  fs.writeFileSync(STYLE_GUIDE_PATH, JSON.stringify(sg, null, 2) + "\n");

  // Commit + push (intentional — style-guide.json is tracked).
  const msg = `perf: style guide updated — winner ${analysis.winnerYoutubeId} (+${analysis.outperformancePct}%)`;
  try {
    execSync(`git add ${JSON.stringify(path.relative(ROOT, STYLE_GUIDE_PATH).replace(/\\/g, "/"))}`, {cwd: ROOT, stdio: "pipe"});
    execSync(`git commit -m ${JSON.stringify(msg)}`, {cwd: ROOT, stdio: "pipe"});
    try {
      execSync("git push origin main", {cwd: ROOT, stdio: "pipe"});
    } catch (e) {
      console.warn(`⚠️  style-guide.json committed but push failed: ${e.message}`);
    }
  } catch (e) {
    console.warn(`⚠️  Could not commit style-guide.json: ${e.message}`);
  }

  return {version: sg.version};
}

module.exports = {updateStyleGuide};
