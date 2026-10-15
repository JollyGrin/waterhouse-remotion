import React from "react";
import {
  ALL_PARTS,
  MARK_BOTTOM_Y,
  MARK_FRAME,
  MARK_PARTS,
  MARK_TOP_Y,
  toPath,
  type MarkPart,
} from "./markGeometry";

export const WaterhouseMark: React.FC<{
  /**
   * Top of the fill gradient. Measured off the references: the mark reads ~184
   * near the bars and ~172 lower down, dimming towards its base. Set a little
   * below those so the texture pass can lift it back.
   */
  topColor?: string;
  bottomColor?: string;
  /**
   * Strength of the paper-like grain inside the mark. The references are not a
   * flat fill — their grey measures a standard deviation of ~4.9, which is what
   * reads as texture rather than as a printed block of colour.
   */
  texture?: number;
  /** Which pieces to paint. Omit for the whole mark. */
  parts?: MarkPart[];
}> = ({ topColor = "#CFCFCF", bottomColor = "#979797", texture = 0.23, parts }) => {
  const chosen = (parts ?? ALL_PARTS).map((p) => MARK_PARTS[p]);
  const d = toPath(chosen, 1);
  return (
    <svg
      viewBox={`0 0 ${MARK_FRAME} ${MARK_FRAME}`}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <defs>
        <linearGradient
          id="wh-mark-fade"
          x1="0"
          y1={MARK_TOP_Y}
          x2="0"
          y2={MARK_BOTTOM_Y}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={topColor} />
          <stop offset="1" stopColor={bottomColor} />
        </linearGradient>
        <clipPath id="wh-mark-clip">
          <path d={d} />
        </clipPath>
        {/* Add zero-mean noise arithmetically rather than with a blend mode.
            mix-blend-mode overlay drags the whole mark lighter in Chromium's
            blend space, which made the grey drift as soon as the texture was
            strong enough to see; src + A*(noise - 0.5) leaves the mean alone.
            sRGB interpolation matters — the linearRGB default shifts it again. */}
        <filter id="wh-mark-noise" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.55"
            numOctaves="4"
            stitchTiles="stitch"
            result="n"
          />
          <feColorMatrix in="n" type="saturate" values="0" result="ng" />
          <feComposite
            in="SourceGraphic"
            in2="ng"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3={texture}
            k4={-texture / 2}
          />
        </filter>
      </defs>
      <g clipPath="url(#wh-mark-clip)">
        <rect
          width={MARK_FRAME}
          height={MARK_FRAME}
          fill="url(#wh-mark-fade)"
          filter={texture > 0 ? "url(#wh-mark-noise)" : undefined}
        />
      </g>
    </svg>
  );
};
