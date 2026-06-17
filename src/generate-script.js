"use strict";
/**
 * generate-script.js — Spec 3: senior-dog inner-monologue caption generator.
 *
 * Calls the Anthropic API (Claude Haiku) to write a dry, deadpan 4-6 line inner monologue
 * for a senior dog, given a THEME and a STEPPING STONE (1-5). The stone is an emotional-
 * resonance layer: it shapes the tone so the video quietly addresses a real anxiety senior-dog
 * owners feel — without ever naming it. A living src/style-guide.json injects winning patterns.
 *
 *   const { generateScript } = require("./generate-script");
 *   await generateScript(theme, stone); // -> { stone, theme, captions[], hashtags[] }
 *
 * CLI:  npm run generate:script -- "<theme>" <stone>
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const MODEL = process.env.TEB_SCRIPT_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = 300;
const TEMPERATURE = 0.9;
const STYLE_GUIDE_PATH = path.join(__dirname, "style-guide.json");

const MIN_CAPTIONS = 4;
const MAX_CAPTIONS = 6;
const MAX_WORDS_PER_CAPTION = 8;
const MIN_HASHTAGS = 6;
const MAX_HASHTAGS = 10;

const DEFAULT_HASHTAGS = [
  "#ElderBark", "#SeniorDog", "#DogsOfTikTok", "#DogComedy",
  "#OldDogEnergy", "#Shorts", "#FunnyDogs", "#SeniorPets",
];

// The owner-anxiety each stepping stone speaks to. Injected into the system prompt; NEVER
// stated explicitly in the captions — it only sets the emotional register.
const STONE_CONTEXT = {
  1: "The owner watching this worries whether your behavior is normal or a warning sign. Your monologue should make them laugh and feel like their worry is universal and valid.",
  2: "The owner watching this is managing your pain and mobility. Your monologue should make them laugh at the indignity of aging while feeling understood.",
  3: "The owner watching this agonizes over what to feed you. Your monologue should make them laugh at your strong opinions about food while validating their obsession with getting it right.",
  4: "The owner watching this worries about your mental sharpness. Your monologue should make them laugh at your senior moments while reassuring them it's okay to find it funny.",
  5: "The owner watching this carries quiet grief about your aging. Your monologue should be warm, funny, and quietly affirming — life is good, you are loved, today is enough.",
};

const DEFAULT_STYLE_GUIDE = {
  version: 1,
  lastUpdated: null,
  lastWinner: null,
  preferredOpeningStyle: "Short declarative statement, 3 words or fewer.",
  preferredCaptionCount: 5,
  emojiGuidance: "Maximum 1 emoji per caption. Use sparingly.",
  toneNotes: "Dry, grave seriousness about mundane problems. No puns.",
  highPerformingStones: [],
  analysisHistory: [],
};

const PERSONA = [
  "You are the dry, deadpan inner monologue of a senior dog. You narrate your own life with grave,",
  "understated seriousness — treating mundane problems (stairs, naps, dinner, a closed door) as profound",
  "matters of state. The comedy is the contrast: total gravity about trivial things, plus the quiet truth",
  "that you are old now and entirely at peace running this household on your own terms.",
  "",
  "Hard rules:",
  "- First person, the dog's inner voice. Never describe the dog from the outside.",
  "- Dry and deadpan. NO puns. NO 'woof', NO 'bork', NO 'doggo', no baby-talk, no exclaiming.",
  "- Short, clipped lines. Understatement over exaggeration.",
  "- The humor must mirror a real anxiety the owner secretly feels about their aging dog — voice what",
  "  the owner is thinking — WITHOUT ever naming that anxiety.",
].join("\n");

// --- style guide -------------------------------------------------------------
function loadStyleGuide() {
  try {
    if (fs.existsSync(STYLE_GUIDE_PATH)) {
      const sg = JSON.parse(fs.readFileSync(STYLE_GUIDE_PATH, "utf8"));
      return { ...DEFAULT_STYLE_GUIDE, ...sg };
    }
  } catch (_) {
    /* corrupt -> recreate with defaults below */
  }
  fs.writeFileSync(STYLE_GUIDE_PATH, JSON.stringify(DEFAULT_STYLE_GUIDE, null, 2));
  return { ...DEFAULT_STYLE_GUIDE };
}

function buildStyleGuideInstructions(sg) {
  let s =
    "Current winning formula based on performance data:\n" +
    `- Opening style: ${sg.preferredOpeningStyle}\n` +
    `- Caption count: aim for ${sg.preferredCaptionCount}\n` +
    `- Emoji guidance: ${sg.emojiGuidance}\n` +
    `- Tone: ${sg.toneNotes}`;
  if (Array.isArray(sg.highPerformingStones) && sg.highPerformingStones.length) {
    s +=
      `\nStepping stones ${sg.highPerformingStones.join(", ")} have performed best — ` +
      "lean into their emotional register when possible.";
  }
  return s;
}

