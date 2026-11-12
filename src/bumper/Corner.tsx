import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Logo, LOGO_VIEW_H, LOGO_VIEW_W } from "./Logo";
import {
  buildCracks,
  buildPanes,
  driftAt,
  fallOrder,
  solveDrift,
  standingPolygon,
  toClipPath,
  type Crack,
  type Pane,
  type Point,
} from "./corner-plan";
import {
  HEIGHT,
  INK,
  LIME,
  PAPER,
  PURPLE,
  WIDTH,
  brandFont,
  pullupSfx,
  recapSfx,
  withLine,
} from "./shared";

// Idea 4 - Corner hit. A black card; the lockup drifts like a screensaver,
// swaps colour on each bounce and lands exactly in the top-left corner. The
// glass cracks from that corner and the panes fall away onto the live scene.

// --- Timing (30 fps, 115 frames = 3.8 s). Tune beats here. ---
export const CORNER_DURATION = 115;

const RIGHT_BOUNCE = 14; // reflects off the right edge
const BOTTOM_BOUNCE = 20; // reflects off the bottom edge (<= CORNER_FRAME / 2)
const CORNER_FRAME = 46; // dead in the top-left corner; freeze
const FLASH_FRAME = 47; // one white frame
const NAME_IN = 50; // "with Denzo" hard cut
const CRACK_START = 56; // cracks shoot from the corner ...
const CRACK_STAGGER = 2; // ... one every two frames ...
const CRACK_DRAW = 10; // ... each drawn over ten frames (last done by f70)
const FALL_START = 70; // first pane falls (top edge first, round to the left)
const FALL_STAGGER = 3;
const FALL_DURATION = 14; // 6 panes: last (the logo's) done by f99
const CLEAR_FRAME = 100; // from here: fully transparent
const COLOURS = [LIME, PURPLE, PAPER]; // start, after bounce 1, after bounce 2

// Idle render (`--idle`): the drift up to the corner, no hit.
export const CORNER_IDLE_DURATION = CORNER_FRAME;

// --- Layout ---
const LOGO_W = 360;
const LOGO_H = (LOGO_W * LOGO_VIEW_H) / LOGO_VIEW_W; // ~240
const LOCKUP_GAP = 8;
const LOCKUP_SIZE = 40;
const BOX_W = LOGO_W;
const BOX_H = LOGO_H + LOCKUP_GAP + LOCKUP_SIZE; // ~288
const NAME_SIZE = 150;
const CRACK_WIDTH = 2;

const DRIFT_SPEC = {
  width: WIDTH,
  height: HEIGHT,
  boxW: BOX_W,
  boxH: BOX_H,
  rightBounce: RIGHT_BOUNCE,
  bottomBounce: BOTTOM_BOUNCE,
  cornerFrame: CORNER_FRAME,
};
const DRIFT = solveDrift(DRIFT_SPEC);

const CRACK_SPEC = {
  width: WIDTH,
  height: HEIGHT,
  // The logo pane: the lockup box plus a margin, so the mark falls whole.
  boxW: BOX_W + 24,
  boxH: BOX_H + 24,
  count: 4,
  seed: 7,
  jitterPx: 18,
  jitterDeg: 6,
  segments: 6,
};

const crackStart = (i: number) => CRACK_START + i * CRACK_STAGGER;
const fallStartOf = (orderIndex: number) =>
  FALL_START + orderIndex * FALL_STAGGER;

const colourAt = (frame: number) =>
  frame < RIGHT_BOUNCE
    ? COLOURS[0]
    : frame < BOTTOM_BOUNCE
      ? COLOURS[1]
      : COLOURS[2];

const CornerAudio: React.FC<{ crackCount: number }> = ({ crackCount }) => (
  <>
    {[RIGHT_BOUNCE, BOTTOM_BOUNCE].map((f) => (
      <Sequence key={f} from={f} durationInFrames={3}>
        <Audio src={pullupSfx("click")} />
      </Sequence>
    ))}
    {/* The corner: a hard, short hit. */}
    <Sequence from={CORNER_FRAME} durationInFrames={8}>
      <Audio src={recapSfx("land")} />
    </Sequence>
    {Array.from({ length: crackCount }).map((_, i) => (
      <Sequence key={i} from={crackStart(i)} durationInFrames={3}>
        <Audio src={recapSfx("tick")} />
      </Sequence>
    ))}
    {/* The glass goes: one low thud as the first pane drops. */}
    <Sequence from={FALL_START} durationInFrames={8}>
      <Audio src={pullupSfx("thud")} />
    </Sequence>
  </>
);

