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
import { LOGO_PATHS, LOGO_PIECE_BOX, LOGO_PIECE_ORDER, LOGO_VIEW_H, LOGO_VIEW_W, type LogoPiece } from "./Logo";
import { neonStrike, noise, onTwos, rainStreaks, rainY } from "./fx";
import { HEIGHT, LIME, PURPLE, WIDTH, bodyFont, brandFont, pullupSfx, withLine } from "./shared";

// Idea A - Neon in the puddle. Night, rain, a dark wet wall. The mark is a
// neon sign that strikes tube by tube, its reflection lies in the puddle
// below, broken by raindrop rings. The camera tilts down into the puddle,
// the reflection fades, and the water clears to the live scene behind one
// last ring.

// --- Timing (30 fps, 120 frames). Tune beats here. ---
export const NEON_DURATION = 120;

const TUBE_ON: Record<LogoPiece, number> = { house: 8, beamA: 18, beamB: 26, pillar: 34 };
const STRIKE_WINDOW = 16; // frames of dropouts after each tube's switch
const TITLE_ON = 44; // "WATERHOUSE SESSIONS", purple, one strike
const NAME_ON = 52; // "with Denzo", a small white tube
const HOLD_START = 60; // idle: rain, rings, beam B buzzing
const IDLE_DROPOUT_EVERY = 20; // beam B: a 2-frame dropout every ~20 frames
const TILT_START = 72; // the camera tilts down into the puddle ...
const TILT_END = 100; // ... which fills the frame; OBS transition point
const RIPPLE_CALM_START = 80; // the displacement goes to 0 ...
const RIPPLE_CALM_END = 94;
const REFLECTION_FADE_START = 86; // ... and the reflected sign fades out
const REFLECTION_FADE_END = 100;
const CLEAR_START = 100; // the last ring expands, alpha 0 inside it ...
const CLEAR_FRAME = 112; // ... and nothing is left
const RING_FRAMES = 24; // a raindrop ring's life
// Raindrop hits on the puddle: frame and position across the ground.
const DROPS: Array<{ frame: number; x: number; depth: number }> = [
  { frame: 46, x: 0.38, depth: 0.42 },
  { frame: 55, x: 0.66, depth: 0.2 },
  { frame: 63, x: 0.5, depth: 0.7 },
  { frame: 71, x: 0.3, depth: 0.55 },
  { frame: 77, x: 0.74, depth: 0.85 },
];
const RAIN_COUNT = 52;

// Idle render (`--idle`): the lit sign held, rain and rings, beam B buzzing.
export const NEON_IDLE_FRAME = 64;
export const NEON_IDLE_DURATION = 60;

// --- Layout ---
const GROUND_Y = 740; // the horizon: wall above, wet ground below
const SCENE_H = GROUND_Y + HEIGHT; // the ground runs a full frame below the horizon
const LOGO_W = 560;
const UNIT = LOGO_W / LOGO_VIEW_W;
const LOGO_H = LOGO_VIEW_H * UNIT;
const LOGO_LEFT = (WIDTH - LOGO_W) / 2;
const LOGO_TOP = 150;
const TITLE_Y = LOGO_TOP + LOGO_H + 86;
const TITLE_SIZE = 84;
const NAME_Y = TITLE_Y + 62;
const NAME_SIZE = 34;
const REFLECTION_SQUASH = 0.8; // the puddle is seen at an angle until the tilt
const RIPPLE_PX = 4; // +-, the reflection's displacement while it rains

const WALL = "#17141c";
const WALL_LIGHT = "#2a2431";
const GROUND = "#0a0c13";
const SKY_IN_PUDDLE = "#1b2236";
const TUBE_WHITE = "#F4FFE0";
const PURPLE_CORE = "#E6D6FF";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const RAIN = rainStreaks(RAIN_COUNT, 5, WIDTH);

