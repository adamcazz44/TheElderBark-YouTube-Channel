import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// All content arrives via props — no hardcoded caption text or image here.
export type ElderBarkShortProps = {
  imagePath: string; // RELATIVE to the render's public dir (staged by src/render.js) -> staticFile()
  captions: string[];
};

const CAPTION_FADE = 8; // frames to fade a caption in / out
const MUSIC_FADE = 30; // fade music over the last 1s (30 frames @ 30fps)
const MUSIC_VOLUME = 0.4;

export const ElderBarkShort: React.FC<ElderBarkShortProps> = ({imagePath, captions}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // Ken Burns: slow zoom 100% -> 115% across the whole Short, smooth easeInOut.
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.15], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

  // Distribute captions evenly across the full duration (timing derived from count).
  const per = Math.max(1, Math.floor(durationInFrames / Math.max(1, captions.length)));

  return (
    <AbsoluteFill style={{backgroundColor: "#000000"}}>
      {/* 1. Dog image — full-frame cover, with the Ken Burns zoom applied. */}
      <AbsoluteFill style={{transform: `scale(${scale})`, transformOrigin: "center center"}}>
        {imagePath ? (
          <Img src={staticFile(imagePath)} style={{width: "100%", height: "100%", objectFit: "cover"}} />
        ) : null}
      </AbsoluteFill>

      {/* 3. Vignette — dark radial gradient at the edges (pure CSS), opacity 0.4. */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,1) 100%)",
          opacity: 0.4,
        }}
      />

      {/* 4. Captions — lower third, fade in / hold / fade out, one after another. */}
      {captions.map((text, i) => {
        const start = i * per;
        const end = start + per;
        const opacity = interpolate(
          frame,
          [start, start + CAPTION_FADE, end - CAPTION_FADE, end],
          [0, 1, 1, 0],
          {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
        );
        return (
          <AbsoluteFill key={i}>
            <div
              style={{
                position: "absolute",
                top: "75%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "88%",
                textAlign: "center",
                opacity,
                color: "#FFFFFF",
                fontFamily: "Arial, Helvetica, -apple-system, system-ui, sans-serif",
                fontWeight: 800,
                fontSize: 82,
                lineHeight: 1.2,
                textShadow: "2px 2px 8px rgba(0,0,0,0.9)",
              }}
            >
              {text}
            </div>
          </AbsoluteFill>
        );
      })}

      {/* 5. Background music — committed asset, volume 0.4, fade out over the last second. */}
      <Audio
        src={staticFile("background.mp3")}
        volume={(f) =>
          interpolate(f, [0, durationInFrames - MUSIC_FADE, durationInFrames], [MUSIC_VOLUME, MUSIC_VOLUME, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
    </AbsoluteFill>
  );
};
