import React from "react";
import {Composition} from "remotion";
import {TestComp} from "./TestComp";
import {FPS, ElderBarkShort, ElderBarkShortProps} from "./ElderBarkShort";

// Defaults exist only so Remotion Studio can instantiate the composition for preview.
// scripts/render-video.js overrides these with real phrases/clips at render time.
const elderBarkDefaults: ElderBarkShortProps = {
  theme: "selective hearing in old age",
  phrases: [
    {
      text: "I'm not ignoring you. I'm thirteen. I've earned this.",
      style: "short",
      emotion: "smug",
      screen_duration_seconds: 4,
    },
    {
      text: "My hearing is perfect when there's cheese. Mysteriously gone at bath time.",
      style: "medium",
      emotion: "mischievous",
      screen_duration_seconds: 5,
    },
    {
      text: "You can call my name forty times. I will respond to exactly none of them, and yet I will arrive the instant a snack wrapper crinkles.",
      style: "long",
      emotion: "dramatic",
      screen_duration_seconds: 7,
    },
  ],
  clips: [
    {id: "placeholder", file: "footage/placeholder.mp4", duration: 10, width: 1920, height: 1080},
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Spec 1 verification artifact — do not remove. */}
      <Composition
        id="TestComp"
        component={TestComp}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />

      {/* The production renderer. Vertical 1080x1920 for YouTube Shorts (<=60s).
          Duration is derived from the phrases. */}
      <Composition
        id="ElderBarkShort"
        component={ElderBarkShort}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={elderBarkDefaults}
        calculateMetadata={({props}) => {
          const frames = props.phrases.reduce(
            (sum, p) => sum + Math.max(1, Math.round(p.screen_duration_seconds * FPS)),
            0
          );
          return {durationInFrames: Math.max(1, frames)};
        }}
      />
    </>
  );
};
