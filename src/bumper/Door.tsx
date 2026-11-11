import React, { useId } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  LOGO_PATHS,
  LOGO_PIECE_BOX,
  LOGO_VIEW_H,
  LOGO_VIEW_W,
  LogoPieces,
} from "./Logo";
import { BoilDefs, ChromaticText, GrainDefs } from "./fx-layers";
import { punch, shake } from "./fx";
import {
  HEIGHT,
  INK,
  PAPER,
  WIDTH,
  bodyFont,
  brandFont,
  pullupSfx,
  recapSfx,
  withLine,
} from "./shared";

// Idea 3 - The door, round 2. A white card with the small black mark; the
// mark's pillar piece is the door. Someone walks up behind it, knocks, it
// swings open onto the live scene (alpha 0 where it stood), slams, opens
// again, and the whole card rushes through the doorway. A hand-held camera,
// a lit room behind the door, paper grain, misregistered type.

// --- Timing (30 fps, 120 frames = 4 s). Tune beats here. ---
export const DOOR_DURATION = 120;

// Beat grid: 4 hits at 120 bpm. Every sound lands on it (or its "and").
const BPM = 120;
const BEAT = Math.round((60 / BPM) * 30); // 15 frames
const GRID_START = 4;
const beat = (n: number) => GRID_START + n * BEAT; // 4, 19, 34, 49, 64
export const BEAT_GRID = [beat(0), beat(1), beat(2), beat(3)];

const KNOCK_FRAMES = [beat(0), beat(0) + Math.round(BEAT / 2)]; // knock, knock (the "and")
const SHADOW_IN_START = 8; // Denzo's shadow grows under the door ...
const SHADOW_IN_END = 16; // ... he is at the door
const SWING_START = beat(1); // first swing: open to ~70 deg (hinge spring, run 1)
const SWING_DEG = -70;
const SLAM_FRAME = beat(2); // the leaf hits the frame: hard thud
const SLAM_WINDUP = 4; // frames the leaf takes to come back
const SLAM_HOLD = 6; // closed, nothing moves ...
const OPEN_START = SLAM_FRAME + SLAM_HOLD; // ... then it opens fully (hinge spring, run 2)
const OPEN_DEG = -110;
const SHADOW_OUT_END = OPEN_START + 8; // Denzo has walked in
const NAME_FRAME = beat(3); // "with Denzo" cuts in, bounces
const PUSH_START = beat(4); // card rushes through the doorway ...
const PUSH_END = 112; // ... until the doorway edges have left the frame
const CLEAR_FRAME = 112; // from here: fully transparent
const CYMBAL_START = PUSH_START - 20; // reversed cymbal swells into the push
const WHOOSH_RATE = 0.5;

const HINGE_SPRING = { damping: 16, stiffness: 200, mass: 1 };
// Secondary motion: the house, roof and type react to the hinge 1-3 frames
// late with a looser spring (damping 8 = two visible wobbles).
const REACT_SPRING = { damping: 8, stiffness: 180, mass: 1 };
const JOLT_PX = 6; // house block
const ROOF_SKEW_DEG = 5; // roof wobble
const TYPE_BOUNCE_PX = 3;

// Camera.
const DRIFT_X = 0.015 * WIDTH; // idle drift, 1.5 %
const DRIFT_Y = 0.01 * HEIGHT;
const DRIFT_PERIOD = 150; // frames
const ROLL_DEG = 0.5;
const ROLL_PERIOD = 170;
const PUNCH = 0.03; // 4-frame punch-in on the hits
const SHAKE_PX = 12; // decays over 8 frames
// What each hit does to the camera and the building, as a fraction of the
// numbers above.
const IMPACTS: Array<{ at: number; k: number }> = [
  { at: SWING_START, k: 0.6 },
  { at: SLAM_FRAME, k: 1 },
  { at: OPEN_START, k: 0.45 },
  { at: PUSH_START, k: 0.5 },
];
const SMEAR_PER_DEG = 0.012; // leaf stretch per degree of swing in one frame
const SMEAR_MIN_DEG = 12; // only the fastest frames smear
const PUSH_BLUR_PX = 5; // screen px at the end of the push

// Light and texture.
const WEDGE_COLOR = "#FFD24A";
const WEDGE_OPACITY = 0.35;
const LEAF_SHADOW_OPACITY = 0.25;
const WALK_SHADOW_OPACITY = 0.22;
const GRAIN_OPACITY = 0.06; // of the specks; they cover about half the card
const BOIL_PX = 0.6; // logo edges, stepped every 2 frames
const TYPE_FRINGE_PX = 1;

