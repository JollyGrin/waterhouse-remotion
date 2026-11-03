import React, { useId } from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import {
  CLEAR_FRAME,
  EXIT_SPEED,
  EXIT_START,
  HALF_GAP,
  MOSAIC_LEFT,
  MOSAIC_TILE,
  MOSAIC_TOP,
  RATTLE_TILE,
  STUCK_FIX,
  clacks,
  flapPlan,
  isBakedClack,
  tileState,
  type Face,
  type Tile,
  type TileState,
} from "./flap-plan";
import { noise, onTwos } from "./fx";
import { HEIGHT, WIDTH, brandFont, pullupSfx } from "./shared";

// Idea B - Split-flap. A departure board. The mosaic flips into the mark
// column by column, the two character rows clatter through letters to
// spell WATERHOUSE SESSIONS / WITH DENZO, one tile sticks and corrects
// itself late, then every flap turns once more in a diagonal wave and the
// other side of every flap is the stream. The schedule is flap-plan.ts.

// --- Timing (30 fps, 125 frames). The beats live in flap-plan.ts. ---
export const FLAP_DURATION = 125;
export const FLAP_CLEAR_FRAME = CLEAR_FRAME;
const HOLD_START = STUCK_FIX; // the rattle starts once the board has landed
const BOARD_LEAD = 1; // the board goes transparent a frame before its tiles flip
const BOARD_BAND = 2 * EXIT_SPEED; // px of (x + y) the board's fade spans
const PERSPECTIVE = 900;
const RATTLE_DEG = 1;

// Idle render (`--idle`): the finished board, one tile rattling, the tubes humming.
export const FLAP_IDLE_FRAME = 78;
export const FLAP_IDLE_DURATION = 60;

const BOARD = "#121214";
const GLYPH_BG = "#0e0e0e";
const GLYPH_INK = "#f2f2ee";
const GLYPH_SIZE = 54;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const WAVE_ORIGIN = MOSAIC_LEFT + MOSAIC_TOP + MOSAIC_TILE; // the first tile's centre, in x + y

const PLAN_DEFAULT = flapPlan(null);

/** The board's (x + y) below which it is fully transparent, at `frame`. */
export function boardFront(frame: number): number {
  if (frame < EXIT_START) return -Infinity;
  return (frame - EXIT_START + BOARD_LEAD) * EXIT_SPEED + WAVE_ORIGIN;
}

const bevel = "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.7), inset 1px 0 0 rgba(255,255,255,0.04)";

