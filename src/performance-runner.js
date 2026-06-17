"use strict";
/**
 * performance-runner.js — weekly orchestrator (npm run check:performance).
 * checkPerformance -> (if winner) analyzeWinner -> updateStyleGuide. Prints a machine-parseable
 * final line (WINNER: / NO_WINNER: / SKIPPED:) for the Hermes weekly cron, and always writes
 * out/performance-report.json.
 */
const path = require("path");
const fs = require("fs");
const {checkPerformance} = require("./check-performance");
const {analyzeWinner} = require("./analyze-winner");
const {updateStyleGuide} = require("./update-style-guide");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "out", "performance-report.json");

function saveReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), {recursive: true});
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

async function main() {
  const ranAt = new Date().toISOString();
  const result = await checkPerformance();

  if (result.triggered) {
    const analysis = await analyzeWinner(result.topVideo, result.fleetAverages);
    const {version} = await updateStyleGuide(analysis);
    saveReport({
      ranAt,
      result: "winner",
      topVideo: result.topVideo,
      analysis,
      allVideos: result.allVideos,
      fleetAverages: result.fleetAverages,
    });
    console.log(
      `WINNER: ${analysis.winnerYoutubeId} | +${analysis.outperformancePct}% | ${analysis.winningPatterns.length} patterns | style guide updated (v${version})`
    );
    return;
  }

  if (result.reason === "no_winner") {
    saveReport({ranAt, result: "no_winner", allVideos: result.allVideos, fleetAverages: result.fleetAverages});
    console.log(`NO_WINNER: ${result.allVideos.length} videos measured | top score ${result.topScore.toFixed(3)} | threshold 1.05`);
    return;
  }

  // insufficient_data
  saveReport({ranAt, result: "skipped", count: result.count});
  console.log(`SKIPPED: only ${result.count} public videos (need 3+)`);
}

main().catch((err) => {
  console.error(`❌ Performance check failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