/** The whole card: black, the lockup, the name, the cracks. Panes clip it. */
const Card: React.FC<{
  frame: number;
  guestName: string | null;
  cracks: Crack[];
}> = ({ frame, guestName, cracks }) => {
  const pos = driftAt(DRIFT_SPEC, DRIFT, frame);
  const colour = colourAt(frame);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <div
        style={{
          position: "absolute",
          left: pos.x,
          top: pos.y,
          width: BOX_W,
          height: BOX_H,
        }}
      >
        <Logo width={LOGO_W} color={colour} />
        <div
          style={{
            marginTop: LOCKUP_GAP,
            fontFamily: brandFont,
            fontSize: LOCKUP_SIZE,
            lineHeight: 1,
            letterSpacing: 2,
            color: colour,
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          WATERHOUSE SESSIONS
        </div>
      </div>

      {frame >= NAME_IN ? (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            fontFamily: brandFont,
            fontSize: NAME_SIZE,
            lineHeight: 1,
            color: PAPER,
          }}
        >
          {withLine(guestName)}
        </AbsoluteFill>
      ) : null}

      {frame >= CRACK_START ? (
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          {cracks.map((c, i) => {
            const drawn = interpolate(
              frame,
              [crackStart(i), crackStart(i) + CRACK_DRAW],
              [0, 1],
              {
                easing: Easing.out(Easing.quad),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );
            return (
              <polyline
                key={i}
                points={c.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={PAPER}
                strokeWidth={CRACK_WIDTH}
                strokeLinejoin="round"
                strokeDasharray={c.length}
                strokeDashoffset={c.length * (1 - drawn)}
              />
            );
          })}
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};

const fallProgress = (frame: number, startFrame: number) =>
  interpolate(frame, [startFrame, startFrame + FALL_DURATION], [0, 1], {
    easing: Easing.in(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** One piece of glass: the card clipped to its polygon, tipping away. */
const FallingPane: React.FC<{
  pane: Pane;
  p: number;
  tilt: number;
  children: React.ReactNode;
}> = ({ pane, p, tilt, children }) => {
  if (p <= 0 || p >= 1) return null;
  const opacity = interpolate(p, [0.75, 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        clipPath: toClipPath(pane.polygon),
        transformOrigin: `${pane.centroid.x}px ${pane.centroid.y}px`,
        transform: `perspective(1400px) translateY(${p * 700}px) rotateX(${-p * 80}deg) rotateZ(${p * tilt}deg)`,
        opacity,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

interface CornerProps {
  guestName: string | null;
  idle: boolean;
  // Skip the sound (the Track Matte's second copy).
  muted?: boolean;
}

export const Corner: React.FC<CornerProps> = ({ guestName, idle, muted }) => {
  const frame = useCurrentFrame();

  const { cracks, panes, order } = useMemo(() => {
    const cracks = buildCracks(CRACK_SPEC);
    const panes = buildPanes(CRACK_SPEC, cracks);
    return { cracks, panes, order: fallOrder(panes) };
  }, []);

  if (frame >= CLEAR_FRAME) return null;

  const card = <Card frame={frame} guestName={guestName} cracks={cracks} />;

  // Panes that have started to fall, and the glass still standing behind
  // them drawn as one piece so there are no seams between static panes.
  const progress = order.map((_, k) => fallProgress(frame, fallStartOf(k)));
  const started = progress.filter((p) => p > 0).length;
  const standing: Point[] | null =
    frame < FALL_START ? null : standingPolygon(CRACK_SPEC, cracks, started);

  return (
    <AbsoluteFill>
      {idle || muted ? null : <CornerAudio crackCount={cracks.length} />}
      {frame < FALL_START ? (
        card
      ) : (
        <>
          {standing ? (
            <AbsoluteFill style={{ clipPath: toClipPath(standing) }}>
              {card}
            </AbsoluteFill>
          ) : null}
          {order.map((paneIndex, k) => (
            <FallingPane
              key={paneIndex}
              pane={panes[paneIndex]}
              p={progress[k]}
              tilt={(k % 2 === 0 ? 1 : -1) * (6 + k * 2)}
            >
              {card}
            </FallingPane>
          ))}
        </>
      )}
      {frame === FLASH_FRAME ? (
        <AbsoluteFill style={{ background: PAPER }} />
      ) : null}
    </AbsoluteFill>
  );
};