/** One half of a face: the full tile face, clipped to its top or bottom half. */
const Half: React.FC<{ face: Face; w: number; h: number; part: "top" | "bottom"; style?: React.CSSProperties; shade?: number }> = ({
  face,
  w,
  h,
  part,
  style,
  shade = 0,
}) => {
  if (face.kind === "transparent") return null;
  const halfH = (h - HALF_GAP) / 2;
  const top = part === "top" ? 0 : halfH + HALF_GAP;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: w,
        height: halfH,
        overflow: "hidden",
        backfaceVisibility: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -top,
          width: w,
          height: h,
          background: face.kind === "color" ? face.fill : GLYPH_BG,
          boxShadow: bevel,
          color: GLYPH_INK,
          fontFamily: brandFont,
          fontSize: GLYPH_SIZE,
          lineHeight: `${h}px`,
          textAlign: "center",
        }}
      >
        {face.kind === "glyph" ? face.char : null}
      </div>
      {/* The split line's own bevel, and the shade when the half tilts. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: part === "top" ? halfH - 1 : 0, height: 1, background: part === "top" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.08)" }} />
      {shade > 0 ? <div style={{ position: "absolute", inset: 0, background: "#000", opacity: shade }} /> : null}
    </div>
  );
};

/** A split-flap tile at one state. Clipped to its own box: a tilting flap never paints outside. */
const FlapTile: React.FC<{ tile: Tile; state: TileState; rotate?: number }> = ({ tile, state, rotate = 0 }) => {
  const { from, to, progress: p, flipping } = state;
  const { w, h } = tile;
  const halfH = (h - HALF_GAP) / 2;
  const exit = to.kind === "transparent";
  const first = flipping && p < 0.5;
  const second = flipping && p >= 0.5;
  const p1 = Math.min(1, p / 0.5);
  const p2 = Math.max(0, (p - 0.5) / 0.5);
  return (
    <div
      style={{
        position: "absolute",
        left: tile.x,
        top: tile.y,
        width: w,
        height: h,
        overflow: "hidden",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    >
      {/* The top half: the next face already shows behind the falling flap. */}
      <Half face={flipping ? to : from} w={w} h={h} part="top" />
      {/* The bottom half: the current face, until the flap covers it - or,
          on the way out, folding away from the viewer. */}
      {exit && second ? (
        <Half
          face={from}
          w={w}
          h={h}
          part="bottom"
          shade={0.6 * p2}
          style={{ transformOrigin: "50% 0%", transform: `perspective(${PERSPECTIVE}px) rotateX(${(-90 * p2).toFixed(2)}deg)` }}
        />
      ) : (
        <Half face={second ? from : from} w={w} h={h} part="bottom" />
      )}
      {/* The falling flap's shadow on the bottom half. */}
      {second && !exit && from.kind !== "transparent" ? (
        <div style={{ position: "absolute", left: 0, top: halfH + HALF_GAP, width: w, height: halfH, background: "linear-gradient(#000, rgba(0,0,0,0))", opacity: 0.55 * (1 - p2) }} />
      ) : null}
      {/* The flap itself: the old top falling, then the new bottom landing. */}
      {first ? (
        <Half
          face={from}
          w={w}
          h={h}
          part="top"
          shade={0.5 * p1}
          style={{ transformOrigin: "50% 100%", transform: `perspective(${PERSPECTIVE}px) rotateX(${(-90 * p1).toFixed(2)}deg)` }}
        />
      ) : null}
      {second && !exit ? (
        <Half
          face={to}
          w={w}
          h={h}
          part="bottom"
          shade={0.5 * (1 - p2)}
          style={{ transformOrigin: "50% 0%", transform: `perspective(${PERSPECTIVE}px) rotateX(${(90 * (1 - p2)).toFixed(2)}deg)` }}
        />
      ) : null}
    </div>
  );
};

const FlapAudio: React.FC<{ plan: Tile[] }> = ({ plan }) => {
  const live = clacks(plan).filter((c) => !isBakedClack(c));
  return (
    <>
      <Sequence durationInFrames={CLEAR_FRAME}>
        <Audio src={pullupSfx("presence")} volume={(f) => interpolate(f, [0, 8, EXIT_START, CLEAR_FRAME], [0, 0.1, 0.1, 0], clamp)} />
      </Sequence>
      <Sequence durationInFrames={CLEAR_FRAME}>
        <Audio src={staticFile("audio/bumper/fluoro.wav")} volume={(f) => interpolate(f, [0, 6, EXIT_START, CLEAR_FRAME - 4], [0, 0.16, 0.16, 0], clamp)} />
      </Sequence>
      {/* The cascade, baked from the plan: mosaic, row 1, the fix, the exit. */}
      <Audio src={staticFile("audio/bumper/flap-cascade.wav")} volume={0.9} />
      {live.map((c, i) => (
        <Sequence key={i} from={c.frame} durationInFrames={4}>
          <Audio src={staticFile("audio/bumper/clack.wav")} volume={() => 0.9 * c.gain} playbackRate={c.rate} />
        </Sequence>
      ))}
    </>
  );
};

interface FlapProps {
  guestName: string | null;
  idle: boolean;
}

export const Flap: React.FC<FlapProps> = ({ guestName, idle }) => {
  const realFrame = useCurrentFrame();
  const uid = useId().replace(/:/g, "");
  const frame = idle ? FLAP_IDLE_FRAME : realFrame;
  const live = idle ? FLAP_IDLE_FRAME + realFrame : realFrame;

  if (frame >= CLEAR_FRAME) return null;

  const id = (s: string) => `flap-${s}-${uid}`;
  const plan = guestName ? flapPlan(guestName) : PLAN_DEFAULT;
  const exiting = frame >= EXIT_START;
  const front = boardFront(frame);
  // The fluorescent tubes: a 2 % flicker on twos, a touch more before they warm up.
  const flicker = 1 + (frame < 20 ? 0.05 : 0.02) * noise(3, onTwos(live));
  const rattling = frame >= HOLD_START && !exiting;
  const rattle = rattling ? RATTLE_DEG * (Math.floor(live / 2) % 2 === 0 ? 1 : -1) : 0;

  return (
    <AbsoluteFill>
      {idle ? null : <FlapAudio plan={plan} />}
      {/* The board: brushed near-black, vignette, fading to alpha in the wave. */}
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0, display: "block" }}>
        <defs>
          <filter id={id("brush")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.003 0.5" numOctaves={2} seed={5} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 1 1 0 -0.35" />
          </filter>
          <radialGradient id={id("vignette")} cx="0.5" cy="0.45" r="0.8">
            <stop offset="0.4" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.6} />
          </radialGradient>
          {/* The wave: along (1, 1), black (gone) below the front, white above. */}
          <linearGradient id={id("wave")} gradientUnits="userSpaceOnUse" x1={front / 2} y1={front / 2} x2={(front + BOARD_BAND) / 2} y2={(front + BOARD_BAND) / 2}>
            <stop offset="0" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id={id("board")} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={HEIGHT}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id("wave")})`} />
          </mask>
        </defs>
        <g mask={exiting ? `url(#${id("board")})` : undefined}>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={BOARD} />
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#${id("brush")})`} opacity={0.08 * flicker} />
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fff" opacity={0.03 * (flicker - 0.97)} />
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id("vignette")})`} />
        </g>
      </svg>
      {/* The tiles. */}
      <div style={{ position: "absolute", inset: 0 }}>
        {plan.map((tile) => (
          <FlapTile
            key={tile.id}
            tile={tile}
            state={tileState(tile, frame)}
            rotate={tile.kind === "mosaic" && tile.row === RATTLE_TILE.row && tile.col === RATTLE_TILE.col ? rattle : 0}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const FLAP_BEATS = {
  mosaic: 8,
  row1: 44,
  fix: STUCK_FIX,
  hold: HOLD_START,
  exit: EXIT_START,
  clear: CLEAR_FRAME,
};
