"use strict";
/**
 * analyze-winner.js — ask Claude (Sonnet) WHY the top video outperformed, as structured JSON.
 *   const { analyzeWinner } = require("./analyze-winner");
 *   const analysis = await analyzeWinner(topVideo, fleetAverages);
 */
const path = require("path");
require("dotenv").config({path: path.join(__dirname, "..", ".env")});

const {STEPPING_STONES} = require("./stepping-stones");

const MODEL = process.env.TEB_ANALYSIS_MODEL || "claude-sonnet-4-5";
const MAX_TOKENS = 600;
const TEMPERATURE = 0.3;

const SYSTEM_PROMPT =
  "You are analyzing why a YouTube Short outperformed its peers. Be specific, actionable, and " +
  "pattern-focused. Identify the exact structural elements that likely drove engagement. Return ONLY valid JSON.";

function num(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseJson(text) {
  let t = (text || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const i = t.indexOf("{");
    const j = t.lastIndexOf("}");
    if (i !== -1 && j > i) t = t.slice(i, j + 1);
  }
  return JSON.parse(t);
}

function valid(obj) {
  return (
    obj &&
    Array.isArray(obj.winningPatterns) &&
    obj.winningPatterns.length >= 1 &&
    obj.styleGuideUpdate &&
    typeof obj.styleGuideUpdate === "object"
  );
}

async function analyzeWinner(topVideo, fleetAverages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in .env — cannot analyze winner.");

  const stoneLabel = (STEPPING_STONES[topVideo.stone] && STEPPING_STONES[topVideo.stone].label) || "unknown";
  const score = Number(topVideo.score) || 1;
  const outperformancePct = Math.round((score - 1) * 100);

  const userPrompt =
    "This Elder Bark video outperformed the fleet average.\n" +
    `Fleet averages: views=${num(fleetAverages.views)}, avgViewPercentage=${num(fleetAverages.avgViewPercentage)}%, likes=${num(fleetAverages.likes)}.\n` +
    `Winner: views=${num(topVideo.views)}, avgViewPercentage=${num(topVideo.avgViewPct)}%, likes=${num(topVideo.likes)}.\n` +
    `Outperformance score: ${num(score)}.\n` +
    `Stepping stone: ${topVideo.stone} — ${stoneLabel}.\n` +
    `Theme: ${topVideo.theme}.\n` +
    `Captions: ${JSON.stringify(topVideo.captions)}.\n\n` +
    "Identify 2-3 specific structural patterns that likely drove performance.\n" +
    "Return ONLY this JSON:\n" +
    "{\n" +
    '  "winnerYoutubeId": "...",\n' +
    '  "analyzedAt": "<ISO>",\n' +
    '  "outperformancePct": <number 0-100>,\n' +
    '  "steppingStone": <1-5>,\n' +
    '  "winningPatterns": [\n' +
    "    {\n" +
    '      "element": "opening_line_structure",\n' +
    '      "observation": "<what you observed>",\n' +
    '      "instruction": "<actionable instruction for future scripts>"\n' +
    "    }\n" +
    "  ],\n" +
    '  "styleGuideUpdate": {\n' +
    '    "preferredOpeningStyle": "<string>",\n' +
    '    "preferredCaptionCount": <number>,\n' +
    '    "emojiGuidance": "<string>",\n' +
    '    "toneNotes": "<string>",\n' +
    '    "highPerformingStones": [<stone numbers>]\n' +
    "  }\n" +
    "}";

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({apiKey});

  let parsed = null;
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
    const reminder = attempt === 2 ? "\n\nYour previous response was not valid JSON. Respond with ONLY the JSON object." : "";
    let resp;
    try {
      resp = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        messages: [{role: "user", content: userPrompt + reminder}],
      });
    } catch (err) {
      const status = err && err.status ? ` (HTTP ${err.status})` : "";
      throw new Error(`Anthropic analysis call failed${status}: ${err && err.message ? err.message : err}`);
    }
    lastRaw = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    try {
      const obj = parseJson(lastRaw);
      if (valid(obj)) parsed = obj;
    } catch (_) {
      /* retry */
    }
  }

  if (!parsed) throw new Error("Winner analysis returned no valid JSON after one retry.\n" + lastRaw);

  // Authoritative fields (don't trust the model for identity / numbers).
  parsed.winnerYoutubeId = topVideo.youtubeId;
  parsed.analyzedAt = new Date().toISOString();
  parsed.outperformancePct = outperformancePct;
  parsed.steppingStone = topVideo.stone;
  return parsed;
}

module.exports = {analyzeWinner};
