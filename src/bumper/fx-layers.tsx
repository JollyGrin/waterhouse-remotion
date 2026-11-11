import React from "react";

// SVG / CSS layers shared by the bumper ideas. Nothing here animates on its
// own: every value comes in as a prop computed from useCurrentFrame().

/**
 * Static paper grain as an SVG filter: fractal noise turned into black
 * specks (luminance -> alpha), so it darkens like ink on fibre and never
 * lightens. Put <GrainDefs> in the <defs> of the SVG that draws the card and
 * paint a <rect filter="url(#id)"> with the same mask as the card, so the
 * grain never reaches an alpha-0 region.
 */
export const GrainDefs: React.FC<{ id: string; seed?: number; scale?: number }> = ({
  id,
  seed = 11,
  scale = 1,
}) => (
  <filter
    id={id}
    x="0"
    y="0"
    width="100%"
    height="100%"
    colorInterpolationFilters="sRGB"
  >
    <feTurbulence
      type="fractalNoise"
      baseFrequency={0.6 / scale}
      numOctaves={3}
      seed={seed}
      stitchTiles="stitch"
      result="noise"
    />
    {/* Grey noise -> alpha; the colour channels go to black. */}
    <feColorMatrix
      in="noise"
      type="matrix"
      values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2 2 2 0 -2.2"
    />
  </filter>
);

/**
 * Edge boil for cut shapes: a displacement map re-seeded every two frames
 * so the outline swims +-`px` (in the user units of the filtered element).
 */
export const BoilDefs: React.FC<{ id: string; frame: number; px: number }> = ({
  id,
  frame,
  px,
}) => (
  <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence
      type="turbulence"
      baseFrequency={0.006}
      numOctaves={1}
      seed={Math.floor(frame / 2) % 1000}
      result="warp"
    />
    <feDisplacementMap
      in="SourceGraphic"
      in2="warp"
      scale={px * 2}
      xChannelSelector="R"
      yChannelSelector="G"
    />
  </filter>
);

interface ChromaticTextProps {
  text: string;
  color: string;
  // The red / cyan fringe, in px each side.
  offset?: number;
  fringeOpacity?: number;
  style?: React.CSSProperties;
}

/**
 * Type with a 1 px red / cyan misregistration, like a cheap print. The two
 * coloured copies multiply onto the paper behind; the ink copy sits on top.
 */
export const ChromaticText: React.FC<ChromaticTextProps> = ({
  text,
  color,
  offset = 1,
  fringeOpacity = 0.8,
  style,
}) => {
  const fringe = (fill: string, dx: number): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    color: fill,
    transform: `translateX(${dx}px)`,
    mixBlendMode: "multiply",
    opacity: fringeOpacity,
  });
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={fringe("#FF2D2D", -offset)}>{text}</div>
      <div style={fringe("#00E5FF", offset)}>{text}</div>
      <div style={{ position: "relative", color }}>{text}</div>
    </div>
  );
};