/** Beam B's idle buzz: a 2-frame dropout every ~20 frames, from the hold. */
export function idleDropout(frame: number): boolean {
  if (frame < HOLD_START) return false;
  const k = Math.floor((frame - HOLD_START) / IDLE_DROPOUT_EVERY);
  const at = HOLD_START + k * IDLE_DROPOUT_EVERY + Math.round(((noise(77, k) + 1) / 2) * 12) + 2;
  return frame === at || frame === at + 1;
}

const NeonAudio: React.FC = () => (
  <>
    <Sequence durationInFrames={CLEAR_FRAME}>
      <Audio
        src={staticFile("audio/bumper/rain.wav")}
        volume={(f) => interpolate(f, [0, 8, CLEAR_START, CLEAR_FRAME], [0, 0.5, 0.5, 0], clamp)}
      />
    </Sequence>
    {/* The transformer: in from the first tube, a step louder per tube. */}
    <Sequence from={TUBE_ON.house} durationInFrames={CLEAR_START - TUBE_ON.house}>
      <Audio
        src={staticFile("audio/bumper/buzz.wav")}
        volume={(f) =>
          interpolate(
            f,
            [0, TUBE_ON.pillar - TUBE_ON.house, TILT_START - TUBE_ON.house, CLEAR_START - TUBE_ON.house],
            [0.25, 0.6, 0.6, 0],
            clamp,
          )
        }
      />
    </Sequence>
    {LOGO_PIECE_ORDER.map((p) => (
      <Sequence key={p} from={TUBE_ON[p]} durationInFrames={3}>
        <Audio src={staticFile("audio/bumper/neon-tick.wav")} volume={0.8} />
      </Sequence>
    ))}
    <Sequence from={TITLE_ON} durationInFrames={3}>
      <Audio src={staticFile("audio/bumper/neon-tick.wav")} playbackRate={0.8} />
    </Sequence>
    <Sequence from={NAME_ON} durationInFrames={3}>
      <Audio src={staticFile("audio/bumper/neon-tick.wav")} volume={0.6} playbackRate={1.3} />
    </Sequence>
    {DROPS.map((d) => (
      <Sequence key={d.frame} from={d.frame} durationInFrames={5}>
        <Audio src={staticFile("audio/bumper/drip.wav")} volume={() => 0.35 + 0.3 * d.depth} playbackRate={0.9 + 0.3 * d.x} />
      </Sequence>
    ))}
    <Sequence from={TILT_START} durationInFrames={TILT_END - TILT_START + 6}>
      <Audio src={pullupSfx("whoosh")} volume={0.18} playbackRate={0.55} />
    </Sequence>
  </>
);

interface NeonProps {
  guestName: string | null;
  idle: boolean;
}

/** One neon line: two blurred glows, the tube body, a white core. */
const Tube: React.FC<{
  children: React.ReactNode;
  color: string;
  core: string;
  brightness: number;
  glowFar: string;
  glowNear: string;
  width?: number;
}> = ({ children, color, core, brightness, glowFar, glowNear, width = 1 }) => {
  if (brightness <= 0) return null;
  const b = brightness;
  return (
    <g>
      <g filter={`url(#${glowFar})`} opacity={0.75 * b} stroke={color} strokeWidth={14 * width} fill="none">
        {children}
      </g>
      <g filter={`url(#${glowNear})`} opacity={0.9 * b} stroke={color} strokeWidth={9 * width} fill="none">
        {children}
      </g>
      <g stroke={color} strokeWidth={6.5 * width} fill="none" opacity={0.95 * b}>
        {children}
      </g>
      <g stroke={core} strokeWidth={2.6 * width} fill="none" opacity={b}>
        {children}
      </g>
    </g>
  );
};

