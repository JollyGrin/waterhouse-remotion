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
  LOGO_PIECE_ORDER,
  LOGO_VIEW_H,
  LOGO_VIEW_W,
  type LogoPiece,
} from "./Logo";
import { GrainDefs } from "./fx-layers";
import { jitter, noise, onTwos, tornPolygon } from "./fx";
import {
  HEIGHT,
  INK,
  WIDTH,
  bodyFont,
  brandFont,
  recapSfx,
  withLine,
} from "./shared";

// Idea B - Paper cut-out. A camera looks straight down at a sheet of warm
// paper. The four pieces of the mark drop in as black card, a printed strip
// and a torn scrap follow, a hand flicks the pillar open (the live scene is
// under the sheet) and then lifts the whole sheet away. Everything moves on
// twos with a pixel of jitter: stop motion.

// --- Timing (30 fps, 115 frames). Tune beats here. ---
export const PAPER_DURATION = 115;

const DROP_START = 6; // first piece
const DROP_GAP = 8; // between pieces: house, beam A, beam B, pillar
const DROP_LEN = 10; // frames a piece takes to land
const DROP_ORDER: LogoPiece[] = ["house", "beamA", "beamB", "pillar"];
const dropFrame = (piece: LogoPiece) => DROP_START + DROP_ORDER.indexOf(piece) * DROP_GAP;
const landFrame = (piece: LogoPiece) => dropFrame(piece) + DROP_LEN;
const LAND_ROT_DEG = 3; // +-, seeded per piece
const STRIP_IN_START = 40; // the title strip is pushed in from the right, overshoots, settles at -2 deg by ~f52
const SCRAP_DROP = 48; // "with Denzo" scrap dropped
const HAND_IN_START = 62; // hand slides in from bottom right ...
const FLICK_FRAME = 70; // ... flicks the pillar open (alpha 0 through the hole)
const HESITATE_FRAMES = [78, 81]; // two micro-moves
const GRAB_FRAME = 84; // grabs the sheet by its bottom-right corner; OBS transition point
const LIFT_END = 108; // the sheet has left the frame
const CLEAR_FRAME = 108;
const JITTER_PX = 1;
const FLAP_DEG = -100;
const FLAP_SPRING = { damping: 12, stiffness: 160, mass: 1 };
const STRIP_SPRING = { damping: 11, stiffness: 120, mass: 1 };

// Idle render (`--idle`): the finished sheet held, boiling on twos.
export const PAPER_IDLE_FRAME = 56;
export const PAPER_IDLE_DURATION = 60;

// --- Layout ---
const TABLE = "#F2EBDD";
const CARD_EDGE = "#4a4a4a"; // the lighter cut edge of the black card
const LOGO_W = 520;
const UNIT = LOGO_W / LOGO_VIEW_W;
const LOGO_H = LOGO_VIEW_H * UNIT;
const LOGO_LEFT = (WIDTH - LOGO_W) / 2;
const LOGO_TOP = 290;
const STRIP_W = 760;
const STRIP_H = 96;
const STRIP_X = (WIDTH - STRIP_W) / 2;
const STRIP_Y = LOGO_TOP + LOGO_H + 54;
const STRIP_ROT = -2;
const SCRAP_W = 320;
const SCRAP_H = 72;
const SCRAP_X = 1130;
const SCRAP_Y = STRIP_Y + STRIP_H + 36;
const SCRAP_ROT = 4;
const GRAB = { x: WIDTH - 360, y: HEIGHT - 220 }; // where the fingers pinch the sheet
const GRAIN_OPACITY = 0.07;
const VIGNETTE = "rgba(70, 45, 20, 0.28)";

