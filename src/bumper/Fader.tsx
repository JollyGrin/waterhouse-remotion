import React, { useId } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { LOGO_PIECE_ORDER, type LogoPiece } from "./Logo";
import { HandShape } from "./Paper";
import { dotText, dotTextWidth } from "./dot-font";
import {
  faderTravel,
  flickerOn,
  frameReaching,
  jitter,
  musicEnvelope,
  noise,
  punch,
  settleOvershoot,
  springTrack,
} from "./fx";
import { sampleLogoGrid } from "./logo-sample";
import { HEIGHT, LIME, WIDTH, bodyFont, pullupSfx, recapSfx, withLine } from "./shared";

// Idea A - Fader up. Overhead view of one channel strip of a mixing desk.
// Denzo's hand pushes the fader up; each quarter of the throw unmutes a
// channel whose LED lights a piece of the mark on a dot-matrix panel, the
// VU needle swings, ON AIR lights, the hand hits PLAY, and the camera
// pushes into the panel until its dots open into the stream.

// --- Timing (30 fps, 120 frames). Tune beats here. ---
export const FADER_DURATION = 120;

const HAND_IN_START = 2; // the hand comes in from bottom right ...
const HAND_IN_END = 8; // ... thumb on the cap
const PUSH_START = 8; // the fader leaves 0 ...
const PUSH_END = 40; // ... and hits the end stop
const PUSH_ACCEL = 4; // frames of acceleration before constant speed
const OVERSHOOT_PX = 4; // past the end stop, then a damping-14 settle
const FLASH_FRAMES = 2; // overbright when a piece lights
const TICKER_START = 40; // "WATERHOUSE SESSIONS" scrolls in under the mark ...
const TICKER_COLS_PER_FRAME = 6; // ... this fast (1 col/frame cannot reach the centre by f56)
const ON_AIR_FRAME = 48; // the lamp, with three dropouts and a relay clunk
const NAME_FRAME = 52; // "with Denzo" on the second tape, hard cut
const HOLD_START = 56; // idle: needle on the music, ON AIR breathing
const HAND_TO_PLAY_START = 60; // the hand leaves the cap for the button ...
const HAND_TO_PLAY_END = 66;
const PLAY_FRAME = 68; // ... and presses it: clunk, white, punch-in 3 %
const PLAY_RELEASE = 74; // the button comes back up, the hand lifts away
const ZOOM_START = 72; // the push into the panel ...
const ZOOM_END = 96; // ... reaches its final scale; the hum peaks and cuts
const ZOOM_SCALE = 12; // dots are 96 px wide at this zoom
const HOLE_START = 84; // lit dots become alpha-0 holes; OBS transition point
const GROW_START = 90; // every dot grows x2, in rings from the centre ...
const GROW_RING_STAGGER = 0.7; // frames per ring
const GROW_FRAMES = 8;
const DOT_GROW = 2; // 1.8 leaves pinholes between the dots; 2 merges them
export const FADER_CLEAR_FRAME = 106; // nothing left

// Idle render (`--idle`): the strip held with the fader up.
export const FADER_IDLE_FRAME = 60;
export const FADER_IDLE_DURATION = 60;

// --- Layout (the console, in frame px) ---
const PANEL = { x: 480, y: 340, w: 960, h: 400 };
const PANEL_CX = PANEL.x + PANEL.w / 2;
const PANEL_CY = PANEL.y + PANEL.h / 2;
const DOT_COLS = 96;
const DOT_ROWS = 40;
const DOT_PITCH = 10;
const DOT_R = 4;
const LOGO_COLS = 46; // the mark's dots inside the panel ...
const LOGO_ROWS = 30;
const LOGO_COL0 = (DOT_COLS - LOGO_COLS) / 2;
const LOGO_ROW0 = 2;
const TICKER_ROW0 = 34; // ... and the ticker's rows
const SLOT = { x: 560, y: 900, w: 600, h: 14 }; // the fader slot; throw = w
const CAP = { w: 44, h: 72 };
const PLAY = { x: 1290, y: 846, s: 124, press: 6 };
const VU = { x: 700, y: 48, w: 520, h: 236 };
const VU_PIVOT = { x: VU.x + VU.w / 2, y: VU.y + VU.h - 10 };
const VU_NEEDLE = 196;
const LED_X = 436;
const LED_Y0 = 392;
const LED_STEP = 92;
const ON_AIR = { x: 80, y: 60, w: 250, h: 86 };
const TAPE1 = { x: 548, y: 950, w: 290, h: 46, rot: 2 };
const TAPE2 = { x: 880, y: 964, w: 300, h: 40, rot: -1.2 };

