# The Elder Bark

An AI-automated **YouTube Shorts** channel about the comedy of old dogs growing older.
No voiceover, no narration — the format is **senior-dog stock footage + animated
meme-style captions (in the dog's own voice) + royalty-free music**, rendered to vertical
MP4 via [Remotion](https://www.remotion.dev/) and uploaded to YouTube.

Built as a content engine to drive traffic to **[petpickhq.com](https://petpickhq.com)**.

## Niche
> The gloriously stubborn life of a senior dog — selective hearing, couch ownership,
> majestic gray muzzles, and a complete refusal to follow the rules. Comedy, written
> first-person as the old dog narrating its own life. Relatable to every senior-dog parent.

## Format
- **Vertical 1080×1920 Shorts**, ≤60s (captions drive the runtime, ~25–55s).
- Punchy white **meme-style captions** with a heavy black outline, popped on screen over
  senior-dog footage with a subtle Ken Burns move and light background music.
- Uploaded **Private** by default — a human QCs and runs `publish` before anything goes public.

## Pipeline (6 stages)
1. **Footage sourcer** — pull senior-dog stock clips from the Pexels API into `footage/`.
2. **Caption generator** — an Anthropic-backed generator writes 10 first-person senior-dog
   jokes per theme as JSON into `quotes/` (rules in `scripts/hermes-skills/generate-quotes/SKILL.md`).
3. **Motion renderer** — Remotion `ElderBarkShort` combines footage + captions + music → MP4 in `output/`.
4. **Thumbnail generator** — 1280×720 thumbnail PNGs into `thumbnails/`.
5. **YouTube upload** — upload Private, set thumbnail, record id/url.
6. **Orchestration** — `pipeline` (full chain for one theme) + `cron:daily` (30-theme launch rotation).

## Layout
```
remotion\short-renderer\   Remotion project (ElderBarkShort + TestComp)
footage\                   downloaded senior-dog clips (gitignored; manifest tracked)
music\                     background music tracks (gitignored)
output\                    rendered MP4s staging area (gitignored; manifest tracked)
thumbnails\                generated thumbnail images (gitignored; manifest tracked)
scripts\                   Node pipeline scripts
quotes\                    generated caption JSON (gitignored; manifest tracked)
```

## Setup
1. **Secrets** — copy `.env.example` to `.env` and fill:
   - `ANTHROPIC_API_KEY` (caption generation),
   - `PEXELS_API_KEY` (footage — get a free key at <https://www.pexels.com/api/>),
   - the YouTube OAuth trio (see `SETUP.md`).
2. **Install** — `npm install` (root) and `npm install --prefix remotion/short-renderer`.
3. **Footage** — `npm run fetch:footage -- "senior dog"` (and a few more queries: `old dog napping`,
   `gray muzzle dog`, `old dog couch`) downloads clips into `footage/`.
4. **Music** — drop a few light/comedic instrumental `.mp3`s into `music/`. Tracks are gitignored,
   so each checkout adds its own. Easiest source with **no attribution required**: the
   **YouTube Audio Library** (Studio → Audio Library → filter "No attribution required",
   genre Children's/Happy). If you use attribution-required music, add the credit line to the
   `DESCRIPTION` in `scripts/upload-youtube.js`. If `music/` is empty the video still renders — silently.

## Produce a Short
```sh
npm run test:render                                         # renders TestComp -> output/test-render.mp4 (engine smoke test)
npm run generate:quotes -- "selective hearing in old age"   # 10 first-person senior-dog captions (JSON)
npm run render:video   -- "selective hearing in old age"    # render the ElderBarkShort from captions + footage
npm run produce        -- "selective hearing in old age"    # render + thumbnail in one command
npm run pipeline       -- "selective hearing in old age"    # quotes -> footage -> produce -> upload (Private)
npm run publish        -- <youtube_id>                      # flip to Public after QC
npm run reject         -- <youtube_id>                      # delete from YouTube
npm run cron:daily                                          # produce the next unused theme (scripts/themes.js)
```

> **Thumbnail dependency note:** the thumbnail step uses **`node-canvas`** (`canvas`). If a
> future `npm install` of `canvas` fails to build, swap to the drop-in `@napi-rs/canvas`.

## Stack
Node.js + Remotion. **npm only** (no Yarn/pnpm). Windows / `E:` drive.
