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
import { LOGO_VIEW_H, LOGO_VIEW_W, LogoPieces } from "./Logo";
import { HandShape } from "./Paper";
import { dropoutFrames, jaggedTop, jitter, noise, onTwos, punch, sweepFront, vhsWobble } from "./fx";
import { HEIGHT, WIDTH, bodyFont, brandFont, pullupSfx, withLine } from "./shared";

// Idea B - VHS. A black CRT. A hand pushes a labelled cassette into the
// VCR below the frame, the screen goes blue, PLAY, tracking bars, and the
// tape's own intro plays: the mark in white with wobble, chroma bleed,
// head-switching noise and dropouts. The picture rolls, snows, and the
// tracking locks in three sweeps that reveal the live scene.

// --- Timing (30 fps, 125 frames). Tune beats here. ---
export const VHS_DURATION = 125;

const CASSETTE_IN_START = 10; // the cassette rises from the bottom edge ...
const CASSETTE_IN_END = 22; // ... and is held
const PUNCH_FRAME = 24; // camera punch-in
const INSERT_START = 26; // the cassette slides down into the VCR ...
const INSERT_END = 30; // ... clunk
const BLUE_FRAME = 30; // blue screen, PLAY
const BARS_START = 34; // tracking bars sweep bottom to top ...
const BARS_END = 40; // ... and the tape's intro starts
const PICTURE_FRAME = 40;
const NAME_IN_START = 58; // "with Denzo" fades up
const NAME_IN_END = 64;
const HOLD_START = 70; // idle: wobble, hiss, dropouts
const ROLL_START = 82; // the picture rolls one screen height ...
const ROLL_END = 92;
const HEAVY_BARS_START = 84;
const SNOW_START = 94; // ... then snow, 6 frames
const SNOW_END = 100;
const LOCK_START = 100; // the tracking locks: three sweeps; OBS transition point
const SWEEPS = 3;
const SWEEP_LEN = 6;
const CLEAR_FRAME = LOCK_START + SWEEPS * SWEEP_LEN; // 118: nothing left
const WOBBLE_PX = 3;
const CHROMA_PX = 3;
const HEAD_SWITCH_ROWS = 12;
const DROPOUT_EVERY = 15;
const DROPOUTS = dropoutFrames(13, PICTURE_FRAME, LOCK_START, DROPOUT_EVERY);
const SLICE_H = 20; // the picture is cut into rows this tall for the wobble

// Idle render (`--idle`): the tape intro held, wobbling and hissing.
export const VHS_IDLE_FRAME = 74;
export const VHS_IDLE_DURATION = 60;

// --- Layout ---
const SCREEN_RX = 70; // the CRT's curved corners
const LOGO_W = 480;
const UNIT = LOGO_W / LOGO_VIEW_W;
const LOGO_H = LOGO_VIEW_H * UNIT;
const LOGO_LEFT = (WIDTH - LOGO_W) / 2;
const LOGO_TOP = 250;
const TITLE_Y = LOGO_TOP + LOGO_H + 92;
const TITLE_SIZE = 86;
const NAME_Y = TITLE_Y + 64;
const NAME_SIZE = 34;
const OSD_SIZE = 44;
const CASSETTE = { w: 640, h: 350, x: WIDTH / 2 - 320 + 60, restY: HEIGHT / 2 - 150 };
const STATIC_OPACITY = 0.08;
const SCANLINE_OPACITY = 0.22;

