import React from "react";
import {Composition} from "remotion";
import {ElderBarkShort, ElderBarkShortProps} from "./ElderBarkShort";

// Studio-only defaults so the composition can be previewed. src/render.js overrides these with
// the real staged image + captions at render time.
const defaultProps: ElderBarkShortProps = {
  imagePath: "image.png",
  captions: [
    "Day 47.",
    "The stairs have not moved.",
    "I have not moved.",
    "We are at a standstill.",
    "I respect them now. 🏔️",
  ],
};

// The production Short: vertical 1080x1920 for YouTube Shorts, 30fps, 38s (1140 frames).
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ElderBarkShort"
      component={ElderBarkShort}
      durationInFrames={1140}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
  );
};
