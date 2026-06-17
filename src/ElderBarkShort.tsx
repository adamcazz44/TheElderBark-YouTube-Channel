import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

// Spec 1 placeholder — black background, channel name up top, "Coming Soon" below.
// No dog image, captions, or music yet (those arrive in later specs). A gentle fade
// in/out just confirms the animation timeline renders frame-by-frame end to end.
export const ElderBarkShort: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 20, durationInFrames - 20, durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
  );

  const textStyle: React.CSSProperties = {
    color: "#FFFFFF",
    fontFamily: "Arial, Helvetica, -apple-system, system-ui, sans-serif",
    textAlign: "center",
  };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "220px 60px",
        opacity,
      }}
    >
      <div style={{...textStyle, fontWeight: 800, fontSize: 100, letterSpacing: "0.02em"}}>
        The Elder Bark
      </div>
      <div style={{...textStyle, fontWeight: 700, fontSize: 72}}>Coming Soon 🐾</div>
    </AbsoluteFill>
  );
};