const BLUE = "#0000AA";
const OSD = "#F2F2F2";
const SHELL = "#121212";
const SHELL_EDGE = "#2b2b2b";
const LABEL = "#F4F1E8";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The date stamp a VCR would burn in: "NOV 03 2026". */
export function vhsDateStamp(d: Date): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${d.getFullYear()}`;
}

const VhsAudio: React.FC = () => (
  <>
    <Sequence durationInFrames={BLUE_FRAME + 4}>
      <Audio
        src={pullupSfx("presence")}
        volume={(f) => interpolate(f, [0, 6, BLUE_FRAME, BLUE_FRAME + 4], [0, 0.14, 0.14, 0], clamp)}
      />
    </Sequence>
    <Sequence from={INSERT_START} durationInFrames={40}>
      <Audio src={staticFile("audio/bumper/motor.wav")} volume={0.6} />
    </Sequence>
    <Sequence from={INSERT_END} durationInFrames={16}>
      <Audio src={staticFile("audio/bumper/clunk.wav")} />
    </Sequence>
    <Sequence from={BLUE_FRAME} durationInFrames={4}>
      <Audio src={pullupSfx("click")} volume={0.5} />
    </Sequence>
    <Sequence from={BLUE_FRAME} durationInFrames={CLEAR_FRAME - BLUE_FRAME}>
      <Audio
        src={staticFile("audio/bumper/hiss.wav")}
        volume={(f) =>
          interpolate(
            f,
            [0, 4, LOCK_START - BLUE_FRAME, CLEAR_FRAME - BLUE_FRAME],
            [0, 0.5, 0.5, 0],
            clamp,
          )
        }
      />
    </Sequence>
    <Sequence from={ROLL_START} durationInFrames={SNOW_START - ROLL_START + 8}>
      <Audio src={staticFile("audio/bumper/seek.wav")} volume={0.7} />
    </Sequence>
    <Sequence from={SNOW_START} durationInFrames={SNOW_END - SNOW_START + 4}>
      <Audio src={staticFile("audio/bumper/snow.wav")} volume={0.55} />
    </Sequence>
    {Array.from({ length: SWEEPS }, (_, k) => (
      <Sequence key={k} from={LOCK_START + k * SWEEP_LEN} durationInFrames={4}>
        <Audio src={pullupSfx("click")} volume={() => 0.35 - 0.08 * k} playbackRate={1.2 + 0.15 * k} />
      </Sequence>
    ))}
  </>
);

interface VhsProps {
  guestName: string | null;
  idle: boolean;
  // Skip the sound (the Track Matte's second copy).
  muted?: boolean;
  // The burnt-in date, bottom right. The render script passes today.
  date: string;
}

/** OSD lettering with a 1 px chroma misregistration (red left, cyan right). */
const Osd: React.FC<{ x: number; y: number; anchor?: "start" | "end"; children: React.ReactNode; opacity?: number }> = ({
  x,
  y,
  anchor = "start",
  children,
  opacity = 1,
}) => {
  const common = { x, y, textAnchor: anchor, fontFamily: brandFont, fontSize: OSD_SIZE, letterSpacing: 3 } as const;
  return (
    <g opacity={opacity}>
      <text {...common} fill="#FF3030" transform="translate(-1 0)">{children}</text>
      <text {...common} fill="#30E0FF" transform="translate(1 0)">{children}</text>
      <text {...common} fill={OSD}>{children}</text>
    </g>
  );
};

export const Vhs: React.FC<VhsProps> = ({ guestName, idle, muted, date }) => {
  const realFrame = useCurrentFrame();
  const uid = useId().replace(/:/g, "");
  const frame = idle ? VHS_IDLE_FRAME : realFrame;
  const live = realFrame; // wobble, hiss and dropouts keep moving in the idle render

  if (frame >= CLEAR_FRAME) return null;

  const id = (s: string) => `vhs-${s}-${uid}`;
  const seedStep = onTwos(live) % 1000;

  // --- Phases ---
  const blue = frame >= BLUE_FRAME && frame < PICTURE_FRAME;
  const picture = frame >= PICTURE_FRAME;
  const locking = frame >= LOCK_START;
  const front = sweepFront(frame, LOCK_START, SWEEPS, SWEEP_LEN, HEIGHT);
  // Tracking locks: the wobble dies with the first sweep; the CRT's lines
  // and vignette go with the sweeps.
  const lockT = interpolate(frame, [LOCK_START, LOCK_START + SWEEP_LEN], [0, 1], clamp);
  const crtOpacity = interpolate(frame, [LOCK_START, CLEAR_FRAME], [1, 0], clamp);
  const wobbleAmp = WOBBLE_PX * (1 - lockT);

  // --- The cassette ---
  const cassetteIn = interpolate(frame, [CASSETTE_IN_START, CASSETTE_IN_END], [0, 1], {
    easing: Easing.out(Easing.back(1.1)),
    ...clamp,
  });
  const insert = interpolate(frame, [INSERT_START, INSERT_END], [0, 1], {
    easing: Easing.in(Easing.quad),
    ...clamp,
  });
  const cassetteOn = frame >= CASSETTE_IN_START && frame < INSERT_END;
  const tremor = jitter(3, live, 1.5);
  const sway = 1.2 * Math.sin(live / 9);
  const cassetteY = interpolate(cassetteIn, [0, 1], [HEIGHT + 120, CASSETTE.restY]) + insert * (HEIGHT + 200);
  const zoom = punch(frame, PUNCH_FRAME, 0.04);

  // --- The roll, the bands, the snow ---
  const roll = interpolate(frame, [ROLL_START, ROLL_END], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const rollY = (roll * HEIGHT) % HEIGHT;
  const snow = frame >= SNOW_START && frame < SNOW_END;
  const heavy = frame >= HEAVY_BARS_START && frame < LOCK_START;
  const barsT = interpolate(frame, [BARS_START, BARS_END], [0, 1], clamp);
  const dropout = DROPOUTS.indexOf(frame) !== -1;
  const dropoutY = ((noise(17, frame) + 1) / 2) * (HEIGHT - 40) + 20;
  const dropoutW = 300 + ((noise(18, frame) + 1) / 2) * 700;
  const dropoutX = ((noise(19, frame) + 1) / 2) * (WIDTH - dropoutW);

  const nameOpacity = interpolate(frame, [NAME_IN_START, NAME_IN_END], [0, 1], clamp);
  const trackingBlink = Math.floor(live / 4) % 2 === 0;

  // The picture: the tape's intro, as one group used by every row.
  const pic = (color: string) => (
    <>
      <g transform={`translate(${LOGO_LEFT} ${LOGO_TOP}) scale(${UNIT})`}>
        <LogoPieces color={color} />
      </g>
      <text x={WIDTH / 2} y={TITLE_Y} textAnchor="middle" fontFamily={brandFont} fontSize={TITLE_SIZE} letterSpacing={4} fill={color}>
        WATERHOUSE SESSIONS
      </text>
      <text x={WIDTH / 2} y={NAME_Y} textAnchor="middle" fontFamily={bodyFont} fontWeight={700} fontSize={NAME_SIZE} letterSpacing={2} fill={color} opacity={nameOpacity}>
        {withLine(guestName)}
      </text>
    </>
  );

  // Tracking bands: where they are and how far they shove the rows.
  const bands: Array<{ y: number; h: number; dx: number }> = [];
  if (blue && barsT > 0) {
    for (let k = 0; k < 3; k++) {
      const y = HEIGHT - (barsT * (HEIGHT + 300) - k * 140);
      bands.push({ y, h: 70 + 30 * k, dx: 30 + 20 * noise(21 + k, seedStep) });
    }
  }
  if (heavy) {
    for (let k = 0; k < 3; k++) {
      const y = ((HEIGHT * 1.4 - ((live * 38 + k * 420) % (HEIGHT * 1.4))) + rollY) % (HEIGHT * 1.4) - 200;
      bands.push({ y, h: 90 + 40 * k, dx: 40 + 30 * noise(24 + k, seedStep) });
    }
  }
  const bandAt = (y: number) => bands.find((b) => y + SLICE_H > b.y && y < b.y + b.h);

  const rows = Math.ceil(HEIGHT / SLICE_H);
  const headSwitchY = HEIGHT - HEAD_SWITCH_ROWS;

  return (
    <AbsoluteFill>
      {idle || muted ? null : <VhsAudio />}
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0, display: "block" }}>
        <defs>
          {/* The picture, defined once; every row <use>s it. The chroma
              copies sit under the white: red 2 px left, cyan 2 px right. */}
          <g id={id("pic")}>
            <g opacity={0.85}>
              <g transform={`translate(${-CHROMA_PX} 0)`}>{pic("#FF2A2A")}</g>
              <g transform={`translate(${CHROMA_PX} 0)`}>{pic("#2AF0FF")}</g>
            </g>
            {pic("#fff")}
          </g>
          <clipPath id={id("screen")}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={SCREEN_RX} ry={SCREEN_RX} />
          </clipPath>
          {/* What is left of the picture during the lock: above the jagged
              front. Everything, bezel included, is clipped by this. */}
          <clipPath id={id("left")}>
            <polygon points={jaggedTop(WIDTH, front, 29, live, 48, 10)} />
          </clipPath>
          {Array.from({ length: rows }, (_, r) => (
            <clipPath key={r} id={id(`row${r}`)}>
              <rect x={-100} y={r * SLICE_H} width={WIDTH + 200} height={SLICE_H} />
            </clipPath>
          ))}
          <clipPath id={id("head")}>
            <rect x={0} y={headSwitchY} width={WIDTH} height={HEAD_SWITCH_ROWS} />
          </clipPath>
          <pattern id={id("scan")} patternUnits="userSpaceOnUse" width={4} height={3}>
            <rect x={0} y={2} width={4} height={1} fill="#000" />
          </pattern>
          <radialGradient id={id("vignette")} cx="0.5" cy="0.5" r="0.72">
            <stop offset="0.55" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.7} />
          </radialGradient>
          <filter id={id("static")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.9" numOctaves={1} seed={seedStep} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.8  0 0 0 0 0.8  0 0 0 0 0.8  1.2 1.2 1.2 0 -0.6" />
          </filter>
          <filter id={id("band-noise")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.02 0.9" numOctaves={1} seed={(seedStep + 7) % 1000} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.7  0 0 0 0 0.7  0 0 0 0 0.7  1.6 1.6 1.6 0 -0.9" />
          </filter>
        </defs>

        <g clipPath={locking ? `url(#${id("left")})` : undefined}>
          {/* The bezel: black to the frame edge, so the stinger starts opaque. */}
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#000" />

          <g clipPath={`url(#${id("screen")})`}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={blue ? BLUE : "#000"} />

            {/* No signal: grey static at 8 %. */}
            {!picture && !blue ? (
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#${id("static")})`} opacity={STATIC_OPACITY} />
            ) : null}

            {/* The tape's intro, row by row: wobble, roll, bands. */}
            {picture
              ? Array.from({ length: rows }, (_, r) => {
                  const y = r * SLICE_H;
                  const band = bandAt(y);
                  const isHead = y >= headSwitchY - SLICE_H;
                  let dx = vhsWobble(y, live, wobbleAmp);
                  if (band) dx += band.dx;
                  if (isHead) dx += 18 + 10 * noise(27, seedStep);
                  const dy = rollY;
                  return (
                    <g key={r} clipPath={`url(#${id(`row${r}`)})`}>
                      <g transform={`translate(${dx.toFixed(2)} ${dy.toFixed(2)})`}>
                        <use href={`#${id("pic")}`} />
                        {roll > 0 && roll < 1 ? <use href={`#${id("pic")}`} y={-HEIGHT} /> : null}
                      </g>
                    </g>
                  );
                })
              : null}

            {/* Tracking bands: desaturated noise over the shoved rows. */}
            {bands.map((b, i) => (
              <rect key={i} x={0} y={b.y} width={WIDTH} height={b.h} filter={`url(#${id("band-noise")})`} opacity={blue ? 0.55 : 0.75} />
            ))}

            {/* Head-switching noise: the bottom 12 rows. */}
            {picture && !locking ? (
              <g clipPath={`url(#${id("head")})`}>
                <rect x={0} y={headSwitchY} width={WIDTH} height={HEAD_SWITCH_ROWS} filter={`url(#${id("band-noise")})`} opacity={0.6} />
              </g>
            ) : null}

            {/* A dropout: one frame, one bright row. */}
            {picture && dropout ? (
              <rect x={dropoutX} y={dropoutY} width={dropoutW} height={2} fill="#fff" opacity={0.85} />
            ) : null}

            {/* Snow. */}
            {snow ? (
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#${id("static")})`} opacity={0.6} />
            ) : null}
            {/* The sweep's leading edge carries the last of the snow. */}
            {locking && front > 0 ? (
              <rect x={0} y={Math.max(0, front - 60)} width={WIDTH} height={60} filter={`url(#${id("static")})`} opacity={0.5 * crtOpacity + 0.1} />
            ) : null}

            {/* OSD. */}
            {blue ? (
              <>
                <Osd x={90} y={120}>PLAY</Osd>
                <polygon points="232,84 232,124 268,104" fill={OSD} />
              </>
            ) : null}
            {picture && !locking ? <Osd x={WIDTH - 90} y={HEIGHT - 70} anchor="end" opacity={0.85}>{date}</Osd> : null}
            {frame >= ROLL_START && frame < LOCK_START && trackingBlink ? <Osd x={90} y={HEIGHT - 70}>TRACKING</Osd> : null}

            {/* The CRT: scanlines and the barrel vignette, going with the lock. */}
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id("scan")})`} opacity={SCANLINE_OPACITY * crtOpacity} />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id("vignette")})`} opacity={crtOpacity} />
          </g>

          {/* The cassette, in the hand, in front of the set. */}
          {cassetteOn ? (
            <g transform={`translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2} ${-HEIGHT / 2})`}>
              <g transform={`translate(${CASSETTE.x + tremor.x} ${cassetteY + tremor.y}) rotate(${-3 + sway} ${CASSETTE.w / 2} ${CASSETTE.h / 2})`}>
                {/* The hand, behind the shell, fingertips over its top edge. */}
                <g transform={`translate(${CASSETTE.w * 0.3} ${-26}) rotate(-8) scale(1.15)`}>
                  <HandShape fill="#1c1a17" />
                </g>
                {/* The shell. */}
                <rect x={0} y={0} width={CASSETTE.w} height={CASSETTE.h} rx={14} fill={SHELL} stroke={SHELL_EDGE} strokeWidth={3} />
                <rect x={18} y={16} width={CASSETTE.w - 36} height={10} rx={3} fill={SHELL_EDGE} />
                <rect x={40} y={CASSETTE.h - 70} width={CASSETTE.w - 80} height={44} rx={6} fill="#0a0a0a" stroke={SHELL_EDGE} strokeWidth={2} />
                {/* The reel windows. */}
                <rect x={100} y={124} width={440} height={104} rx={8} fill="#060606" stroke={SHELL_EDGE} strokeWidth={2} />
                {[182, 458].map((cx, i) => (
                  <g key={i} transform={`translate(${cx} 176) rotate(${(live * 9 + i * 40) % 360})`}>
                    <circle r={44} fill="#2a2420" />
                    <circle r={36} fill="#3a2e22" />
                    <circle r={18} fill="#0e0e0e" />
                    {[0, 60, 120, 180, 240, 300].map((a) => (
                      <rect key={a} x={-4} y={-30} width={8} height={12} fill="#111" transform={`rotate(${a})`} />
                    ))}
                  </g>
                ))}
                <rect x={278} y={154} width={84} height={44} fill="#2a1d14" opacity={0.8} />
                {/* The label, a touch crooked, written in marker. */}
                <g transform={`translate(44 40) rotate(-1.6)`}>
                  <rect x={0} y={0} width={CASSETTE.w - 88} height={64} fill={LABEL} />
                  <line x1={0} y1={34} x2={CASSETTE.w - 88} y2={34} stroke="#c9c3b4" strokeWidth={1} />
                  <text x={14} y={44} fontFamily={bodyFont} fontWeight={700} fontSize={29} fill="#1a1a1a" transform="rotate(-0.8 14 44)">
                    WATERHOUSE SESSIONS — w/ DENZO
                  </text>
                </g>
              </g>
            </g>
          ) : null}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export const VHS_BEATS = {
  cassette: CASSETTE_IN_START,
  insert: INSERT_START,
  blue: BLUE_FRAME,
  picture: PICTURE_FRAME,
  hold: HOLD_START,
  roll: ROLL_START,
  snow: SNOW_START,
  lock: LOCK_START,
  dropouts: DROPOUTS,
  clear: CLEAR_FRAME,
};