export const Neon: React.FC<NeonProps> = ({ guestName, idle }) => {
  const realFrame = useCurrentFrame();
  const uid = useId().replace(/:/g, "");
  const frame = idle ? NEON_IDLE_FRAME : realFrame;
  const live = realFrame; // rain, rings and buzz keep moving in the idle render

  if (frame >= CLEAR_FRAME) return null;

  const id = (s: string) => `neon-${s}-${uid}`;

  // --- The tubes ---
  const tube: Record<LogoPiece, number> = {
    house: neonStrike(1, frame, TUBE_ON.house, STRIKE_WINDOW),
    beamA: neonStrike(2, frame, TUBE_ON.beamA, STRIKE_WINDOW),
    beamB: neonStrike(3, frame, TUBE_ON.beamB, STRIKE_WINDOW) * (idleDropout(live) ? 0.3 : 1),
    pillar: neonStrike(4, frame, TUBE_ON.pillar, STRIKE_WINDOW),
  };
  // The title strikes in one go: on, off, on, dim, on.
  const titleT = frame - TITLE_ON;
  const title = titleT < 0 ? 0 : titleT === 1 ? 0.1 : titleT === 3 ? 0.5 : 1;
  const name = frame >= NAME_ON ? 1 : 0;
  // Everything flickers a touch: a neon sign never sits perfectly still.
  const mains = 1 - 0.035 * ((noise(9, onTwos(live)) + 1) / 2);

  // --- The camera tilt ---
  const tilt = interpolate(frame, [TILT_START, TILT_END], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    ...clamp,
  });
  const cameraY = -tilt * GROUND_Y;
  const squash = interpolate(tilt, [0, 1], [REFLECTION_SQUASH, 1]);
  const ripple =
    RIPPLE_PX *
    interpolate(frame, [RIPPLE_CALM_START, RIPPLE_CALM_END], [1, 0], clamp);
  const reflectionOpacity = interpolate(frame, [REFLECTION_FADE_START, REFLECTION_FADE_END], [1, 0], clamp);

  // --- The last ring: the clearing front ---
  const clearT = interpolate(frame, [CLEAR_START, CLEAR_FRAME], [0, 1], {
    easing: Easing.out(Easing.quad),
    ...clamp,
  });
  const clearing = frame >= CLEAR_START;
  const ringRx = clearT * 1500;
  const ringRy = ringRx * 0.62;
  const ringC = { x: WIDTH * 0.5, y: HEIGHT * 0.56 };
  const ringOpacity = interpolate(clearT, [0, 0.15, 1], [0, 0.8, 0]);

  // --- Light spill on the wall: a warm pool around every lit tube ---
  const spill = (piece: LogoPiece) => {
    const b = LOGO_PIECE_BOX[piece];
    return {
      cx: LOGO_LEFT + (b.x + b.w / 2) * UNIT,
      cy: LOGO_TOP + (b.y + b.h / 2) * UNIT,
      rx: b.w * UNIT * 0.9 + 120,
      ry: b.h * UNIT * 0.9 + 120,
      o: tube[piece],
    };
  };

  const sign = (
    <>
      {LOGO_PIECE_ORDER.map((p) => (
        <Tube key={p} color={LIME} core={TUBE_WHITE} brightness={tube[p] * mains} glowFar={id("far")} glowNear={id("near")}>
          <path d={LOGO_PATHS[p]} vectorEffect="non-scaling-stroke" transform={`translate(${LOGO_LEFT} ${LOGO_TOP}) scale(${UNIT})`} strokeLinejoin="round" />
        </Tube>
      ))}
      <Tube color={PURPLE} core={PURPLE_CORE} brightness={title * mains} glowFar={id("far")} glowNear={id("near")} width={0.7}>
        <text x={WIDTH / 2} y={TITLE_Y} textAnchor="middle" fontFamily={brandFont} fontSize={TITLE_SIZE} letterSpacing={4} strokeLinejoin="round" paintOrder="stroke">
          WATERHOUSE SESSIONS
        </text>
      </Tube>
      {title > 0 ? (
        <text x={WIDTH / 2} y={TITLE_Y} textAnchor="middle" fontFamily={brandFont} fontSize={TITLE_SIZE} letterSpacing={4} fill={PURPLE_CORE} opacity={title * mains}>
          WATERHOUSE SESSIONS
        </text>
      ) : null}
      <Tube color="#ffffff" core="#ffffff" brightness={name * mains * 0.9} glowFar={id("far")} glowNear={id("near")} width={0.35}>
        <text x={WIDTH / 2} y={NAME_Y} textAnchor="middle" fontFamily={bodyFont} fontWeight={700} fontSize={NAME_SIZE} letterSpacing={2}>
          {withLine(guestName)}
        </text>
      </Tube>
      {name > 0 ? (
        <text x={WIDTH / 2} y={NAME_Y} textAnchor="middle" fontFamily={bodyFont} fontWeight={700} fontSize={NAME_SIZE} letterSpacing={2} fill="#fff" opacity={name * mains}>
          {withLine(guestName)}
        </text>
      ) : null}
    </>
  );

  // Raindrop rings on the water, in scene coordinates.
  const rings = DROPS.concat(
    // In the hold, the rain keeps hitting: one more ring every ~10 frames.
    idle || frame >= HOLD_START
      ? Array.from({ length: 6 }, (_, k) => ({
          frame: HOLD_START + 4 + k * 10,
          x: (noise(31, k) + 1) / 2,
          depth: (noise(32, k) + 1) / 2,
        }))
      : [],
  )
    .map((d) => {
      const t = (frame - d.frame) / RING_FRAMES;
      if (t < 0 || t >= 1) return null;
      const rx = 10 + t * 150;
      return (
        <ellipse
          key={`${d.frame}-${d.x}`}
          cx={d.x * WIDTH}
          cy={GROUND_Y + 40 + d.depth * 300}
          rx={rx}
          ry={rx * 0.28}
          fill="none"
          stroke="#cfd8e6"
          strokeWidth={1.5}
          opacity={0.45 * (1 - t) * (1 - t)}
        />
      );
    });

  return (
    <AbsoluteFill>
      {idle ? null : <NeonAudio />}
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0, display: "block" }}>
        <defs>
          {/* Fixed filter regions: a thin tube's own box would clip its glow
              into a visible rectangle. */}
          <filter id={id("far")} filterUnits="userSpaceOnUse" x={-200} y={-200} width={WIDTH + 400} height={SCENE_H + 400}>
            <feGaussianBlur stdDeviation={28} />
          </filter>
          <filter id={id("near")} filterUnits="userSpaceOnUse" x={-200} y={-200} width={WIDTH + 400} height={SCENE_H + 400}>
            <feGaussianBlur stdDeviation={8} />
          </filter>
          {/* Plaster: static fractal noise, low contrast. */}
          <filter id={id("plaster")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={4} seed={3} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0.9 0.9 0 -0.55" />
          </filter>
          {/* Film grain, re-seeded on twos. */}
          <filter id={id("grain")} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.8" numOctaves={1} seed={onTwos(live) % 1000} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.5 0.5 0.5 0 -0.5" />
          </filter>
          {/* The water: a soft blur and a displacement that steps on twos. */}
          <filter id={id("water")} x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation={1.4} result="soft" />
            <feTurbulence type="turbulence" baseFrequency="0.012 0.05" numOctaves={2} seed={(onTwos(live) / 2) % 1000} result="warp" />
            <feDisplacementMap in="soft" in2="warp" scale={ripple * 2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <linearGradient id={id("wall-v")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity={0.55} />
            <stop offset="0.5" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.35} />
          </linearGradient>
          <radialGradient id={id("vignette")} cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.5" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.6} />
          </radialGradient>
          <linearGradient id={id("ground")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SKY_IN_PUDDLE} />
            <stop offset="0.18" stopColor="#10141f" />
            <stop offset="1" stopColor={GROUND} />
          </linearGradient>
          <radialGradient id={id("spill")} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={LIME} stopOpacity={0.16} />
            <stop offset="0.5" stopColor={LIME} stopOpacity={0.05} />
            <stop offset="1" stopColor={LIME} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={id("spill-purple")} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={PURPLE} stopOpacity={0.22} />
            <stop offset="0.45" stopColor={PURPLE} stopOpacity={0.07} />
            <stop offset="1" stopColor={PURPLE} stopOpacity={0} />
          </radialGradient>
          {/* The reflection fades with depth and is only on the ground. */}
          <linearGradient id={id("refl-fade")} gradientUnits="userSpaceOnUse" x1="0" y1={GROUND_Y} x2="0" y2={GROUND_Y + 700}>
            <stop offset="0" stopColor="#fff" stopOpacity={0.75} />
            <stop offset="1" stopColor="#fff" stopOpacity={0.3} />
          </linearGradient>
          <mask id={id("refl-mask")} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={SCENE_H}>
            <rect x={0} y={GROUND_Y} width={WIDTH} height={HEIGHT} fill={`url(#${id("refl-fade")})`} />
          </mask>
          {/* The clearing: everything, minus the inside of the last ring. */}
          <mask id={id("clear")} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={HEIGHT}>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fff" />
            {clearing ? <ellipse cx={ringC.x} cy={ringC.y} rx={ringRx} ry={ringRy} fill="#000" /> : null}
          </mask>
        </defs>

        <g mask={clearing ? `url(#${id("clear")})` : undefined}>
          {/* The scene, taller than the frame, under the camera. */}
          <g transform={`translate(0 ${cameraY})`}>
            {/* Wall. */}
            <rect x={0} y={0} width={WIDTH} height={GROUND_Y} fill={WALL} />
            <rect x={0} y={0} width={WIDTH} height={GROUND_Y} fill={WALL_LIGHT} filter={`url(#${id("plaster")})`} opacity={0.5} />
            <rect x={0} y={0} width={WIDTH} height={GROUND_Y} fill={`url(#${id("wall-v")})`} />
            {LOGO_PIECE_ORDER.map((p) => {
              const s = spill(p);
              return s.o > 0 ? (
                <ellipse key={p} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={`url(#${id("spill")})`} opacity={s.o * mains} />
              ) : null;
            })}
            {title > 0 ? (
              <ellipse cx={WIDTH / 2} cy={TITLE_Y - 24} rx={760} ry={190} fill={`url(#${id("spill-purple")})`} opacity={title * mains} />
            ) : null}
            {/* Ground: wet, a strip of sky in it near the horizon. Drawn a
                pixel up over the wall's edge so the seam has no anti-aliased gap. */}
            <rect x={0} y={GROUND_Y - 1} width={WIDTH} height={HEIGHT + 1} fill={`url(#${id("ground")})`} />
            {/* The reflection: the sign flipped about the horizon, squashed,
                warped by the water, fainter with depth. */}
            {reflectionOpacity > 0 ? (
              <g mask={`url(#${id("refl-mask")})`} opacity={reflectionOpacity}>
                <g filter={`url(#${id("water")})`}>
                  <g transform={`translate(0 ${GROUND_Y}) scale(1 ${-squash}) translate(0 ${-GROUND_Y})`}>
                    {sign}
                  </g>
                </g>
              </g>
            ) : null}
            {rings}
            {/* The sign itself, on the wall. */}
            {sign}
          </g>

          {/* Rain, in front of everything, falling on twos. */}
          <g stroke="#c9d3e3" strokeWidth={1} opacity={0.32}>
            {RAIN.map((s, i) => {
              const y = rainY(s, live, HEIGHT);
              return <line key={i} x1={s.x} y1={y} x2={s.x - s.len * 0.12} y2={y + s.len} />;
            })}
          </g>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id("vignette")})`} />
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} filter={`url(#${id("grain")})`} opacity={0.07} />

          {/* The last ring: the edge of the clearing, 2 px, fading. */}
          {clearing ? (
            <ellipse cx={ringC.x} cy={ringC.y} rx={ringRx + 2} ry={ringRy + 2} fill="none" stroke="#dfe7f3" strokeWidth={2} opacity={ringOpacity} />
          ) : null}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export const NEON_BEATS = {
  tubes: LOGO_PIECE_ORDER.map((p) => TUBE_ON[p]),
  title: TITLE_ON,
  name: NAME_ON,
  hold: HOLD_START,
  tilt: TILT_START,
  tiltEnd: TILT_END,
  clear: CLEAR_FRAME,
};