const METAL = "#2c2d31";
const METAL_LIGHT = "#3a3b40";
const PANEL_BLACK = "#050505";
const DOT_OFF = "#1a1a1a";
const FLASH = "#F2FFCC";
const CREAM = "#F2E8CF";
const RED = "#E8302A";
const TAPE = "#E9DDB5";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// --- Derived (pure, exported for the tests) ---

/** The fader's position 0..1 (before the overshoot). */
export const faderLevel = (frame: number) =>
  faderTravel(frame - PUSH_START, PUSH_END - PUSH_START, PUSH_ACCEL);

/** The frame each channel LED clicks on: the quarter marks of the throw. */
export const LED_FRAMES: Record<LogoPiece, number> = {
  house: frameReaching(faderLevel, 0.25, PUSH_START, PUSH_END),
  beamA: frameReaching(faderLevel, 0.5, PUSH_START, PUSH_END),
  beamB: frameReaching(faderLevel, 0.75, PUSH_START, PUSH_END),
  pillar: frameReaching(faderLevel, 1, PUSH_START, PUSH_END),
};

/** A dot's ring (distance from the panel centre, in dots). */
export const dotRing = (c: number, r: number) =>
  Math.round(Math.hypot(c - (DOT_COLS - 1) / 2, r - (DOT_ROWS - 1) / 2));

/** Growth of a hole in ring `ring` at `frame`: 1 (at rest) .. DOT_GROW. */
export function dotGrow(ring: number, frame: number): number {
  const t = (frame - GROW_START - ring * GROW_RING_STAGGER) / GROW_FRAMES;
  if (t <= 0) return 1;
  if (t >= 1) return DOT_GROW;
  return 1 + (DOT_GROW - 1) * (1 - Math.pow(1 - t, 2));
}

/** Has this ring's growth begun (the dot is a hole whether lit or not)? */
export const ringStarted = (ring: number, frame: number) =>
  frame >= GROW_START + ring * GROW_RING_STAGGER;

/** The ticker's leftmost column at `frame`, stepping in from the right edge. */
export function tickerCol(frame: number): number {
  const centre = Math.floor((DOT_COLS - dotTextWidth(TICKER_TEXT)) / 2);
  if (frame < TICKER_START) return DOT_COLS;
  return Math.max(centre, DOT_COLS - (frame - TICKER_START) * TICKER_COLS_PER_FRAME);
}

const TICKER_TEXT = "WATERHOUSE SESSIONS";
const TICKER_DOTS = dotText(TICKER_TEXT);
const LOGO_GRID = sampleLogoGrid(LOGO_COLS, LOGO_ROWS);

/** Camera scale: a 3 % punch on PLAY, then the push into the panel. */
export function cameraScale(frame: number): number {
  const push = interpolate(frame, [ZOOM_START, ZOOM_END], [1, ZOOM_SCALE], {
    easing: Easing.in(Easing.cubic),
    ...clamp,
  });
  return push * punch(frame, PLAY_FRAME, 0.03);
}

const needleTarget = (f: number) => faderLevel(f) * (0.55 + 0.45 * musicEnvelope(5, f));

/** A path of circles, so a few thousand dots are a handful of nodes. */
function circles(list: Array<[number, number, number]>): string {
  let d = "";
  for (const [cx, cy, r] of list) {
    d += `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`;
  }
  return d;
}

