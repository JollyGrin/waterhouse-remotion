import React from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MARK_PATHS, MARK_VIEWBOX } from "./WhMark";
import {
  CLOSE,
  FPS as DESIGN_FPS,
  HEIGHT,
  MARK_HEIGHT,
  OPEN,
  RUSH_SCALE,
  WIDTH,
} from "./theme";

/**
 * The logo reveal. The mark is a hole punched in a black card sitting over the
 * video: grow the hole and the picture opens up inside the mark's shape. Done as an
 * SVG mask rather than a CSS clip so the black is guaranteed to disappear exactly
 * when the shape covers the frame, with no residual slivers.
 *
 * Before the rush the hole is filled with white, which is what makes it read as a
 * logo on black rather than a peephole.
 */

const PATH_SCALE = MARK_HEIGHT / MARK_VIEWBOX.height;
const MARK_WIDTH = MARK_VIEWBOX.width * PATH_SCALE;
const OFFSET_X = (WIDTH - MARK_WIDTH) / 2;
const OFFSET_Y = (HEIGHT - MARK_HEIGHT) / 2;

/**
 * Centre of the house — the tall left-hand piece, from logo.svg's second path.
 * The bars are too thin and too gappy to ever cover the frame, so the house is the
 * piece that has to end up over the middle.
 */
const HOUSE_CENTRE_X = 173.94;

/**
 * How far the mark slides so the house sits centred.
 *
 * Without this the mark grows about the frame's centre while the house sits left of
 * it, so at high scale the house travels off to the left and the reveal ends on
 * black with the picture showing only through the gaps. The mark is centred while it
 * is being read as a logo, then drifts onto the house as the rush begins — by which
 * point the fill has gone and everything is moving, so the shift is invisible.
 */
const HOUSE_SHIFT = WIDTH / 2 - (OFFSET_X + HOUSE_CENTRE_X * PATH_SCALE);

/** Places the mark at `scale`, pivoting about the frame centre. */
const markTransform = (scale: number, driftX: number) =>
  [
    `translate(${WIDTH / 2} ${HEIGHT / 2})`,
    `scale(${scale})`,
    `translate(${-WIDTH / 2} ${-HEIGHT / 2})`,
    `translate(${OFFSET_X + driftX} ${OFFSET_Y})`,
    `scale(${PATH_SCALE})`,
  ].join(" ");

export type RevealMode = "open" | "close";

/**
 * The reveal's visual layers only — the black card with the mark punched out of it,
 * and the filled mark on top. Takes its own frame so it can be driven either by a
 * standalone bookend clip or by an offset inside a full-length episode.
 */
export const LogoRevealLayers: React.FC<{
  mode: RevealMode;
  localFrame: number;
}> = ({ mode, localFrame }) => {
  // OPEN and CLOSE are timed in 60fps design frames; convert, so the reveal runs the
  // same five seconds whatever rate the episode is at.
  const { fps } = useVideoConfig();
  const frame = (localFrame * DESIGN_FPS) / fps;
  const opening = mode === "open";

  const scale = opening
    ? interpolate(frame, [OPEN.rushFrom, OPEN.durationInFrames], [1, RUSH_SCALE], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        // Accelerating, so it reads as coming at the viewer rather than growing.
        easing: Easing.in(Easing.cubic),
      })
    : // Not a strict time-reverse of the open. Reversing it exactly would collapse
      // fastest at the very start, so the picture would vanish the instant the close
      // began. Holding the frame and then accelerating inward is what reads as a
      // close.
      interpolate(frame, [0, CLOSE.rushTo], [RUSH_SCALE, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.in(Easing.cubic),
      });

  const fillOpacity = opening
    ? interpolate(
        frame,
        [OPEN.appearFrom, OPEN.appearTo, OPEN.fillFadeFrom, OPEN.fillFadeTo],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : interpolate(
        frame,
        [CLOSE.fillFadeFrom, CLOSE.fillFadeTo, CLOSE.vanishFrom, CLOSE.vanishTo],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );

  // Position of the highlight sweeping across the mark, in gradient offsets.
  const shine = opening
    ? interpolate(frame, [OPEN.shineFrom, OPEN.shineTo], [-0.25, 1.25], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      })
    : interpolate(frame, [CLOSE.shineFrom, CLOSE.shineTo], [-0.25, 1.25], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      });

  // While the mark is small it also lifts slightly, so the appearance has some life.
  const appearScale = opening
    ? interpolate(frame, [OPEN.appearFrom, OPEN.appearTo], [0.86, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.back(1.6)),
      })
    : 1;

  const driftX = opening
    ? interpolate(frame, [OPEN.rushFrom, OPEN.rushFrom + 60], [0, HOUSE_SHIFT], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      })
    : interpolate(frame, [CLOSE.rushTo - 60, CLOSE.rushTo], [HOUSE_SHIFT, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      });

  /**
   * Whether the mark is a hole in the black card yet.
   *
   * It must not be, while the mark is still being read as a logo. The fill is
   * translucent as it fades up, so an open hole means the picture shows straight
   * through the logo before the video has any business being visible — which is
   * exactly what it looked like. Both switches happen on a frame where the fill is
   * fully opaque, so the change is hidden.
   */
  const holeOpen = opening
    ? frame >= OPEN.fillFadeFrom
    : frame <= CLOSE.fillFadeTo;

  const shapeScale = scale * (scale <= 1.001 ? appearScale : 1);
  const transform = markTransform(shapeScale, driftX);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  return (
    <>
      {/* Black card with the mark punched out of it. */}
      <AbsoluteFill>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <mask id="wh-hole" maskUnits="userSpaceOnUse" x="0" y="0" width={WIDTH} height={HEIGHT}>
              <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="white" />
              {holeOpen ? (
                <g transform={transform}>
                  {MARK_PATHS.map((d) => (
                    <path key={d} d={d} fill="black" />
                  ))}
                </g>
              ) : null}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width={WIDTH}
            height={HEIGHT}
            fill="black"
            mask="url(#wh-hole)"
          />
        </svg>
      </AbsoluteFill>

      {/* The mark itself, filled, with the highlight travelling across it. */}
      {fillOpacity > 0.001 ? (
        <AbsoluteFill style={{ opacity: fillOpacity }}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ width: "100%", height: "100%", display: "block" }}
          >
            <defs>
              <linearGradient
                id="wh-shine"
                gradientUnits="objectBoundingBox"
                x1="0"
                y1="1"
                x2="1"
                y2="0"
              >
                <stop offset={clamp01(shine - 0.2)} stopColor="#c8c8c8" />
                <stop offset={clamp01(shine)} stopColor="#ffffff" />
                <stop offset={clamp01(shine + 0.2)} stopColor="#c8c8c8" />
              </linearGradient>
            </defs>
            <g transform={transform}>
              {MARK_PATHS.map((d) => (
                <path key={d} d={d} fill="url(#wh-shine)" />
              ))}
            </g>
          </svg>
        </AbsoluteFill>
      ) : null}
    </>
  );
};

/** A standalone bookend clip: the reveal over its own five seconds of footage. */
export const LogoReveal: React.FC<{
  mode: RevealMode;
  src: string;
  /** Frame of the source this clip starts at. */
  trimBefore: number;
}> = ({ mode, src, trimBefore }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo src={src} trimBefore={trimBefore} />
      <LogoRevealLayers mode={mode} localFrame={frame} />
    </AbsoluteFill>
  );
};
