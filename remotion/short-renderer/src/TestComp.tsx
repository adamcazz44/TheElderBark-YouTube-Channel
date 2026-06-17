import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame} from "remotion";

// Fade in (frames 0->30, opacity 0->1), hold, fade out (frames 240->300, opacity 1->0).
export const TestComp: React.FC = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, 30, 240, 300],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          opacity,
          color: "#FFFFFF",
          fontWeight: "bold",
          fontSize: 96,
          fontFamily:
            "Arial, Helvetica, -apple-system, system-ui, sans-serif",
          textAlign: "center",
          padding: "0 80px",
        }}
      >
        The Elder Bark
      </div>
    </AbsoluteFill>
  );
};
