# The Elder Bark — Build Status & Go-Live Checklist

**Built:** 2026-06-17 · cloned from the proven `OnlineMotivateYoutube` engine and reskinned into a
senior-dog comedy Shorts channel driving traffic to **petpickhq.com**.

## What's done (verified on this machine)
- ✅ **Full pipeline ported & reskinned** — footage → captions → render → thumbnail → upload → orchestration.
- ✅ **Engine renders** — `npm run test:render` produced `output/test-render.mp4` (Remotion + toolchain OK).
- ✅ **Comedy captions work** — `generate:quotes` produced 10 first-person senior-dog jokes via Anthropic
  (`claude-sonnet-4-6`, reusing the `ANTHROPIC_API_KEY` already in `.env`).
- ✅ **Meme-caption renderer proven** — rendered a real 59s vertical `ElderBarkShort` (against a placeholder
  clip) and frame-checked the captions: bold white, heavy black outline, lower third, caps for short lines.
- ✅ Renderer renamed `motivation-renderer` → `short-renderer`, composition `MotivationVideo` → `ElderBarkShort`.
- ✅ Voice: senior dog, **first person**. Captions: **meme style**. Category: **15 (Pets & Animals)**.
  Description cross-promotes **https://petpickhq.com**. Tags retargeted to senior-dog/dog-comedy.

## Remaining to go live (needs your action — all credential/asset gated)
1. **Pexels API key** — REQUIRED. The footage pool is empty; the old key is dead. Get a free key at
   <https://www.pexels.com/api/>, put it in `.env` as `PEXELS_API_KEY`, then seed footage:
   ```sh
   npm run fetch:footage -- "senior dog"
   npm run fetch:footage -- "old dog napping"
   npm run fetch:footage -- "gray muzzle dog"
   npm run fetch:footage -- "old dog couch"
   ```
2. **Music** — drop a few light/comedic instrumental `.mp3`s into `music/` (YouTube Audio Library →
   filter "No attribution required" is easiest; if you use attribution-required tracks, add the credit
   to the `DESCRIPTION` in `scripts/upload-youtube.js`). Renders silently if `music/` is empty.
3. **YouTube channel + OAuth** — create the **The Elder Bark** channel, phone-verify it
   (<https://www.youtube.com/verify>, unlocks custom thumbnails), then follow `SETUP.md` to fill the
   `YOUTUBE_CLIENT_ID/SECRET` and run `npm run auth:youtube` for the refresh token.

## Then produce
```sh
npm run pipeline -- "selective hearing in old age"   # quotes → footage → produce → upload (PRIVATE)
npm run publish  -- <youtube_id>                     # flip Public after QC
npm run cron:daily                                   # next unused theme (30-theme launch rotation)
```
**Uploads stay Private — a human QCs and publishes. Never auto-publish.**

## Secrets (gitignored `.env`)
`ANTHROPIC_API_KEY` (already set, reused) · `PEXELS_API_KEY` (placeholder — add yours) ·
`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` (placeholders — see `SETUP.md`).
