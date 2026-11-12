import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, LogoPiece } from "./brand";

/** Paper grain, same recipe as the sites (feTurbulence, ~4–6% opacity). Re-seeded on twos so it lives. */
export const Grain: React.FC<{ opacity?: number; blend?: React.CSSProperties["mixBlendMode"] }> = ({
  opacity = 0.07,
  blend = "multiply",
}) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 8;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: blend, opacity }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** The full mark, or a subset of pieces, with per-piece style overrides. */
export const Logo: React.FC<{
  width: number;
  fill?: string;
  pieces?: LogoPiece[];
  pieceStyle?: (p: LogoPiece) => React.SVGProps<SVGPathElement>;
  style?: React.CSSProperties;
}> = ({ width, fill = "#000", pieces = LOGO_ORDER, pieceStyle, style }) => (
  <svg
    width={width}
    height={(width * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w}
    viewBox={`-2 -2 ${LOGO_VIEWBOX.w + 4} ${LOGO_VIEWBOX.h + 4}`}
    style={{ overflow: "visible", ...style }}
  >
    {pieces.map((p) => (
      <path key={p} d={LOGO_PATHS[p]} fill={fill} {...(pieceStyle ? pieceStyle(p) : {})} />
    ))}
  </svg>
);

/** Stand-in for the real interview footage: a Sessions thumbnail, cover-cropped to 9:16, slow push. */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = interpolate(frame, [0, durationInFrames], [1.0, 1.06]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b1a1f" }}>
      <Img
        src={staticFile("ident/thumb-mWNWTIGghjc.jpg")}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "52% 50%", transform: `scale(${s})` }}
      />
    </AbsoluteFill>
  );
};