const dotX = (c: number) => PANEL.x + (c + 0.5) * DOT_PITCH;
const dotY = (r: number) => PANEL.y + (r + 0.5) * DOT_PITCH;

const FaderAudio: React.FC = () => (
  <>
    <Sequence durationInFrames={HOLE_START + 4}>
      <Audio src={pullupSfx("presence")} volume={(f) => interpolate(f, [0, 6, HOLE_START - 4, HOLE_START + 4], [0, 0.12, 0.12, 0], clamp)} />
    </Sequence>
    <Sequence durationInFrames={HOLE_START}>
      <Audio src={staticFile("audio/bumper/hum.wav")} volume={(f) => interpolate(f, [0, 10, HOLE_START - 10, HOLE_START], [0, 0.09, 0.09, 0], clamp)} />
    </Sequence>
    <Sequence from={PUSH_START} durationInFrames={PUSH_END - PUSH_START + 6}>
      <Audio src={staticFile("audio/bumper/fader.wav")} volume={0.8} />
    </Sequence>
    {LOGO_PIECE_ORDER.map((p) => (
      <Sequence key={p} from={LED_FRAMES[p]} durationInFrames={6}>
        <Audio src={staticFile("audio/bumper/led-click.wav")} volume={0.7} playbackRate={1 + 0.06 * LOGO_PIECE_ORDER.indexOf(p)} />
      </Sequence>
    ))}
    <Sequence from={ON_AIR_FRAME} durationInFrames={12}>
      <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.8} />
    </Sequence>
    <Sequence from={NAME_FRAME} durationInFrames={4}>
      <Audio src={recapSfx("tick")} volume={0.6} />
    </Sequence>
    <Sequence from={PLAY_FRAME} durationInFrames={14}>
      <Audio src={staticFile("audio/bumper/clunk.wav")} volume={0.9} />
    </Sequence>
    <Sequence from={PLAY_FRAME} durationInFrames={4}>
      <Audio src={pullupSfx("click")} volume={0.5} />
    </Sequence>
    <Sequence from={ZOOM_START} durationInFrames={ZOOM_END - ZOOM_START}>
      <Audio src={staticFile("audio/bumper/rise.wav")} volume={(f) => interpolate(f, [0, ZOOM_END - ZOOM_START - 1], [0.3, 1], clamp)} />
    </Sequence>
  </>
);

interface FaderProps {
  guestName: string | null;
  idle: boolean;
}

