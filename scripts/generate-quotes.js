#!/usr/bin/env node
/**
 * generate-quotes.js — Spec 3: quote & phrase generator.
 *
 * Reads the canonical generation rules from
 *   scripts/hermes-skills/generate-quotes/SKILL.md   (single source of truth)
 * calls the Anthropic Messages API directly via @anthropic-ai/sdk, validates the JSON,
 * writes quotes/<sanitized_theme>_<YYYYMMDD_HHmmss>.json, and upserts quotes/manifest.json.
 *
 * Usage:
 *   node scripts/generate-quotes.js "grinding in obscurity"
 *   npm run generate:quotes -- "building wealth alone"
 */
"use strict";

const path = require("path");
const fs = require("fs-extra");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const QUOTES_DIR = path.join(ROOT, "quotes");
const MANIFEST_PATH = path.join(QUOTES_DIR, "manifest.json");
const SKILL_PATH = path.join(__dirname, "hermes-skills", "generate-quotes", "SKILL.md");

// claude-sonnet-4-6 is the current latest Sonnet — strong, cheap comedy writer.
// Overridable via env (e.g. TEB_QUOTES_MODEL=claude-opus-4-8 for punchier jokes).
const MODEL = process.env.TEB_QUOTES_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const TEMPERATURE = 1.0; // creative variety; supported on Sonnet 4.6

const ALLOWED_EMOTIONS = ["smug", "grumpy", "lazy", "dramatic", "mischievous", "indignant"];
const FORBIDDEN = [
  "rainbow bridge", "passing away", "dying", "doggo", "pupper",
  "borking", "heckin", "good boy",
];

require("dotenv").config({ path: ENV_PATH });

// --- helpers ----------------------------------------------------------------
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

/** Extract the verbatim system prompt from SKILL.md (between PROMPT_START/PROMPT_END). */
function loadSystemPrompt() {
  const md = fs.readFileSync(SKILL_PATH, "utf8");
  const m = md.match(/<!--\s*PROMPT_START\s*-->([\s\S]*?)<!--\s*PROMPT_END\s*-->/);
  if (!m) {
    throw new Error(`Could not find PROMPT_START/PROMPT_END block in ${SKILL_PATH}`);
  }
  return m[1].trim();
}

/** Tolerant JSON extraction: strips code fences / stray prose around the object. */
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

function validateShape(obj) {
  if (!obj || !Array.isArray(obj.phrases) || obj.phrases.length !== 10) return false;
  return obj.phrases.every(
    (p) =>
      p &&
      typeof p.text === "string" &&
      typeof p.style === "string" &&
      typeof p.emotion === "string" &&
      typeof p.screen_duration_seconds === "number"
  );
}

/** Non-fatal quality audit — logs warnings so a human can eyeball the seed run. */
function auditQuality(phrases) {
  const warnings = [];
  const styleCounts = { short: 0, medium: 0, long: 0 };
  for (const p of phrases) {
    if (styleCounts[p.style] !== undefined) styleCounts[p.style] += 1;
    if (!ALLOWED_EMOTIONS.includes(p.emotion)) {
      warnings.push(`unexpected emotion tag: "${p.emotion}"`);
    }
    const lower = p.text.toLowerCase();
    for (const bad of FORBIDDEN) {
      if (lower.includes(bad)) warnings.push(`forbidden phrase "${bad}" in: ${p.text}`);
    }
  }
  if (styleCounts.short < 3) warnings.push(`only ${styleCounts.short} short phrases (need >=3)`);
  if (styleCounts.medium < 3) warnings.push(`only ${styleCounts.medium} medium phrases (need >=3)`);
  return warnings;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { quote_files: [] };
  try {
    const data = fs.readJsonSync(MANIFEST_PATH);
    if (data && Array.isArray(data.quote_files)) return data;
  } catch (_) {
    /* corrupt -> start fresh */
  }
  return { quote_files: [] };
}

async function callModel(client, systemPrompt, userMessage) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function main() {
  const theme = process.argv[2];
  if (!theme || !theme.trim()) {
    console.error('Usage: node scripts/generate-quotes.js "<theme>"');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing ANTHROPIC_API_KEY in .env");
    process.exit(1);
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  await fs.ensureDir(QUOTES_DIR);
  const systemPrompt = loadSystemPrompt();
  const userMessage = `Theme: "${theme}"\nGenerate the 10 phrases now as a single JSON object.`;

  // Attempt 1, then exactly one retry on invalid JSON (spec Part B / constraints).
  let parsed = null;
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
    const reminder =
      attempt === 2
        ? "\n\nYour previous response was not valid JSON matching the schema. " +
          "Respond with ONLY the JSON object — no prose, no markdown fences."
        : "";
    lastRaw = await callModel(client, systemPrompt, userMessage + reminder);
    try {
      const obj = parseJson(lastRaw);
      if (validateShape(obj)) parsed = obj;
      else if (attempt === 2) console.warn("⚠️  JSON parsed but failed schema validation.");
    } catch (_) {
      if (attempt === 1) console.warn("⚠️  Invalid JSON on first attempt — retrying once...");
    }
  }

  if (!parsed) {
    const stamp = timestampCompact(new Date());
    const errPath = path.join(QUOTES_DIR, `${sanitizeTheme(theme)}_${stamp}.error`);
    fs.writeFileSync(errPath, lastRaw, "utf8");
    console.error(`❌ Could not get valid JSON after retry. Raw response saved to ${path.relative(ROOT, errPath)}`);
    process.exit(1);
  }

  // Non-fatal quality warnings.
  for (const w of auditQuality(parsed.phrases)) console.warn(`⚠️  ${w}`);

  // Authoritative theme + timestamp (don't trust the model for these).
  const now = new Date();
  const generatedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const output = { theme, generated_at: generatedAt, phrases: parsed.phrases };

  const filename = `${sanitizeTheme(theme)}_${timestampCompact(now)}.json`;
  const relFile = `quotes/${filename}`;
  fs.writeJsonSync(path.join(QUOTES_DIR, filename), output, { spaces: 2 });

  // Upsert manifest (append a new entry per generation run).
  const manifest = loadManifest();
  manifest.quote_files.push({
    file: relFile,
    theme,
    phrase_count: output.phrases.length,
    generated_at: generatedAt,
  });
  fs.writeJsonSync(MANIFEST_PATH, manifest, { spaces: 2 });

  console.log("");
  console.log(`✅ Generated ${output.phrases.length} phrases for "${theme}"`);
  console.log(`📄 Saved to ${relFile}`);
}

main().catch((err) => {
  console.error(`❌ Unexpected error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