// --- parsing / coercion ------------------------------------------------------
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

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeHashtag(h) {
  const tag = String(h).trim().replace(/\s+/g, "");
  return tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`;
}

/** Validate structure; return {captions, hashtags} or null (null => retry). */
function coerceStructure(obj) {
  if (!obj || typeof obj !== "object") return null;
  let captions = Array.isArray(obj.captions)
    ? obj.captions.filter((c) => typeof c === "string" && c.trim())
    : null;
  let hashtags = Array.isArray(obj.hashtags)
    ? obj.hashtags.filter((h) => typeof h === "string" && h.trim())
    : null;
  if (!captions || captions.length < MIN_CAPTIONS) return null; // can't fabricate -> retry
  if (!hashtags || hashtags.length === 0) return null;
  if (captions.length > MAX_CAPTIONS) captions = captions.slice(0, MAX_CAPTIONS);
  return { captions, hashtags };
}

/** Apply guarantees so the returned object always meets the schema/limits. */
function finalize(coerced, theme, stone) {
  // Keep captions intact (never truncate mid-sentence — that breaks the joke). The word limit
  // is enforced via the retry in generateScript; a rare survivor is kept whole, with a warning.
  const captions = coerced.captions.map((c) => c.trim());
  const overLong = captions.filter((c) => wordCount(c) > MAX_WORDS_PER_CAPTION);
  if (overLong.length) {
    console.warn(`⚠️  ${overLong.length} caption(s) still exceed ${MAX_WORDS_PER_CAPTION} words after retry (kept intact for coherence).`);
  }

  // hashtags: normalize, dedupe (case-insensitive), then pad/slice to [MIN, MAX].
  const seen = new Set();
  let hashtags = [];
  for (const h of coerced.hashtags.map(normalizeHashtag)) {
    const key = h.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      hashtags.push(h);
    }
  }
  for (const h of DEFAULT_HASHTAGS) {
    if (hashtags.length >= MIN_HASHTAGS) break;
    if (!seen.has(h.toLowerCase())) {
      seen.add(h.toLowerCase());
      hashtags.push(h);
    }
  }
  if (hashtags.length > MAX_HASHTAGS) hashtags = hashtags.slice(0, MAX_HASHTAGS);

  return { stone, theme, captions, hashtags };
}

// --- model call --------------------------------------------------------------
async function callModel(client, system, userMessage) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  return (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// --- public API --------------------------------------------------------------
async function generateScript(theme, stone) {
  if (!theme || !String(theme).trim()) throw new Error("theme is required");
  const stoneNum = Number(stone);
  if (!Number.isInteger(stoneNum) || stoneNum < 1 || stoneNum > 5) {
    throw new Error(`stone must be an integer 1-5 (got: ${stone})`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in .env — cannot generate captions.");

  const styleGuide = loadStyleGuide();
  const styleInstructions = buildStyleGuideInstructions(styleGuide);
  // Debug log (stderr so stdout stays clean for the JSON payload).
  console.error("🎛  [style-guide] injected into system prompt:\n" + styleInstructions);

  const system = `${PERSONA}\n\n${STONE_CONTEXT[stoneNum]}\n\n${styleInstructions}`;
  const userMessage =
    `Write a 4-6 line inner monologue for a senior dog dealing with: ${theme}.\n` +
    "Return ONLY valid JSON matching this schema:\n" +
    "{stone, theme, captions[], hashtags[]}.\n" +
    "Each caption max 8 words. Max 1 emoji per caption. The humor should resonate with the " +
    "emotional context in your system prompt without stating it explicitly.";

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  let coerced = null;
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2 && !coerced; attempt += 1) {
    const reminder =
      attempt === 2
        ? "\n\nYour previous response was rejected (invalid JSON, wrong caption count, or a caption " +
          "longer than 8 words). Respond with ONLY the JSON object — 4 to 6 captions, each a COMPLETE " +
          "thought of 8 words or fewer, no markdown fences."
        : "";
    try {
      lastRaw = await callModel(client, system, userMessage + reminder);
    } catch (err) {
      // Auth / network / model errors — fail clearly, never silently.
      const status = err && err.status ? ` (HTTP ${err.status})` : "";
      throw new Error(`Anthropic API call failed${status}: ${err && err.message ? err.message : err}`);
    }
    try {
      const c = coerceStructure(parseJson(lastRaw));
      if (c && attempt === 1 && c.captions.some((x) => wordCount(x) > MAX_WORDS_PER_CAPTION)) {
        console.warn("⚠️  A caption exceeded 8 words — retrying once for tighter lines...");
      } else {
        coerced = c;
      }
    } catch (_) {
      if (attempt === 1) console.warn("⚠️  Invalid JSON on first attempt — retrying once...");
    }
  }

  if (!coerced) {
    throw new Error("Anthropic returned no valid 4-6 caption JSON after one retry.\nLast response:\n" + lastRaw);
  }
  return finalize(coerced, theme, stoneNum);
}

module.exports = { generateScript };

// --- CLI ---------------------------------------------------------------------
function compactStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

if (require.main === module) {
  (async () => {
    const theme = process.argv[2];
    const stone = process.argv[3];
    if (!theme || !theme.trim() || !stone) {
      console.error('Usage: npm run generate:script -- "<theme>" <stone 1-5>');
      process.exit(1);
    }
    try {
      const result = await generateScript(theme, stone);
      const slug =
        theme.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "script";
      const outPath = path.join(__dirname, "..", "out", "scripts", `${compactStamp(new Date())}-${slug}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result, null, 2));
      console.error(`\n💾 Saved to ${path.relative(path.join(__dirname, ".."), outPath)}`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  })();
}