export const Fader: React.FC<FaderProps> = ({ guestName, idle }) => {
  const realFrame = useCurrentFrame();
  const uid = useId().replace(/:/g, "");
  const frame = idle ? FADER_IDLE_FRAME : realFrame;
  // In the idle loop the needle keeps dancing and ON AIR keeps breathing.
  const live = idle ? FADER_IDLE_FRAME + realFrame : realFrame;

  if (frame >= FADER_CLEAR_FRAME) return null;

  const id = (s: string) => `fader-${s}-${uid}`;
  const holes = frame >= HOLE_START;

  // --- The fader and the hand ---
  const level = faderLevel(frame);
  const overshoot = settleOvershoot(frame - PUSH_END, OVERSHOOT_PX);
  const capX = SLOT.x + level * SLOT.w + overshoot;
  const capCY = SLOT.y + SLOT.h / 2;
  const handIn = interpolate(frame, [HAND_IN_START, HAND_IN_END], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const toPlay = interpolate(frame, [HAND_TO_PLAY_START, HAND_TO_PLAY_END], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const pressed = frame >= PLAY_FRAME && frame < PLAY_RELEASE;
  const press = pressed ? PLAY.press : 0;
  const handLift = interpolate(frame, [PLAY_RELEASE, PLAY_RELEASE + 8], [0, 1], { easing: Easing.in(Easing.quad), ...clamp });
  const tremor = jitter(4, live, 1);
  const onCap = { x: capX - 8 + overshoot * 1.5, y: capCY + 2 };
  const onPlay = { x: PLAY.x + PLAY.s / 2 + 6, y: PLAY.y + PLAY.s / 2 + 10 + press };
  const handTip = {
    x: onCap.x + (onPlay.x - onCap.x) * toPlay + (1 - handIn) * 720 + handLift * 520 + tremor.x,
    y: onCap.y + (onPlay.y - onCap.y) * toPlay - 40 * Math.sin(Math.PI * toPlay) + (1 - handIn) * 560 + handLift * 640 + tremor.y,
  };
  const handOn = frame >= HAND_IN_START && frame < PLAY_RELEASE + 8;
  const handTransform = `translate(${handTip.x.toFixed(1)} ${handTip.y.toFixed(1)}) rotate(-28) scale(0.92)`;

  // --- Meters, lamps ---
  const needle = springTrack(needleTarget, live, { damping: 6, stiffness: 100 });
  const needleDeg = Math.max(-45, Math.min(48, -42 + 86 * needle)) + 0.5 * noise(8, live);
  const onAir = flickerOn(9, frame, ON_AIR_FRAME, 3, 8);
  const onAirBreath = frame >= HOLD_START ? 1 + 0.1 * Math.sin(live / 7) : 1;
  const onAirGlow = onAir * onAirBreath;
  const ledOn = (p: LogoPiece) => frame >= LED_FRAMES[p];
  const ledFlash = (p: LogoPiece) => frame >= LED_FRAMES[p] && frame < LED_FRAMES[p] + FLASH_FRAMES;

  // --- The dot matrix ---
  const tCol = tickerCol(frame);
  const tickerSet = new Set<string>();
  if (frame >= TICKER_START) {
    for (const [c, r] of TICKER_DOTS) {
      const col = tCol + c;
      if (col >= 0 && col < DOT_COLS) tickerSet.add(`${col},${TICKER_ROW0 + r}`);
    }
  }
  const litByOpacity: Record<string, Array<[number, number, number]>> = {};
  const flashDots: Array<[number, number, number]> = [];
  const offDots: Array<[number, number, number]> = [];
  const holeDots: Array<[number, number, number]> = [];
  const rimDots: Array<[number, number, number]> = [];
  for (let r = 0; r < DOT_ROWS; r++) {
    for (let c = 0; c < DOT_COLS; c++) {
      const lc = c - LOGO_COL0;
      const lr = r - LOGO_ROW0;
      const piece = lc >= 0 && lc < LOGO_COLS && lr >= 0 && lr < LOGO_ROWS ? LOGO_GRID[lr][lc] : null;
      const lit = (piece !== null && ledOn(piece)) || tickerSet.has(`${c},${r}`);
      const x = dotX(c);
      const y = dotY(r);
      if (holes) {
        const ring = dotRing(c, r);
        const started = ringStarted(ring, frame);
        if (lit || started) {
          const rr = DOT_R * dotGrow(ring, frame);
          holeDots.push([x, y, rr]);
          if (lit && !started) rimDots.push([x, y, rr * 1.3]);
        } else {
          offDots.push([x, y, DOT_R]);
        }
        continue;
      }
      if (!lit) {
        offDots.push([x, y, DOT_R]);
      } else if (piece && ledFlash(piece)) {
        flashDots.push([x, y, DOT_R + 0.6]);
      } else {
        // Per-dot brightness variance, seeded: four buckets.
        const b = (0.72 + 0.28 * ((noise(c * 131 + r, 0) + 1) / 2)).toFixed(2);
        (litByOpacity[b] ??= []).push([x, y, DOT_R]);
      }
    }
  }

  // --- Camera ---
  const zoom = cameraScale(frame);
  const camera = `translate(${PANEL_CX} ${PANEL_CY}) scale(${zoom}) translate(${-PANEL_CX} ${-PANEL_CY})`;
  const vignetteOpacity = interpolate(frame, [ZOOM_START, HOLE_START], [1, 0], clamp);

  const scratches = Array.from({ length: 9 }, (_, i) => {
    const x1 = ((noise(21, i) + 1) / 2) * WIDTH;
    const y1 = ((noise(22, i) + 1) / 2) * HEIGHT;
    const len = 120 + ((noise(23, i) + 1) / 2) * 420;
    const a = noise(24, i) * 0.35;
    return { x1, y1, x2: x1 + len * Math.cos(a), y2: y1 + len * Math.sin(a), o: 0.06 + ((noise(25, i) + 1) / 2) * 0.1 };
  });

  const ledLabel = ["CH 1", "CH 2", "CH 3", "CH 4"];

  return (
    <AbsoluteFill>
      {idle ? null : <FaderAudio />}
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0, display: "block" }}>
        <defs>
          {/* The console: everything but the panel's rectangle (inset 1 px,
              so the panel overlaps it and the shared edge has no seam). */}
          <clipPath id={id("console")}>
            <path clipRule="evenodd" d={`M0 0H${WIDTH}V${HEIGHT}H0Z M${PANEL.x + 1} ${PANEL.y + 1}H${PANEL.x + PANEL.w - 1}V${PANEL.y + PANEL.h - 1}H${PANEL.x + 1}Z`} />
          </clipPath>
          <clipPath id={id("panel")}>
            <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} />
          </clipPath>
          {/* Brushed metal: turbulence stretched along x. */}
          <filter id={id("brush")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.004 0.6" numOctaves={2} seed={3} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.9  0 0 0 0 0.9  0 0 0 0 0.95  1 1 1 0 -0.3" />
          </filter>
          <filter id={id("grain")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={2} seed={11} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.5 1.5 1.5 0 -1.4" />
          </filter>
          <radialGradient id={id("vignette")} cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.5" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.55} />
          </radialGradient>
          <linearGradient id={id("glass")} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.22} />
            <stop offset="0.45" stopColor="#fff" stopOpacity={0.02} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={id("cap")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1c1c1e" />
            <stop offset="0.5" stopColor="#4c4c50" />
            <stop offset="1" stopColor="#18181a" />
          </linearGradient>
          <filter id={id("glow")} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={6} />
          </filter>
          <filter id={id("glow-big")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={18} />
          </filter>
          <filter id={id("soft")} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={10} />
          </filter>
          <filter id={id("rim")} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={1.2} />
          </filter>
          {/* The exit: holes cut from the panel. */}
          <mask id={id("holes")} maskUnits="userSpaceOnUse" x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h}>
            <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} fill="#fff" />
            <path d={circles(holeDots)} fill="#000" />
          </mask>
        </defs>

        <g transform={camera}>
          {/* --- The console --- */}
          <g clipPath={`url(#${id("console")})`}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={METAL} />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#${id("brush")})`} opacity={0.18} />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#${id("grain")})`} opacity={0.35} />
            {scratches.map((s, i) => (
              <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#d8d8dc" strokeWidth={1} opacity={s.o} />
            ))}
            {/* The panel's bezel and the screws. */}
            <rect x={PANEL.x - 14} y={PANEL.y - 14} width={PANEL.w + 28} height={PANEL.h + 28} rx={6} fill="#1b1b1e" stroke={METAL_LIGHT} strokeWidth={2} />
            {[[PANEL.x - 4, PANEL.y - 4], [PANEL.x + PANEL.w + 4, PANEL.y - 4], [PANEL.x - 4, PANEL.y + PANEL.h + 4], [PANEL.x + PANEL.w + 4, PANEL.y + PANEL.h + 4]].map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r={5} fill="#55565b" />
                <line x1={x - 3} y1={y - 3 + i} x2={x + 3} y2={y + 3 - i} stroke="#222" strokeWidth={1.2} />
              </g>
            ))}

            {/* ON AIR. */}
            <g>
              <rect x={ON_AIR.x} y={ON_AIR.y} width={ON_AIR.w} height={ON_AIR.h} rx={8} fill="#141416" stroke="#000" strokeWidth={2} />
              {onAirGlow > 0 ? (
                <rect x={ON_AIR.x} y={ON_AIR.y} width={ON_AIR.w} height={ON_AIR.h} rx={8} fill={RED} filter={`url(#${id("glow-big")})`} opacity={0.6 * onAirGlow} />
              ) : null}
              <rect x={ON_AIR.x + 8} y={ON_AIR.y + 8} width={ON_AIR.w - 16} height={ON_AIR.h - 16} rx={5} fill={onAirGlow > 0 ? RED : "#3a0d0c"} opacity={onAirGlow > 0 ? 0.75 + 0.25 * onAirGlow : 1} />
              <text x={ON_AIR.x + ON_AIR.w / 2} y={ON_AIR.y + ON_AIR.h / 2 + 14} textAnchor="middle" fontFamily={bodyFont} fontWeight={700} fontSize={40} letterSpacing={4} fill={onAirGlow > 0 ? "#fff3f2" : "#6a1c1a"}>
                ON AIR
              </text>
            </g>

            {/* The VU meter. */}
            <g>
              <rect x={VU.x - 10} y={VU.y - 10} width={VU.w + 20} height={VU.h + 20} rx={10} fill="#111" />
              <rect x={VU.x} y={VU.y} width={VU.w} height={VU.h} rx={6} fill={CREAM} />
              {/* Scale arc, ticks, red zone. */}
              {(() => {
                const r = VU_NEEDLE - 14;
                const arc = (a0: number, a1: number) => {
                  const p = (a: number) => [VU_PIVOT.x + r * Math.sin((a * Math.PI) / 180), VU_PIVOT.y - r * Math.cos((a * Math.PI) / 180)];
                  const [x0, y0] = p(a0);
                  const [x1, y1] = p(a1);
                  return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`;
                };
                return (
                  <>
                    <path d={arc(-42, 24)} stroke="#222" strokeWidth={3} fill="none" />
                    <path d={arc(24, 44)} stroke={RED} strokeWidth={7} fill="none" />
                    {[-42, -31, -20, -9, 2, 13, 24, 34, 44].map((a, i) => {
                      const rad = (a * Math.PI) / 180;
                      const inner = r - (i % 2 === 0 ? 18 : 10);
                      return (
                        <g key={a}>
                          <line x1={VU_PIVOT.x + inner * Math.sin(rad)} y1={VU_PIVOT.y - inner * Math.cos(rad)} x2={VU_PIVOT.x + r * Math.sin(rad)} y2={VU_PIVOT.y - r * Math.cos(rad)} stroke={a >= 24 ? RED : "#222"} strokeWidth={2} />
                          {i % 2 === 0 ? (
                            <text x={VU_PIVOT.x + (inner - 16) * Math.sin(rad)} y={VU_PIVOT.y - (inner - 16) * Math.cos(rad) + 6} textAnchor="middle" fontFamily={bodyFont} fontWeight={700} fontSize={16} fill={a >= 24 ? RED : "#222"}>
                              {["-20", "-10", "-5", "0", "+3"][i / 2]}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                  </>
                );
              })()}
              <text x={VU.x + 22} y={VU.y + VU.h - 22} fontFamily={bodyFont} fontWeight={700} fontSize={20} fill="#333">VU</text>
              <text x={VU.x + VU.w - 22} y={VU.y + VU.h - 22} textAnchor="end" fontFamily={bodyFont} fontSize={14} fill="#555">WATERHOUSE</text>
              {/* The needle and its shadow on the face. */}
              <g transform={`rotate(${needleDeg.toFixed(2)} ${VU_PIVOT.x} ${VU_PIVOT.y})`}>
                <line x1={VU_PIVOT.x + 2} y1={VU_PIVOT.y + 3} x2={VU_PIVOT.x + 2} y2={VU_PIVOT.y - VU_NEEDLE + 3} stroke="#000" strokeWidth={3} opacity={0.18} />
                <line x1={VU_PIVOT.x} y1={VU_PIVOT.y} x2={VU_PIVOT.x} y2={VU_PIVOT.y - VU_NEEDLE} stroke="#111" strokeWidth={2.5} strokeLinecap="round" />
              </g>
              <circle cx={VU_PIVOT.x} cy={VU_PIVOT.y} r={9} fill="#111" />
              {/* The glass. */}
              <rect x={VU.x} y={VU.y} width={VU.w} height={VU.h} rx={6} fill={`url(#${id("glass")})`} />
            </g>

            {/* Channel LEDs. */}
            {LOGO_PIECE_ORDER.map((p, i) => {
              const cy = LED_Y0 + i * LED_STEP;
              const on = ledOn(p);
              const flash = ledFlash(p);
              return (
                <g key={p}>
                  <circle cx={LED_X} cy={cy} r={13} fill="#121214" stroke="#000" strokeWidth={1.5} />
                  {on ? <circle cx={LED_X} cy={cy} r={flash ? 14 : 10} fill={flash ? FLASH : LIME} filter={`url(#${id("glow")})`} opacity={flash ? 1 : 0.8} /> : null}
                  <circle cx={LED_X} cy={cy} r={8} fill={on ? (flash ? FLASH : LIME) : "#2a3314"} />
                  <text x={LED_X - 24} y={cy + 6} textAnchor="end" fontFamily={bodyFont} fontWeight={700} fontSize={16} fill="#8e8f94">{ledLabel[i]}</text>
                </g>
              );
            })}

            {/* The fader: slot, scale, cap. */}
            <g>
              {[0, 0.25, 0.5, 0.75, 1].map((k) => (
                <g key={k}>
                  <line x1={SLOT.x + k * SLOT.w} y1={SLOT.y - 22} x2={SLOT.x + k * SLOT.w} y2={SLOT.y - 10} stroke="#9a9ba0" strokeWidth={2} />
                  <text x={SLOT.x + k * SLOT.w} y={SLOT.y - 28} textAnchor="middle" fontFamily={bodyFont} fontSize={15} fill="#9a9ba0">{["-∞", "-20", "-10", "-5", "0"][k * 4]}</text>
                </g>
              ))}
              <rect x={SLOT.x - 6} y={SLOT.y} width={SLOT.w + 12} height={SLOT.h} rx={4} fill="#09090a" />
              <rect x={SLOT.x - 6} y={SLOT.y} width={SLOT.w + 12} height={3} fill="#000" opacity={0.6} />
              {/* The cap's shadow, then the cap, then its grip ridge. */}
              <rect x={capX - CAP.w / 2 + 5} y={capCY - CAP.h / 2 + 6} width={CAP.w} height={CAP.h} rx={4} fill="#000" opacity={0.45} filter={`url(#${id("soft")})`} />
              <rect x={capX - CAP.w / 2} y={capCY - CAP.h / 2} width={CAP.w} height={CAP.h} rx={4} fill={`url(#${id("cap")})`} stroke="#0a0a0a" strokeWidth={1.5} />
              <rect x={capX - 2} y={capCY - CAP.h / 2 + 8} width={4} height={CAP.h - 16} fill="#e6e6ea" opacity={0.85} />
            </g>

            {/* The PLAY button. */}
            <g>
              <rect x={PLAY.x} y={PLAY.y + 8} width={PLAY.s} height={PLAY.s} rx={10} fill="#050505" />
              <rect x={PLAY.x} y={PLAY.y + press} width={PLAY.s} height={PLAY.s} rx={10} fill={pressed || frame >= PLAY_FRAME ? "#f4f4f6" : "#3b3c41"} stroke="#000" strokeWidth={2} />
              {frame >= PLAY_FRAME ? (
                <rect x={PLAY.x} y={PLAY.y + press} width={PLAY.s} height={PLAY.s} rx={10} fill="#fff" filter={`url(#${id("glow")})`} opacity={0.5} />
              ) : null}
              <polygon points={`${PLAY.x + 46},${PLAY.y + 34 + press} ${PLAY.x + 46},${PLAY.y + 90 + press} ${PLAY.x + 94},${PLAY.y + 62 + press}`} fill={frame >= PLAY_FRAME ? "#111" : "#9a9ba0"} />
            </g>

            {/* Masking tape, in marker. */}
            <g transform={`rotate(${TAPE1.rot} ${TAPE1.x + TAPE1.w / 2} ${TAPE1.y + TAPE1.h / 2})`}>
              <rect x={TAPE1.x} y={TAPE1.y} width={TAPE1.w} height={TAPE1.h} fill={TAPE} opacity={0.95} />
              <rect x={TAPE1.x} y={TAPE1.y} width={TAPE1.w} height={TAPE1.h} filter={`url(#${id("grain")})`} opacity={0.5} />
              <text x={TAPE1.x + 16} y={TAPE1.y + 33} fontFamily={bodyFont} fontWeight={700} fontSize={30} letterSpacing={2} fill="#1b1b1b">SESSIONS</text>
            </g>
            {frame >= NAME_FRAME ? (
              <g transform={`rotate(${TAPE2.rot} ${TAPE2.x + TAPE2.w / 2} ${TAPE2.y + TAPE2.h / 2})`}>
                <rect x={TAPE2.x} y={TAPE2.y} width={TAPE2.w} height={TAPE2.h} fill={TAPE} opacity={0.95} />
                <rect x={TAPE2.x} y={TAPE2.y} width={TAPE2.w} height={TAPE2.h} filter={`url(#${id("grain")})`} opacity={0.5} />
                <text x={TAPE2.x + 14} y={TAPE2.y + 28} fontFamily={bodyFont} fontWeight={700} fontSize={24} fill="#1b1b1b">{withLine(guestName)}</text>
              </g>
            ) : null}

            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id("vignette")})`} opacity={vignetteOpacity} />

            {/* The hand: its shadow on the console, then the silhouette. */}
            {handOn ? (
              <>
                <g transform={`translate(10 14) ${handTransform}`} opacity={0.4} filter={`url(#${id("soft")})`}>
                  <HandShape fill="#000" />
                </g>
                <g transform={handTransform}>
                  <HandShape fill="#1c1a17" />
                </g>
              </>
            ) : null}
          </g>

          {/* --- The dot-matrix panel --- */}
          {holes ? (
            <g mask={`url(#${id("holes")})`}>
              <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} fill={PANEL_BLACK} />
              {/* A lime rim around each open lit dot, on the panel only. */}
              {rimDots.length > 0 ? <path d={circles(rimDots)} fill={LIME} filter={`url(#${id("rim")})`} opacity={0.55} /> : null}
              <path d={circles(offDots)} fill={DOT_OFF} />
            </g>
          ) : (
            <g clipPath={`url(#${id("panel")})`}>
              <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} fill={PANEL_BLACK} />
              <path d={circles(offDots)} fill={DOT_OFF} />
              {/* One blur pass for every lit dot's glow. */}
              <g filter={`url(#${id("glow")})`} opacity={0.75}>
                {Object.entries(litByOpacity).map(([o, list]) => (
                  <path key={o} d={circles(list)} fill={LIME} opacity={Number(o)} />
                ))}
                {flashDots.length > 0 ? <path d={circles(flashDots)} fill={FLASH} /> : null}
              </g>
              {Object.entries(litByOpacity).map(([o, list]) => (
                <path key={o} d={circles(list)} fill={LIME} opacity={Number(o)} />
              ))}
              {flashDots.length > 0 ? <path d={circles(flashDots)} fill={FLASH} /> : null}
            </g>
          )}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export const FADER_BEATS = {
  hand: HAND_IN_START,
  push: PUSH_START,
  pushEnd: PUSH_END,
  leds: LOGO_PIECE_ORDER.map((p) => LED_FRAMES[p]),
  ticker: TICKER_START,
  onAir: ON_AIR_FRAME,
  name: NAME_FRAME,
  hold: HOLD_START,
  play: PLAY_FRAME,
  zoom: ZOOM_START,
  holes: HOLE_START,
  grow: GROW_START,
  clear: FADER_CLEAR_FRAME,
  dotPitch: DOT_PITCH,
  dotR: DOT_R,
};