const PILLAR = LOGO_PIECE_BOX.pillar;
const PIECE_SEED: Record<LogoPiece, number> = { house: 1, beamA: 2, beamB: 3, pillar: 4 };
const pieceCentre = (p: LogoPiece) => {
  const b = LOGO_PIECE_BOX[p];
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; // logo units
};
const landRot = (p: LogoPiece) => noise(PIECE_SEED[p] * 17, 0) * LAND_ROT_DEG;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// The hand: a flat silhouette with the index fingertip at the origin and the
// arm running down-right. A photographed cut-out of Denzo's hand replaces
// this later; keep the tip at (0,0). The VHS idea holds its cassette with
// the same hand.
export const HandShape: React.FC<{ fill: string }> = ({ fill }) => (
  <g fill={fill}>
    <rect x={-24} y={-8} width={48} height={280} rx={24} />
    <ellipse cx={78} cy={340} rx={112} ry={122} />
    <rect x={28} y={200} width={50} height={150} rx={25} />
    <rect x={84} y={212} width={50} height={150} rx={25} />
    <rect x={140} y={236} width={46} height={130} rx={23} />
    <ellipse cx={-54} cy={300} rx={34} ry={74} transform="rotate(28 -54 300)" />
    <rect x={-30} y={420} width={220} height={400} />
  </g>
);

const PaperAudio: React.FC = () => (
  <>
    {DROP_ORDER.map((p) => (
      <Sequence key={p} from={landFrame(p)} durationInFrames={6}>
        <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.9} />
      </Sequence>
    ))}
    <Sequence from={STRIP_IN_START} durationInFrames={24}>
      <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.5} />
    </Sequence>
    <Sequence from={SCRAP_DROP + 4} durationInFrames={6}>
      <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.6} playbackRate={1.3} />
    </Sequence>
    <Sequence from={HAND_IN_START} durationInFrames={10}>
      <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.25} playbackRate={1.4} />
    </Sequence>
    <Sequence from={FLICK_FRAME} durationInFrames={4}>
      <Audio src={recapSfx("tick")} />
    </Sequence>
    {HESITATE_FRAMES.map((f) => (
      <Sequence key={f} from={f} durationInFrames={4}>
        <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.25} playbackRate={1.6} />
      </Sequence>
    ))}
    <Sequence from={GRAB_FRAME} durationInFrames={PAPER_DURATION - GRAB_FRAME}>
      <Audio src={staticFile("audio/bumper/rustle.wav")} playbackRate={0.8} />
    </Sequence>
  </>
);

interface PaperProps {
  guestName: string | null;
  idle: boolean;
}

