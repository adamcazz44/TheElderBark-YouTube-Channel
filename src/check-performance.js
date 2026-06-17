"use strict";
/**
 * check-performance.js — pull YouTube Analytics for published Shorts, score them against the
 * fleet average, and flag a winner (composite score > 1.05).
 *
 *   const { checkPerformance } = require("./check-performance");
 *
 * TEST SEAM: set TEB_PERF_FIXTURE=<path to JSON {youtubeId: {views, avgViewPct, likes}}> to feed
 * mock analytics instead of calling the API (lets the winner/no-winner logic be tested offline).
 */
const path = require("path");
const fs = require("fs");
const {authedAnalytics} = require("./youtube-client");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "out", "manifest.json");
const CHANNEL_ID = "UCvzO2650P6uOs95U5ChhfNA";
const MIN_VIDEOS = 3;
const MIN_AGE_MS = 48 * 60 * 60 * 1000; // 48h
const WIN_THRESHOLD = 1.05;

function loadManifest() {
  try {
    const arr = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (Array.isArray(arr)) return arr;
  } catch (_) {
    /* empty */
  }
  return [];
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** Pull one video's analytics (or mock from the fixture). Returns {views, avgViewPct, likes}. */
async function fetchAnalytics(youtubeId, analytics, today) {
  const fixturePath = process.env.TEB_PERF_FIXTURE;
  if (fixturePath) {
    const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const v = data[youtubeId] || {};
    return {views: Number(v.views) || 0, avgViewPct: Number(v.avgViewPct) || 0, likes: Number(v.likes) || 0};
  }
  const res = await analytics.reports.query({
    ids: `channel==${CHANNEL_ID}`,
    dimensions: "video",
    metrics: "views,averageViewDuration,averageViewPercentage,likes",
    filters: `video==${youtubeId}`,
    startDate: "2020-01-01",
    endDate: today,
  });
  const headers = (res.data.columnHeaders || []).map((h) => h.name);
  const row = (res.data.rows || [])[0] || [];
  const get = (name) => {
    const i = headers.indexOf(name);
    return i >= 0 ? Number(row[i]) || 0 : 0;
  };
  return {views: get("views"), avgViewPct: get("averageViewPercentage"), likes: get("likes")};
}

/** Composite score vs fleet averages. Division-by-zero safe; drops likes weight if avg_likes==0. */
function scoreVideo(v, fleet) {
  const r = (val, avg) => (avg > 0 ? val / avg : 1);
  if (fleet.avg_likes === 0) {
    return r(v.views, fleet.avg_views) * 0.5 + r(v.avgViewPct, fleet.avg_pct) * 0.5;
  }
  return r(v.views, fleet.avg_views) * 0.4 + r(v.avgViewPct, fleet.avg_pct) * 0.4 + r(v.likes, fleet.avg_likes) * 0.2;
}

function computeFleet(stats) {
  return {
    avg_views: mean(stats.map((s) => s.views)),
    avg_pct: mean(stats.map((s) => s.avgViewPct)),
    avg_likes: mean(stats.map((s) => s.likes)),
  };
}

async function checkPerformance() {
  const manifest = loadManifest();
  const now = Date.now();
  const eligible = manifest.filter(
    (e) =>
      e.status === "public" &&
      e.youtubeId &&
      e.createdAt &&
      now - new Date(e.createdAt).getTime() >= MIN_AGE_MS
  );

  if (eligible.length < MIN_VIDEOS) {
    return {triggered: false, reason: "insufficient_data", count: eligible.length};
  }

  const analytics = process.env.TEB_PERF_FIXTURE ? null : authedAnalytics();
  const today = new Date().toISOString().slice(0, 10);

  const stats = [];
  for (const e of eligible) {
    const a = await fetchAnalytics(e.youtubeId, analytics, today);
    stats.push({entry: e, youtubeId: e.youtubeId, ...a});
  }

  const fleet = computeFleet(stats);
  const fleetAverages = {views: fleet.avg_views, avgViewPercentage: fleet.avg_pct, likes: fleet.avg_likes};
  const scored = stats
    .map((s) => ({...s, score: scoreVideo(s, fleet)}))
    .sort((a, b) => b.score - a.score);

  const allVideos = scored.map((s) => ({
    youtubeId: s.youtubeId,
    score: s.score,
    views: s.views,
    avgViewPct: s.avgViewPct,
    likes: s.likes,
  }));

  const top = scored[0];
  if (top.score > WIN_THRESHOLD) {
    return {
      triggered: true,
      topVideo: {
        ...top.entry,
        score: top.score,
        views: top.views,
        avgViewPct: top.avgViewPct,
        likes: top.likes,
      },
      fleetAverages,
      allVideos,
    };
  }
  return {triggered: false, reason: "no_winner", topScore: top.score, fleetAverages, allVideos};
}

module.exports = {checkPerformance, scoreVideo, computeFleet, fetchAnalytics, WIN_THRESHOLD};