// Idle render (`--idle`): the open door with the name on, held - but the
// camera keeps drifting and the edges keep boiling, so it is alive.
export const DOOR_IDLE_FRAME = 56;
export const DOOR_IDLE_DURATION = 60;

// --- Layout ---
const LOGO_W = 320; // px on the card
const UNIT = LOGO_W / LOGO_VIEW_W; // px per logo unit
const LOGO_H = LOGO_VIEW_H * UNIT; // ~213
const LOGO_LEFT = (WIDTH - LOGO_W) / 2;
const LOGO_TOP = 380;
const CAPTION_TOP = LOGO_TOP + LOGO_H + 26;
const CAPTION_SIZE = 30;
const NAME_TOP = CAPTION_TOP + 54;
const NAME_SIZE = 72;
// The card is bigger than the frame so the camera never shows its edge.
const CARD_MARGIN = 200;

// The doorway is the pillar's own silhouette (slanted top and all), so the
// hole and the leaf are the same path. Its box on the card, in px:
const PILLAR = LOGO_PIECE_BOX.pillar;
const DOOR_LEFT = LOGO_LEFT + PILLAR.x * UNIT;
const DOOR_TOP = LOGO_TOP + PILLAR.y * UNIT;
const DOOR_W = PILLAR.w * UNIT;
const DOOR_H = PILLAR.h * UNIT;
const DOOR_CX = DOOR_LEFT + DOOR_W / 2;
const DOOR_CY = DOOR_TOP + DOOR_H / 2;
const PILLAR_VIEW = `${PILLAR.x} ${PILLAR.y} ${PILLAR.w} ${PILLAR.h}`;
const LOGO_TRANSFORM = `translate(${LOGO_LEFT} ${LOGO_TOP}) scale(${UNIT})`;
// The hinge, in logo units (for the shadows) and in px (for the light).
const HINGE_U = { x: PILLAR.x, y: PILLAR.y + PILLAR.h };
const HINGE_PX = { x: DOOR_LEFT, y: DOOR_CY };

// The scale at which the doorway's edges are outside the frame on every
// side, plus a little margin. ~38x for a 57 px wide doorway.
const ZOOM_MARGIN = 1.04;
export const ZOOM_SCALE =
  ZOOM_MARGIN *
  Math.max(
    DOOR_CX / (DOOR_W / 2),
    (WIDTH - DOOR_CX) / (DOOR_W / 2),
    DOOR_CY / (DOOR_H / 2),
    (HEIGHT - DOOR_CY) / (DOOR_H / 2),
  );

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The leaf's hinge angle at `frame`, degrees (negative = open). */
function doorAngle(frame: number, fps: number): number {
  if (frame < SWING_START) return 0;
  const slamStart = SLAM_FRAME - SLAM_WINDUP;
  if (frame < slamStart) {
    return spring({ frame: frame - SWING_START, fps, config: HINGE_SPRING }) * SWING_DEG;
  }
  if (frame < SLAM_FRAME) {
    const from = spring({ frame: slamStart - SWING_START, fps, config: HINGE_SPRING }) * SWING_DEG;
    return interpolate(frame, [slamStart, SLAM_FRAME], [from, 0], {
      easing: Easing.in(Easing.quad),
      ...clamp,
    });
  }
  if (frame < OPEN_START) {
    // The slam's rebound: it bounces off the frame a few degrees.
    const t = frame - SLAM_FRAME;
    return t < 3 ? -6 * Math.sin((Math.PI * t) / 3) : 0;
  }
  return spring({ frame: frame - OPEN_START, fps, config: HINGE_SPRING }) * OPEN_DEG;
}

/** 1 at the hit, then a loose-spring settle; 0 before the hit. */
function reaction(frame: number, at: number, delay: number, fps: number): number {
  const t = frame - at - delay;
  if (t < 0) return 0;
  return 1 - spring({ frame: t, fps, config: REACT_SPRING });
}

