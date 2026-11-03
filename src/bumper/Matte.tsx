import React from "react";
import { AbsoluteFill } from "remotion";
import { HEIGHT, WIDTH } from "./shared";
import { SessionBumper, type SessionBumperProps } from "./SessionBumper";

// The Track Matte fallback for OBS builds that will not play VP9 alpha: one
// opaque video, twice as wide. Left half: the bumper over black (the fill).
// Right half: its alpha as luma - white where the card is, black where the
// live scene shows through. OBS layout "Same file, side by side".

export const MATTE_WIDTH = WIDTH * 2;
export const MATTE_HEIGHT = HEIGHT;

export const BumperMatte: React.FC<SessionBumperProps> = (props) => {
  const clip = { ...props, preview: false };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: WIDTH,
          height: HEIGHT,
          overflow: "hidden",
        }}
      >
        <SessionBumper {...clip} />
      </div>
      <div
        style={{
          position: "absolute",
          left: WIDTH,
          top: 0,
          width: WIDTH,
          height: HEIGHT,
          overflow: "hidden",
          // Every drawn pixel to white, alpha untouched: a luma matte.
          filter: "brightness(0) invert(1)",
        }}
      >
        <SessionBumper {...clip} />
      </div>
    </AbsoluteFill>
  );
};
