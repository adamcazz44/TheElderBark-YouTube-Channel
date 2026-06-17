import React from "react";
import {Composition} from "remotion";
import {ElderBarkShort} from "./ElderBarkShort";

// The production Short: vertical 1080x1920 for YouTube Shorts, 30fps, 38s (1140 frames).
// Spec 1 renders a placeholder; later specs wire the AI dog still + Ken Burns + captions + music.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ElderBarkShort"
      component={ElderBarkShort}
      durationInFrames={1140}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
