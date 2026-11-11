/**
 * Film grain, in two passes to match the references:
 *  - an overlay pass that textures the mark, the photo and the type;
 *  - a much weaker screen pass, because the reference blacks are not dead flat
 *    either (they measure mean 1.3, std 0.9 rather than a clean 0).
 * Overlay alone can't do the second job: overlaying anything onto pure black
 * leaves it black.
 */
import React from "react";

const NoiseLayer: React.FC<{
  id: string;
  opacity: number;
  blend: "overlay" | "screen";
  frequency: number;
}> = ({ id, opacity, blend, frequency }) => (
  <svg
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      opacity,
      mixBlendMode: blend,
      pointerEvents: "none",
    }}
  >
    <filter id={id}>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={frequency}
        numOctaves={4}
        stitchTiles="stitch"
      />
      <feColorMatrix type="saturate" values="0" />
      {/* Flatten alpha, otherwise the noise's own transparency modulates the
          blend and the grain comes out patchy rather than even. Squeezing the
          luminance around 0.5 keeps the overlay pass mean-neutral, so raising
          the grain adds texture without also lifting the whole poster. */}
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.6" intercept="0.2" />
        <feFuncG type="linear" slope="0.6" intercept="0.2" />
        <feFuncB type="linear" slope="0.6" intercept="0.2" />
        <feFuncA type="linear" slope="0" intercept="1" />
      </feComponentTransfer>
    </filter>
    <rect width="100%" height="100%" filter={`url(#${id})`} />
  </svg>
);

export const Grain: React.FC<{
  /** Strength of the overlay pass. 0 disables both passes. */
  opacity?: number;
  /** Strength of the screen pass that keeps the blacks from being dead flat. */
  lift?: number;
  frequency?: number;
}> = ({ opacity = 0.16, lift = 0.02, frequency = 0.9 }) => {
  if (opacity <= 0) return null;
  return (
    <>
      <NoiseLayer id="wh-grain" opacity={opacity} blend="overlay" frequency={frequency} />
      <NoiseLayer id="wh-grain-lift" opacity={lift} blend="screen" frequency={frequency} />
    </>
  );
};