export const Paper: React.FC<PaperProps> = ({ guestName, idle }) => {
  const realFrame = useCurrentFrame();
  // SVG ids must be unique per instance: the strip renders many copies.
  const uid = useId().replace(/:/g, "");
  const { fps } = useVideoConfig();
  const frame = idle ? PAPER_IDLE_FRAME : realFrame;
  if (frame >= CLEAR_FRAME) return null;

  // Stop motion: the story is stepped on twos; the boil runs on the real
  // frame so the idle loop is alive too.
  const f2 = onTwos(frame);
  const j2 = idle ? realFrame : frame;

  // --- The pillar flap and its hole ---
  const flapT = f2 - FLICK_FRAME;
  const flap = flapT < 0 ? 0 : spring({ frame: flapT, fps, config: FLAP_SPRING }) * FLAP_DEG;
  const holeOpen = f2 >= FLICK_FRAME;
  const pj = jitter(PIECE_SEED.pillar, j2, JITTER_PX);
  const pc = pieceCentre("pillar");
  // The pillar's resting transform, in SVG syntax (logo units inside the
  // translated group), shared by the hole and the flap so they coincide.
  const pillarRest = `translate(${LOGO_LEFT + pj.x} ${LOGO_TOP + pj.y}) scale(${UNIT}) rotate(${landRot("pillar")} ${pc.x} ${pc.y})`;

  // --- The lift ---
  const lift = interpolate(f2, [GRAB_FRAME, LIFT_END], [0, 1], {
    easing: Easing.in(Easing.cubic),
    ...clamp,
  });
  const liftScale = 1 + 0.6 * lift;
  const liftBlur = (3 * lift) / liftScale;
  const sheetTransform = `translate(${1500 * lift}px, ${-1750 * lift}px) rotate(${-8 * lift}deg) scale(${liftScale})`;
  const shadowDx = 24 + 140 * lift;
  const shadowDy = 32 + 180 * lift;
  const shadowBlur = 12 + 50 * lift;
  const shadowOpacity = lift === 0 ? 0 : 0.34 * interpolate(lift, [0, 0.8], [1, 0], clamp);

  // --- The hand ---
  let tip: { x: number; y: number };
  const flickTarget = { x: LOGO_LEFT + (PILLAR.x + PILLAR.w) * UNIT + 14, y: LOGO_TOP + (PILLAR.y + PILLAR.h * 0.8) * UNIT };
  if (f2 < HAND_IN_START) {
    tip = { x: WIDTH + 300, y: HEIGHT + 200 };
  } else if (f2 < FLICK_FRAME) {
    const p = interpolate(f2, [HAND_IN_START, FLICK_FRAME], [0, 1], { easing: Easing.out(Easing.quad), ...clamp });
    tip = { x: WIDTH + 300 + (flickTarget.x - WIDTH - 300) * p, y: HEIGHT + 200 + (flickTarget.y - HEIGHT - 200) * p };
  } else if (f2 < GRAB_FRAME - 4) {
    // Follow-through on the flick, then two micro-moves.
    const through = interpolate(f2, [FLICK_FRAME, FLICK_FRAME + 6], [0, -46], { easing: Easing.out(Easing.quad), ...clamp });
    const h0 = f2 >= HESITATE_FRAMES[0] ? 7 : 0;
    const h1 = f2 >= HESITATE_FRAMES[1] ? -6 : 0;
    tip = { x: flickTarget.x + through + h0, y: flickTarget.y + h1 + h0 * 0.5 };
  } else {
    const p = interpolate(f2, [GRAB_FRAME - 4, GRAB_FRAME], [0, 1], { easing: Easing.out(Easing.quad), ...clamp });
    const from = { x: flickTarget.x - 46 + 7, y: flickTarget.y - 6 + 3.5 };
    tip = { x: from.x + (GRAB.x - from.x) * p, y: from.y + (GRAB.y - from.y) * p };
  }
  const hj = jitter(9, j2, JITTER_PX);
  // Pinching the corner the hand is further from the camera: smaller, flatter.
  const grabbing = f2 >= GRAB_FRAME - 4;
  const handRot = grabbing ? -35 : -38;
  const handScale = grabbing ? 0.78 : 1.05;
  const handTransform = `translate(${tip.x + hj.x} ${tip.y + hj.y}) rotate(${handRot}) scale(${handScale})`;
  const handVisible = f2 >= HAND_IN_START;

  // --- The strip and the scrap ---
  const stripS = f2 < STRIP_IN_START ? 0 : spring({ frame: f2 - STRIP_IN_START, fps, config: STRIP_SPRING });
  const stripX = interpolate(stripS, [0, 1], [WIDTH + 100, STRIP_X]);
  const stripRot = STRIP_ROT * stripS;
  const sj = jitter(21, j2, JITTER_PX);
  const scrapP = interpolate(f2, [SCRAP_DROP, SCRAP_DROP + 6], [0, 1], { easing: Easing.out(Easing.quad), ...clamp });
  const scrapH = 1 - scrapP; // "height" above the sheet
  const cj = jitter(33, j2, JITTER_PX);
  const scrapOn = f2 >= SCRAP_DROP;
  const torn = tornPolygon(SCRAP_W, SCRAP_H, 8, 12, 5);

  const piece = (p: LogoPiece) => {
    const start = dropFrame(p);
    if (f2 < start) return null;
    const prog = interpolate(f2, [start, start + DROP_LEN], [0, 1], { easing: Easing.out(Easing.quad), ...clamp });
    const h = 1 - prog; // 1 = high above the sheet
    const bounce = f2 === start + DROP_LEN ? 0.97 : 1;
    const scale = (1 + 0.3 * h) * bounce;
    const jt = p === "pillar" ? pj : jitter(PIECE_SEED[p], j2, JITTER_PX);
    const c = pieceCentre(p);
    const rot = landRot(p) * prog;
    const rest = `translate(${LOGO_LEFT + jt.x} ${LOGO_TOP + jt.y}) scale(${UNIT}) rotate(${rot} ${c.x} ${c.y})`;
    const lifted = `translate(${c.x} ${c.y}) scale(${scale}) translate(${-c.x} ${-c.y})`;
    const shadow = `translate(${(14 + 36 * h) / UNIT} ${(18 + 48 * h) / UNIT})`;
    const isFlap = p === "pillar" && holeOpen;
    return (
      <g key={p}>
        {/* Shadow: the piece again, black, blurred and offset by its height. */}
        {!isFlap ? (
          <path
            d={LOGO_PATHS[p]}
            fill="#000"
            opacity={0.32 - 0.1 * h}
            transform={`${rest} ${shadow} ${lifted}`}
            style={{ filter: `blur(${(3 + 18 * h) / UNIT}px)` }}
          />
        ) : null}
        {!isFlap ? (
          <path
            d={LOGO_PATHS[p]}
            fill={INK}
            stroke={CARD_EDGE}
            strokeWidth={2.5 / UNIT}
            transform={`${rest} ${lifted}`}
            style={{ paintOrder: "stroke", filter: h > 0.05 ? `blur(${(2.5 * h) / UNIT}px)` : undefined }}
          />
        ) : null}
      </g>
    );
  };

  const flapOpen = Math.min(1, Math.abs(flap) / 90);
  const flapShadowShift = (40 * Math.sin(Math.abs(flap) * (Math.PI / 180))) / UNIT;

  return (
    <AbsoluteFill>
      {idle ? null : <PaperAudio />}

      {/* The sheet's shadow on whatever is below, once it lifts. */}
      {shadowOpacity > 0 ? (
        <AbsoluteFill
          style={{
            transformOrigin: `${GRAB.x}px ${GRAB.y}px`,
            transform: `translate(${shadowDx}px, ${shadowDy}px) ${sheetTransform}`,
            background: "#000",
            opacity: shadowOpacity,
            filter: `blur(${shadowBlur / liftScale}px)`,
          }}
        />
      ) : null}

      {/* The sheet and everything on it. */}
      <AbsoluteFill
        style={{
          transformOrigin: `${GRAB.x}px ${GRAB.y}px`,
          transform: sheetTransform,
          filter: liftBlur > 0.02 ? `blur(${liftBlur}px)` : undefined,
        }}
      >
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}
        >
          <defs>
            <GrainDefs id={`paper-grain-${uid}`} seed={23} scale={1.3} />
            <radialGradient id={`paper-vignette-${uid}`} cx="50%" cy="50%" r="72%">
              <stop offset="0.45" stopColor={VIGNETTE} stopOpacity={0} />
              <stop offset="1" stopColor={VIGNETTE} />
            </radialGradient>
            <mask id={`paper-hole-${uid}`} maskUnits="userSpaceOnUse">
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fff" />
              {holeOpen ? <path d={LOGO_PATHS.pillar} fill="#000" transform={pillarRest} /> : null}
            </mask>
          </defs>

          <g mask={`url(#paper-hole-${uid})`}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={TABLE} />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#paper-grain-${uid})`} opacity={GRAIN_OPACITY} />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#paper-vignette-${uid})`} />

            {/* The flap's shadow swings with it; under the hole it is cut away. */}
            {holeOpen && flapOpen > 0.02 ? (
              <path
                d={LOGO_PATHS.pillar}
                fill="#000"
                opacity={0.3}
                transform={`${pillarRest} translate(${flapShadowShift} ${flapShadowShift * 0.6}) translate(${PILLAR.x} 0) scale(${Math.max(0.08, Math.cos(Math.abs(flap) * (Math.PI / 180)) * 0.9 + 0.1)} 1) skewY(${-14 * flapOpen}) translate(${-PILLAR.x} 0)`}
                style={{ filter: `blur(${(4 + 10 * flapOpen) / UNIT}px)` }}
              />
            ) : null}

            {LOGO_PIECE_ORDER.map(piece)}

            {/* The title strip: a lighter paper, pushed in. */}
            {stripS > 0 ? (
              <g transform={`translate(${stripX + sj.x} ${STRIP_Y + sj.y}) rotate(${stripRot} ${STRIP_W / 2} ${STRIP_H / 2})`}>
                <rect x={5} y={7} width={STRIP_W} height={STRIP_H} fill="#000" opacity={0.26} style={{ filter: "blur(4px)" }} />
                <rect x={0} y={0} width={STRIP_W} height={STRIP_H} fill="#FBF7EE" />
                <text
                  x={STRIP_W / 2}
                  y={STRIP_H / 2 + 26}
                  textAnchor="middle"
                  fontFamily={brandFont}
                  fontSize={74}
                  letterSpacing={2}
                  fill={INK}
                >
                  WATERHOUSE SESSIONS
                </text>
              </g>
            ) : null}
          </g>
        </svg>

        {/* The torn scrap: CSS clip-path for the torn edge. */}
        {scrapOn ? (
          <>
            <div
              style={{
                position: "absolute",
                left: SCRAP_X + cj.x + 6 + 30 * scrapH,
                top: SCRAP_Y + cj.y + 8 + 40 * scrapH,
                width: SCRAP_W,
                height: SCRAP_H,
                background: "#000",
                opacity: 0.28 - 0.1 * scrapH,
                clipPath: `polygon(${torn})`,
                transform: `rotate(${SCRAP_ROT}deg) scale(${1 + 0.25 * scrapH})`,
                filter: `blur(${4 + 14 * scrapH}px)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: SCRAP_X + cj.x,
                top: SCRAP_Y + cj.y,
                width: SCRAP_W,
                height: SCRAP_H,
                background: "#FFFDF7",
                clipPath: `polygon(${torn})`,
                transform: `rotate(${SCRAP_ROT}deg) scale(${1 + 0.25 * scrapH})`,
                fontFamily: bodyFont,
                fontSize: 34,
                lineHeight: `${SCRAP_H}px`,
                textAlign: "center",
                color: INK,
                filter: scrapH > 0.05 ? `blur(${2 * scrapH}px)` : undefined,
              }}
            >
              {withLine(guestName)}
            </div>
          </>
        ) : null}

        {/* The flap itself: the pillar standing up on its left edge. */}
        {holeOpen ? (
          <svg
            width={WIDTH}
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ position: "absolute", inset: 0, display: "block", overflow: "visible", pointerEvents: "none" }}
          >
            <g transform={pillarRest}>
              <g
                style={{
                  transformBox: "view-box",
                  transformOrigin: `${PILLAR.x}px ${PILLAR.y + PILLAR.h / 2}px`,
                  transform: `perspective(${700 / UNIT}px) rotateY(${flap}deg)`,
                }}
              >
                <path d={LOGO_PATHS.pillar} fill={INK} stroke={CARD_EDGE} strokeWidth={2.5 / UNIT} style={{ paintOrder: "stroke" }} />
              </g>
            </g>
          </svg>
        ) : null}

        {/* The hand, with its own shadow, on top of everything. */}
        {handVisible ? (
          <svg
            width={WIDTH}
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ position: "absolute", inset: 0, display: "block", overflow: "visible", pointerEvents: "none" }}
          >
            {/* Its shadow falls on the sheet only, never through the hole. */}
            <g mask={`url(#paper-hole-${uid})`}>
              <g transform={`${handTransform} translate(14 18)`} opacity={0.3} style={{ filter: "blur(8px)" }}>
                <HandShape fill="#000" />
              </g>
            </g>
            <g transform={handTransform}>
              <HandShape fill="#1c1a17" />
            </g>
          </svg>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const PAPER_BEATS = {
  drops: DROP_ORDER.map(dropFrame),
  strip: STRIP_IN_START,
  scrap: SCRAP_DROP,
  hand: HAND_IN_START,
  flick: FLICK_FRAME,
  grab: GRAB_FRAME,
  clear: CLEAR_FRAME,
};
