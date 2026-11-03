import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
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

// Idea 3 - The door. A white card with the small black mark; the mark's
// pillar piece is the door. It swings open on its left edge onto the live
// scene (alpha 0 where it stood), then the whole card rushes through that
// doorway.

// --- Timing (30 fps, 105 frames = 3.5 s). Tune beats here. ---
export const DOOR_DURATION = 105;

const KNOCK_FRAMES = [2, 7]; // two knocks during the opening hold
const NOD_START = 12; // roof peak dips ...
const NOD_END = 16; // ... and is back up
const NOD_PX = 10;
const DOOR_START = 16; // door swings open (spring, damping 16)
const DOOR_OPEN_DEG = -110;
const DOOR_SPRING = { damping: 16, stiffness: 200, mass: 1 };
const NAME_IN_START = 30; // "with Denzo" fades in ...
const NAME_IN_END = 40; // ... and the card is at rest: the idle state
const ZOOM_START = 40; // card scales about the doorway centre ...
const ZOOM_END = 96; // ... until the doorway edges have left the frame
const CLEAR_FRAME = 96; // from here: fully transparent
const WHOOSH_START = 82; // slowed 0.5x; peaks around f90
const WHOOSH_RATE = 0.5;

// Idle render (`--idle`): the open-door card held still, loopable.
export const DOOR_IDLE_FRAME = NAME_IN_END;
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

// The doorway is the pillar's own silhouette (slanted top and all), so the
// hole and the leaf are the same path. Its box on the card, in px:
const PILLAR = LOGO_PIECE_BOX.pillar;
const DOOR_LEFT = LOGO_LEFT + PILLAR.x * UNIT;
const DOOR_TOP = LOGO_TOP + PILLAR.y * UNIT;
const DOOR_W = PILLAR.w * UNIT;
const DOOR_H = PILLAR.h * UNIT;
const DOOR_CX = DOOR_LEFT + DOOR_W / 2;
const DOOR_CY = DOOR_TOP + DOOR_H / 2;
// The leaf's SVG is cut to the pillar's box; the hinge is the box's left edge.
const PILLAR_VIEW = `${PILLAR.x} ${PILLAR.y} ${PILLAR.w} ${PILLAR.h}`;

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

const nodAt = (frame: number) =>
  interpolate(
    frame,
    [NOD_START, (NOD_START + NOD_END) / 2, NOD_END],
    [0, NOD_PX, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

const DoorAudio: React.FC = () => (
  <>
    {KNOCK_FRAMES.map((f) => (
      <Sequence key={f} from={f} durationInFrames={8}>
        <Audio src={pullupSfx("thud")} volume={0.8} />
      </Sequence>
    ))}
    {/* The door: a pluck for the creak. */}
    <Sequence from={DOOR_START} durationInFrames={6}>
      <Audio src={pullupSfx("pop-you")} />
    </Sequence>
    <Sequence from={NAME_IN_START} durationInFrames={3}>
      <Audio src={recapSfx("tick")} />
    </Sequence>
    {/* Through the door: the recap whoosh at half speed. */}
    <Sequence
      from={WHOOSH_START}
      durationInFrames={DOOR_DURATION - WHOOSH_START}
    >
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
  const { fps } = useVideoConfig();
  const frame = idle ? DOOR_IDLE_FRAME : realFrame;

  if (frame >= CLEAR_FRAME) return null;

  const nod = nodAt(frame);
  const doorSpring = spring({
    frame: frame - DOOR_START,
    fps,
    config: DOOR_SPRING,
  });
  const doorDeg = frame < DOOR_START ? 0 : doorSpring * DOOR_OPEN_DEG;

  const nameOpacity = interpolate(
    frame,
    [NAME_IN_START, NAME_IN_END],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const zoom = interpolate(frame, [ZOOM_START, ZOOM_END], [1, ZOOM_SCALE], {
    easing: Easing.in(Easing.exp),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      {idle ? null : <DoorAudio />}
      <AbsoluteFill
        style={{
          transformOrigin: `${DOOR_CX}px ${DOOR_CY}px`,
          transform: `scale(${zoom})`,
        }}
      >
        {/* The card and the mark, with the doorway cut out of both. */}
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          <defs>
            <mask id="door-card-hole" maskUnits="userSpaceOnUse">
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fff" />
              <path
                d={LOGO_PATHS.pillar}
                fill="#000"
                transform={`translate(${LOGO_LEFT} ${LOGO_TOP}) scale(${UNIT})`}
              />
            </mask>
          </defs>
          <rect
            x={0}
            y={0}
            width={WIDTH}
            height={HEIGHT}
            fill={PAPER}
            mask="url(#door-card-hole)"
          />
          <g transform={`translate(${LOGO_LEFT} ${LOGO_TOP}) scale(${UNIT})`}>
            <LogoPieces
              color={INK}
              omit={["pillar"]}
              pieces={{
                house: {
                  // The peak nods; the base stays on the ground.
                  transform: `scaleY(${1 - nod / LOGO_H})`,
                  transformOrigin: "50% 100%",
                },
              }}
            />
          </g>
        </svg>

        {/* The door leaf: the pillar itself, hinged on its left edge. */}
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
            transform: `perspective(800px) rotateY(${doorDeg}deg)`,
            backfaceVisibility: "visible",
          }}
        >
          <path d={LOGO_PATHS.pillar} fill={INK} />
        </svg>

        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: CAPTION_TOP,
            textAlign: "center",
            fontFamily: bodyFont,
            fontSize: CAPTION_SIZE,
            letterSpacing: 1,
            color: INK,
          }}
        >
          [waterhouse sessions]
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: NAME_TOP,
            textAlign: "center",
            fontFamily: brandFont,
            fontSize: NAME_SIZE,
            lineHeight: 1,
            color: INK,
            opacity: nameOpacity,
          }}
        >
          {withLine(guestName)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