const DoorAudio: React.FC = () => (
  <>
    {KNOCK_FRAMES.map((f) => (
      <Sequence key={f} from={f} durationInFrames={8}>
        <Audio src={pullupSfx("thud")} volume={0.8} />
      </Sequence>
    ))}
    <Sequence from={SWING_START} durationInFrames={14}>
      <Audio src={staticFile("audio/bumper/creak.wav")} />
    </Sequence>
    {/* The slam: the recap slam with a knock under it. */}
    <Sequence from={SLAM_FRAME} durationInFrames={10}>
      <Audio src={recapSfx("slam")} />
      <Audio src={pullupSfx("thud")} volume={0.6} />
    </Sequence>
    <Sequence from={OPEN_START} durationInFrames={14}>
      <Audio src={staticFile("audio/bumper/creak.wav")} volume={0.7} />
    </Sequence>
    <Sequence from={NAME_FRAME} durationInFrames={3}>
      <Audio src={recapSfx("tick")} />
    </Sequence>
    {/* Reversed cymbal into the push, then the recap whoosh at half speed. */}
    <Sequence from={CYMBAL_START} durationInFrames={PUSH_START - CYMBAL_START + 2}>
      <Audio src={staticFile("audio/bumper/cymbal-reverse.wav")} volume={0.9} />
    </Sequence>
    <Sequence from={PUSH_START} durationInFrames={DOOR_DURATION - PUSH_START}>
      <Audio src={recapSfx("whoosh")} playbackRate={WHOOSH_RATE} />
    </Sequence>
  </>
);

interface DoorProps {
  guestName: string | null;
  idle: boolean;
}

