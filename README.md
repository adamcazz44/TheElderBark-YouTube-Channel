# The Elder Bark

A senior-dog **comedy** YouTube Shorts channel, produced by an automated Node.js + Remotion pipeline.

## Format
- **Vertical 1080×1920** (YouTube Shorts), **30fps**, **38 seconds**.
- Each Short is a **photorealistic senior-dog still image** (AI-generated via ComfyUI/Flux — a
  consistent recurring character) with a **Ken Burns zoom**, **animated pop-in captions** written
  in the dog's first-person voice, and royalty-free background music.
- Built to drive traffic to **petpickhq.com**.

> **Spec 1 (this commit)** is scaffold-only: a placeholder composition that renders a black frame
> with the channel name and "Coming Soon 🐾". The dog image, captions, music, and YouTube upload
> arrive in later specs.

## Stack
Node.js 20+ · Remotion 4.x · npm. Windows / `E:` drive.

## Setup
```sh
npm install
cp .env.example .env   # then fill in real values (ANTHROPIC_API_KEY, YouTube OAuth, COMFYUI_URL)
```

## npm scripts
| Script | What it does |
|---|---|
| `npm run render` | Headless render of the `ElderBarkShort` composition to `out/test.mp4` via `@remotion/renderer` (no browser window). |
| `npm run studio` | Opens Remotion Studio for local preview/editing of the composition. |

## Layout
```
src/
  index.ts            Remotion entry (registerRoot)
  Root.tsx            composition registration (ElderBarkShort, 1080x1920, 30fps, 1140 frames)
  ElderBarkShort.tsx  the composition (Spec 1: placeholder)
scripts/
  render.mjs          programmatic headless render -> out/test.mp4
out/                  rendered MP4s (gitignored)
```
