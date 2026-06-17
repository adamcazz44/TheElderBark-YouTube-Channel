import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface Phrase {
  text: string;
  style: "short" | "medium" | "long";
  emotion: string;
  screen_duration_seconds: number;
}

export interface Clip {
  id: string;
  // Path RELATIVE to the Remotion public dir. The render passes --public-dir=<lean assets dir>
  // so e.g. "footage/123.mp4" resolves via staticFile(). OffthreadVideo serves assets over
  // the bundler's HTTP server, so raw absolute / file:// paths fail — staticFile is required.
  file: string;
  duration: number;
  width: number;
  height: number;
}

// Must be a `type` (not an interface) so Remotion's Composition can bind it as props.
export type ElderBarkShortProps = {
  phrases: Phrase[];
  clips: Clip[];
  musicFile?: string;
  theme: string;
};

export const FPS = 30;
const FADE = 8; // quick caption fade out (frames) — comedy wants snappy, not slow
const CROSSFADE = 8; // scene-to-scene crossfade overlap (frames)

type StyleSpec = {
  fontSize: number;
  lineHeight: number;
  maxWidth: string;
  uppercase: boolean;
};

// Meme-caption sizing for a vertical 1080-wide Short. Big, bold, mobile-thumb-readable.
// Punchy white text with a heavy black outline (classic relatable-meme look).
const STYLE_MAP: Record<Phrase["style"], StyleSpec> = {
  short: { fontSize: 96, lineHeight: 1.1, maxWidth: "92%", uppercase: true },
  medium: { fontSize: 72, lineHeight: 1.15, maxWidth: "90%", uppercase: false },
  long: { fontSize: 56, lineHeight: 1.2, maxWidth: "88%", uppercase: false },
};

const sceneFramesFor = (p: Phrase): number =>
  Math.max(1, Math.round(p.screen_duration_seconds * FPS));

const Scene: React.FC<{ phrase: Phrase; clip: Clip; index: number; sceneFrames: number }> = ({
  phrase,
  clip,
  index,
  sceneFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const even = index % 2 === 0;

  // Subtle Ken Burns so the still footage has life without going cinematic-dramatic.
  const scale = even
    ? interpolate(frame, [0, sceneFrames], [1, 1.05], { extrapolateRight: "clamp" })
    : interpolate(frame, [0, sceneFrames], [1.05, 1], { extrapolateRight: "clamp" });

  // Scene crossfade (the Sequence runs CROSSFADE frames longer than sceneFrames so the
  // tail fade-out overlaps the next scene's fade-in).
  const sceneOpacity = interpolate(
    frame,
    [0, CROSSFADE, sceneFrames, sceneFrames + CROSSFADE],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Caption POP: spring-scale in (0.7 -> 1) for the snappy meme entrance, then a quick
  // fade out at the very end of the scene.
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 180, mass: 0.6 } });
  const popScale = interpolate(pop, [0, 1], [0.7, 1]);
  const textOpacity = interpolate(
    frame,
    [0, 4, sceneFrames - FADE, sceneFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const st = STYLE_MAP[phrase.style] ?? STYLE_MAP.medium;
  const display = st.uppercase ? phrase.text.toUpperCase() : phrase.text;

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity, backgroundColor: "#000000" }}>
      {/* Footage fills the frame (object-fit cover) with a slow Ken Burns zoom.
          OffthreadVideo has no `loop` prop in this Remotion version, so <Loop>
          repeats the clip when it is shorter than the scene. */}
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Loop durationInFrames={Math.max(1, Math.round(clip.duration * FPS))} layout="none">
          <OffthreadVideo
            src={staticFile(clip.file)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Loop>
      </AbsoluteFill>

      {/* Readability scrim, top + bottom, so the white meme caption pops on any footage. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      {/* Caption — lower third, meme style: heavy black outline + drop shadow. */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: "16%" }}>
        <div
          style={{
            opacity: textOpacity,
            transform: `scale(${popScale})`,
            fontFamily: '"Arial Black", Impact, Haettenschweiler, "Arial Narrow Bold", Arial, sans-serif',
            fontWeight: 900,
            fontSize: st.fontSize,
            color: "#FFFFFF",
            textAlign: "center",
            maxWidth: st.maxWidth,
            lineHeight: st.lineHeight,
            letterSpacing: "0.01em",
            // Heavy meme outline: stroke + layered shadows for thickness on any background.
            WebkitTextStroke: "7px #000000",
            paintOrder: "stroke fill",
            textShadow:
              "0 4px 0 rgba(0,0,0,0.55), 0 0 18px rgba(0,0,0,0.65), 4px 4px 8px rgba(0,0,0,0.6)",
            padding: "0 36px",
          }}
        >
          {display}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ElderBarkShort: React.FC<ElderBarkShortProps> = ({ phrases, clips, musicFile }) => {
  const { durationInFrames } = useVideoConfig();

  let from = 0;
  const scenes = phrases.map((phrase, i) => {
    const sceneFrames = sceneFramesFor(phrase);
    const clip = clips.length ? clips[i % clips.length] : undefined;
    const start = from;
    from += sceneFrames;
    return { phrase, clip, start, sceneFrames, i };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {scenes.map(({ phrase, clip, start, sceneFrames, i }) =>
        clip ? (
          <Sequence key={i} from={start} durationInFrames={sceneFrames + CROSSFADE}>
            <Scene phrase={phrase} clip={clip} index={i} sceneFrames={sceneFrames} />
          </Sequence>
        ) : null
      )}

      {musicFile ? (
        <Audio
          src={staticFile(musicFile)}
          loop
          volume={(f) =>
            interpolate(
              f,
              [0, 45, Math.max(46, durationInFrames - 90), durationInFrames],
              [0, 0.32, 0.32, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