export const Door: React.FC<DoorProps> = ({ guestName, idle }) => {
  const realFrame = useCurrentFrame();
  // SVG ids must be unique per instance: the strip renders many copies.
  const uid = useId().replace(/:/g, "");
  const { fps } = useVideoConfig();
  // The story frame; `live` keeps the ambient motion going in the idle loop.
  const frame = idle ? DOOR_IDLE_FRAME : realFrame;
  const live = realFrame;

  if (frame >= CLEAR_FRAME) return null;

  // --- The door ---
  const deg = doorAngle(frame, fps);
  const dDeg = Math.abs(deg - doorAngle(frame - 1, fps));
  const open = Math.min(1, Math.abs(deg) / Math.abs(OPEN_DEG)); // 0..1
  const smear = dDeg > SMEAR_MIN_DEG ? 1 + SMEAR_PER_DEG * dDeg : 1;
  const leafBlur = dDeg > SMEAR_MIN_DEG ? Math.min(3, dDeg * 0.06) : 0;
  // The leaf only boils once it is clear of the hole it has to cover.
  const leafBoil = Math.min(1, Math.abs(deg) / 20);

  // --- Reactions: house, roof, type, each a little later than the hinge ---
  let jolt = 0;
  let roof = 0;
  let typeBounce = 0;
  for (const { at, k } of IMPACTS) {
    if (at === PUSH_START) continue;
    jolt += k * JOLT_PX * reaction(frame, at, 1, fps);
    roof += k * reaction(frame, at, 2, fps);
    typeBounce += k * TYPE_BOUNCE_PX * reaction(frame, at, 3, fps);
  }
  // The name lands with its own bounce.
  typeBounce += TYPE_BOUNCE_PX * reaction(frame, NAME_FRAME, 0, fps);
  const nameOn = frame >= NAME_FRAME;

  // --- Camera ---
  const driftX = DRIFT_X * Math.sin((2 * Math.PI * live) / DRIFT_PERIOD);
  const driftY = DRIFT_Y * Math.sin((2 * Math.PI * live) / (DRIFT_PERIOD * 1.27) + 1);
  const roll = ROLL_DEG * Math.sin((2 * Math.PI * live) / ROLL_PERIOD + 0.6);
  let camScale = 1;
  let shakeX = 0;
  let shakeY = 0;
  IMPACTS.forEach(({ at, k }, i) => {
    camScale *= punch(frame, at, PUNCH * k);
    const s = shake(frame, at, SHAKE_PX * k, 31 + i);
    shakeX += s.x;
    shakeY += s.y;
  });
  const camera = `translate(${driftX + shakeX}px, ${driftY + shakeY}px) rotate(${roll}deg) scale(${camScale})`;

  // --- The push ---
  const zoom = interpolate(frame, [PUSH_START, PUSH_END], [1, ZOOM_SCALE], {
    easing: Easing.in(Easing.exp),
    ...clamp,
  });
  // CSS filter blur is applied before the transform, so divide by the zoom
  // to get screen pixels.
  const pushBlur =
    interpolate(frame, [PUSH_START + 24, PUSH_END], [0, PUSH_BLUR_PX], clamp) / zoom;

  // --- Light: the lit room spills a warm wedge from the hinge ---
  const wedgeLen = 100 + 380 * open;
  const a1 = (-10 * open - 5) * (Math.PI / 180);
  const a2 = (40 * open + 5) * (Math.PI / 180);
  const am = (a1 + a2) / 2;
  const wedge = [
    [HINGE_PX.x, HINGE_PX.y],
    [HINGE_PX.x + wedgeLen * Math.cos(a1), HINGE_PX.y + wedgeLen * Math.sin(a1)],
    [HINGE_PX.x + wedgeLen * 1.08 * Math.cos(am), HINGE_PX.y + wedgeLen * 1.08 * Math.sin(am)],
    [HINGE_PX.x + wedgeLen * Math.cos(a2), HINGE_PX.y + wedgeLen * Math.sin(a2)],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
  const wedgeOpacity = WEDGE_OPACITY * Math.min(1, open * 3);

  // Denzo walks up behind the door, and in once it opens.
  const walk =
    interpolate(frame, [SHADOW_IN_START, SHADOW_IN_END], [0, 1], clamp) *
    interpolate(frame, [OPEN_START, SHADOW_OUT_END], [1, 0], clamp) *
    // breathing, so it is a person and not a decal
    (1 + 0.04 * Math.sin(live / 3));

  // Screen-space hole for the grain mask: the doorway after the push zoom.
  const holeTransform = `translate(${DOOR_CX} ${DOOR_CY}) scale(${zoom}) translate(${-DOOR_CX} ${-DOOR_CY}) ${LOGO_TRANSFORM}`;

  const boilU = BOIL_PX / UNIT / zoom; // logo units, so it stays 0.6 screen px through the push

  return (
    <AbsoluteFill>
      {idle ? null : <DoorAudio />}
      <AbsoluteFill style={{ transform: camera, transformOrigin: "50% 50%" }}>
        <AbsoluteFill
          style={{
            transformOrigin: `${DOOR_CX}px ${DOOR_CY}px`,
            transform: `scale(${zoom})`,
            filter: pushBlur > 0.01 ? `blur(${pushBlur}px)` : undefined,
          }}
        >
          {/* The card, the light, the shadows and the mark, with the doorway
              cut out of all of them. */}
          <svg
            width={WIDTH}
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}
          >
            <defs>
              <mask id={`door-card-hole-${uid}`} maskUnits="userSpaceOnUse">
                <rect
                  x={-CARD_MARGIN}
                  y={-CARD_MARGIN}
                  width={WIDTH + 2 * CARD_MARGIN}
                  height={HEIGHT + 2 * CARD_MARGIN}
                  fill="#fff"
                />
                <path d={LOGO_PATHS.pillar} fill="#000" transform={LOGO_TRANSFORM} />
              </mask>
              <linearGradient
                id={`door-wedge-${uid}`}
                gradientUnits="userSpaceOnUse"
                x1={HINGE_PX.x}
                y1={0}
                x2={HINGE_PX.x + wedgeLen}
                y2={0}
              >
                <stop offset="0" stopColor={WEDGE_COLOR} stopOpacity={1} />
                <stop offset="1" stopColor={WEDGE_COLOR} stopOpacity={0} />
              </linearGradient>
              <BoilDefs id={`door-boil-${uid}`} frame={live} px={boilU} />
            </defs>
            <g mask={`url(#door-card-hole-${uid})`}>
              <rect
                x={-CARD_MARGIN}
                y={-CARD_MARGIN}
                width={WIDTH + 2 * CARD_MARGIN}
                height={HEIGHT + 2 * CARD_MARGIN}
                fill={PAPER}
              />
              {wedgeOpacity > 0 ? (
                <polygon
                  points={wedge}
                  fill={`url(#door-wedge-${uid})`}
                  opacity={wedgeOpacity}
                  style={{ filter: "blur(6px)" }}
                />
              ) : null}
              <g transform={LOGO_TRANSFORM}>
                {/* The leaf's long soft shadow across the card. */}
                {open > 0.02 ? (
                  <path
                    d={LOGO_PATHS.pillar}
                    fill={INK}
                    opacity={LEAF_SHADOW_OPACITY * Math.min(1, open * 4)}
                    transform={`translate(${HINGE_U.x} ${HINGE_U.y}) skewY(${10 * open}) scale(${0.15 + 1.1 * open} 1) translate(${-HINGE_U.x} ${-HINGE_U.y})`}
                    style={{ filter: "blur(18px)" }}
                  />
                ) : null}
                {/* Someone on the other side of the door. */}
                {walk > 0.01 ? (
                  <ellipse
                    cx={PILLAR.x + PILLAR.w / 2 + 20}
                    cy={PILLAR.y + PILLAR.h + 10}
                    rx={150 * walk}
                    ry={30 * walk}
                    fill={INK}
                    opacity={WALK_SHADOW_OPACITY}
                    style={{ filter: "blur(14px)" }}
                  />
                ) : null}
                <g filter={`url(#door-boil-${uid})`} transform={`translate(0 ${jolt / UNIT})`}>
                  <LogoPieces
                    color={INK}
                    omit={["pillar"]}
                    pieces={{
                      house: {
                        // The roof wobbles about the base; the base stays put.
                        transform: `skewX(${ROOF_SKEW_DEG * roof}deg) scaleY(${1 - 0.02 * roof})`,
                        transformOrigin: "50% 100%",
                      },
                    }}
                  />
                </g>
              </g>
            </g>
          </svg>

          {/* The door leaf: the pillar itself, hinged on its left edge. Smears
              along its swing on the fastest frames. */}
          <svg
            width={DOOR_W}
            height={DOOR_H}
            viewBox={PILLAR_VIEW}
            style={{
              position: "absolute",
              left: DOOR_LEFT,
              top: DOOR_TOP,
              display: "block",
              overflow: "visible",
              transformOrigin: "0% 50%",
              transform: `perspective(800px) rotateY(${deg}deg) scaleX(${smear})`,
              backfaceVisibility: "visible",
              filter: leafBlur > 0 ? `blur(${leafBlur}px)` : undefined,
            }}
          >
            <defs>
              <BoilDefs id={`door-leaf-boil-${uid}`} frame={live} px={boilU * leafBoil} />
            </defs>
            <path
              d={LOGO_PATHS.pillar}
              fill={INK}
              filter={leafBoil > 0 ? `url(#door-leaf-boil-${uid})` : undefined}
            />
          </svg>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: CAPTION_TOP,
              transform: `translateY(${typeBounce}px)`,
              textAlign: "center",
              fontFamily: bodyFont,
              fontSize: CAPTION_SIZE,
              letterSpacing: 1,
            }}
          >
            <ChromaticText text="[waterhouse sessions]" color={INK} offset={TYPE_FRINGE_PX} />
          </div>
          {nameOn ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: NAME_TOP,
                transform: `translateY(${typeBounce}px)`,
                textAlign: "center",
                fontFamily: brandFont,
                fontSize: NAME_SIZE,
                lineHeight: 1,
              }}
            >
              <ChromaticText text={withLine(guestName)} color={INK} offset={TYPE_FRINGE_PX} />
            </div>
          ) : null}
        </AbsoluteFill>

        {/* Paper grain, in screen space so the push does not blow it up,
            masked by the doorway at its current zoom so it never paints
            over the live scene. */}
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ position: "absolute", inset: 0, display: "block", overflow: "visible", pointerEvents: "none" }}
        >
          <defs>
            <GrainDefs id={`door-grain-${uid}`} seed={11} />
            <mask id={`door-grain-hole-${uid}`} maskUnits="userSpaceOnUse">
              <rect
                x={-CARD_MARGIN}
                y={-CARD_MARGIN}
                width={WIDTH + 2 * CARD_MARGIN}
                height={HEIGHT + 2 * CARD_MARGIN}
                fill="#fff"
              />
              <path d={LOGO_PATHS.pillar} fill="#000" transform={holeTransform} />
            </mask>
          </defs>
          <g mask={`url(#door-grain-hole-${uid})`}>
            <rect
              x={-CARD_MARGIN}
              y={-CARD_MARGIN}
              width={WIDTH + 2 * CARD_MARGIN}
              height={HEIGHT + 2 * CARD_MARGIN}
              filter={`url(#door-grain-${uid})`}
              opacity={GRAIN_OPACITY}
            />
          </g>
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Exported for tests: the hinge angle is the one thing the whole piece hangs on.
export const doorAngleAt = (frame: number) => doorAngle(frame, 30);
export const DOOR_BEATS = {
  knocks: KNOCK_FRAMES,
  swing: SWING_START,
  slam: SLAM_FRAME,
  open: OPEN_START,
  name: NAME_FRAME,
  push: PUSH_START,
  clear: CLEAR_FRAME,
};
