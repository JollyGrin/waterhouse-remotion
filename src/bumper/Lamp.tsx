import React, { useId } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LOGO_VIEW_H, LOGO_VIEW_W, LogoPieces } from "./Logo";
import { noise, pendulum, pendulumApexFrames } from "./fx";
import {
  HEIGHT,
  WIDTH,
  bodyFont,
  brandFont,
  pullupSfx,
  withLine,
} from "./shared";

// Idea A - Lights on. Black. A work lamp on a cord swings in from the
// right and settles over the mark; its cone is the only light, so the white
// mark and the type exist only where it falls. A moth circles the bulb. The
// bulb turns to camera, blooms, blows the frame out to white, and the white
// fades to the live scene.

// --- Timing (30 fps, 110 frames). Tune beats here. ---
export const LAMP_DURATION = 110;

const CLICK_FRAME = 8; // black until the switch; the lamp appears swinging
const SWING_A0 = 55; // degrees, released from the right
const SWING_K = 2.1; // e^(-k t): ~3 deg left by f50
const SWING_OMEGA = 7.85; // rad/s: a pass every 0.4 s
const SETTLE_FRAME = 50;
const TEXT_IN_START = 50; // the type fades up inside the cone ...
const TEXT_IN_END = 62; // ... as if printed on the wall
const HOLD_END = 72; // idle: micro-sway + moth
const TURN_START = 72; // the bulb turns to camera: cone -> disc, bloom
const TURN_END = 84;
const THUMP_FRAME = 84; // low thump; OBS transition point
const WHITE_FRAME = 90; // blown out: solid white
const FADE_END = 104; // the white card has gone to alpha 0
const CLEAR_FRAME = 104;
const MOTH_START = 20;
const MICRO_SWAY_DEG = 1.5;
const MICRO_SWAY_PERIOD = 40;
// Cord creaks at each apex of the swing, quieter as it settles.
const APEX_FRAMES = pendulumApexFrames(SWING_K, SWING_OMEGA, 30, SETTLE_FRAME - CLICK_FRAME - 6).map(
  (f) => f + CLICK_FRAME,
);

// Idle render (`--idle`): the lit mark held, lamp micro-swaying, moth on.
export const LAMP_IDLE_FRAME = 66;
export const LAMP_IDLE_DURATION = 60;

// --- Layout ---
const PIVOT = { x: WIDTH / 2, y: -30 }; // the cord comes from above the frame
const CORD = 270; // px, pivot to bulb
const CONE_HALF_DEG = 30;
const CONE_LEN = 1500;
const LOGO_W = 400;
const LOGO_H = (LOGO_W * LOGO_VIEW_H) / LOGO_VIEW_W;
const LOGO_LEFT = (WIDTH - LOGO_W) / 2;
const LOGO_TOP = 440;
const TITLE_TOP = LOGO_TOP + LOGO_H + 34;
const TITLE_SIZE = 64;
const NAME_TOP = TITLE_TOP + 78;
const NAME_SIZE = 34;

const LIGHT = "#FFF1C8"; // the bulb's colour on the wall
const WALL_WHITE = "#F6F0E2"; // the mark, lit
const FLICKER = 0.06; // bulb brightness jitter, stepped on twos

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const rad = (d: number) => (d * Math.PI) / 180;

const LampAudio: React.FC = () => (
  <>
    <Sequence durationInFrames={SETTLE_FRAME}>
      <Audio
        src={pullupSfx("presence")}
        volume={(f) => interpolate(f, [0, 6, SETTLE_FRAME - 10, SETTLE_FRAME], [0, 0.12, 0.12, 0], clamp)}
      />
    </Sequence>
    <Sequence from={CLICK_FRAME} durationInFrames={4}>
      <Audio src={pullupSfx("click")} />
    </Sequence>
    {APEX_FRAMES.map((f, i) => (
      <Sequence key={f} from={f} durationInFrames={14}>
        <Audio
          src={staticFile("audio/bumper/creak.wav")}
          volume={() => 0.8 * Math.pow(0.62, i)}
          playbackRate={1 + 0.08 * i}
        />
      </Sequence>
    ))}
    {/* The hum: starts with the type, rises through the turn. */}
    <Sequence from={TEXT_IN_START} durationInFrames={WHITE_FRAME - TEXT_IN_START + 4}>
      <Audio
        src={staticFile("audio/bumper/hum.wav")}
        volume={(f) =>
          interpolate(
            f,
            [0, 10, TURN_START - TEXT_IN_START, TURN_END - TEXT_IN_START, WHITE_FRAME - TEXT_IN_START + 4],
            [0, 0.35, 0.35, 1, 0],
            clamp,
          )
        }
      />
    </Sequence>
    <Sequence from={THUMP_FRAME} durationInFrames={LAMP_DURATION - THUMP_FRAME}>
      <Audio src={staticFile("audio/bumper/thump.wav")} />
    </Sequence>
  </>
);

interface LampProps {
  guestName: string | null;
  idle: boolean;
  // Skip the sound (the Track Matte's second copy).
  muted?: boolean;
}

export const Lamp: React.FC<LampProps> = ({ guestName, idle, muted }) => {
  const realFrame = useCurrentFrame();
  // SVG ids must be unique per instance: the strip renders many copies.
  const uid = useId().replace(/:/g, "");
  const { fps } = useVideoConfig();
  const frame = idle ? LAMP_IDLE_FRAME : realFrame;
  const live = realFrame;

  if (frame >= CLEAR_FRAME) return null;

  const on = frame >= CLICK_FRAME;

  // --- The pendulum ---
  const t = (frame - CLICK_FRAME) / fps;
  const swing = frame < CLICK_FRAME ? SWING_A0 : pendulum(t, SWING_A0, SWING_K, SWING_OMEGA);
  const sway = MICRO_SWAY_DEG * Math.sin((2 * Math.PI * live) / MICRO_SWAY_PERIOD);
  const phi = swing + sway; // degrees from vertical, + = right
  const dir = { x: Math.sin(rad(phi)), y: Math.cos(rad(phi)) };
  const bulb = { x: PIVOT.x + CORD * dir.x, y: PIVOT.y + CORD * dir.y };

  // --- The turn: cone to disc ---
  const turn = interpolate(frame, [TURN_START, TURN_END], [0, 1], {
    easing: Easing.inOut(Easing.quad),
    ...clamp,
  });
  const discR = interpolate(turn, [0, 1], [40, 1400]);
  const coneOpacity = 1 - turn;
  const flicker = 1 + FLICKER * noise(5, Math.floor(live / 2));

  const cone = [
    [bulb.x, bulb.y],
    [bulb.x + CONE_LEN * Math.sin(rad(phi - CONE_HALF_DEG)), bulb.y + CONE_LEN * Math.cos(rad(phi - CONE_HALF_DEG))],
    [bulb.x + CONE_LEN * Math.sin(rad(phi + CONE_HALF_DEG)), bulb.y + CONE_LEN * Math.cos(rad(phi + CONE_HALF_DEG))],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  // --- The end ---
  const white = interpolate(frame, [THUMP_FRAME, WHITE_FRAME], [0, 1], {
    easing: Easing.in(Easing.quad),
    ...clamp,
  });
  const fade = interpolate(frame, [WHITE_FRAME, FADE_END], [1, 0], clamp);

  const textOpacity = interpolate(frame, [TEXT_IN_START, TEXT_IN_END], [0, 1], clamp);
  void HOLD_END;

  // --- The moth ---
  const mothOn = frame >= MOTH_START && white < 0.5;
  const mothA = 0.32 * live + 1.3 * Math.sin(live / 7);
  const mothR = 36 + 12 * Math.sin(live / 5);
  const moth = { x: bulb.x + mothR * Math.cos(mothA), y: bulb.y + 8 + mothR * Math.sin(mothA) * 0.7 };
  const flap = Math.floor(live / 2) % 2 === 0 ? 1 : 0.35; // on twos

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {idle || muted ? null : <LampAudio />}
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ position: "absolute", inset: 0, display: "block" }}
      >
        <defs>
          <radialGradient
            id={`lamp-pool-${uid}`}
            gradientUnits="userSpaceOnUse"
            cx={bulb.x}
            cy={bulb.y}
            r={CONE_LEN}
          >
            <stop offset="0" stopColor={LIGHT} stopOpacity={0.5} />
            <stop offset="0.18" stopColor={LIGHT} stopOpacity={0.22} />
            <stop offset="1" stopColor={LIGHT} stopOpacity={0.04} />
          </radialGradient>
          <radialGradient
            id={`lamp-disc-${uid}`}
            gradientUnits="userSpaceOnUse"
            cx={bulb.x}
            cy={bulb.y}
            r={discR}
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <stop offset="0.35" stopColor={LIGHT} stopOpacity={0.9} />
            <stop offset="1" stopColor={LIGHT} stopOpacity={0} />
          </radialGradient>
          <radialGradient
            id={`lamp-glow-${uid}`}
            gradientUnits="userSpaceOnUse"
            cx={bulb.x}
            cy={bulb.y}
            r={44}
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <stop offset="0.4" stopColor={LIGHT} stopOpacity={0.7} />
            <stop offset="1" stopColor={LIGHT} stopOpacity={0} />
          </radialGradient>
          {/* Where the light falls: brightest at the bulb. The mark and the
              type are masked with this, so they only exist in the light. */}
          <radialGradient
            id={`lamp-mask-grad-${uid}`}
            gradientUnits="userSpaceOnUse"
            cx={bulb.x}
            cy={bulb.y}
            r={CONE_LEN * 0.8}
          >
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.3" stopColor="#fff" />
            <stop offset="1" stopColor="#555" />
          </radialGradient>
          <mask id={`lamp-light-${uid}`} maskUnits="userSpaceOnUse">
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#000" />
            {on ? (
              <>
                <polygon points={cone} fill={`url(#lamp-mask-grad-${uid})`} opacity={coneOpacity * flicker} />
                {turn > 0 ? <circle cx={bulb.x} cy={bulb.y} r={discR} fill="#fff" opacity={turn} /> : null}
              </>
            ) : null}
          </mask>
        </defs>

        {/* The dark. */}
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#000" />

        {on ? (
          <>
            {/* The pool of light on the wall. */}
            <polygon points={cone} fill={`url(#lamp-pool-${uid})`} opacity={coneOpacity * flicker} />
            {turn > 0 ? <circle cx={bulb.x} cy={bulb.y} r={discR} fill={`url(#lamp-disc-${uid})`} opacity={flicker} /> : null}

            {/* The mark and the type, printed on the wall, lit by the cone. */}
            <g mask={`url(#lamp-light-${uid})`}>
              <g transform={`translate(${LOGO_LEFT} ${LOGO_TOP}) scale(${LOGO_W / LOGO_VIEW_W})`}>
                <LogoPieces color={WALL_WHITE} />
              </g>
              <text
                x={WIDTH / 2}
                y={TITLE_TOP + TITLE_SIZE * 0.8}
                textAnchor="middle"
                fontFamily={brandFont}
                fontSize={TITLE_SIZE}
                letterSpacing={3}
                fill={WALL_WHITE}
                opacity={textOpacity}
              >
                WATERHOUSE SESSIONS
              </text>
              <text
                x={WIDTH / 2}
                y={NAME_TOP + NAME_SIZE * 0.8}
                textAnchor="middle"
                fontFamily={bodyFont}
                fontSize={NAME_SIZE}
                letterSpacing={1}
                fill={WALL_WHITE}
                opacity={textOpacity * 0.9}
              >
                {withLine(guestName)}
              </text>
            </g>

            {/* The lamp: cord, shade, bulb. */}
            <line x1={PIVOT.x} y1={PIVOT.y} x2={bulb.x} y2={bulb.y} stroke="#3a3632" strokeWidth={3} />
            <g transform={`translate(${bulb.x} ${bulb.y}) rotate(${-phi})`} opacity={1 - turn * 0.6}>
              <polygon points="-18,-34 18,-34 40,0 -40,0" fill="#15130f" stroke="#2c2823" strokeWidth={1.5} />
              <rect x={-38} y={-3} width={76} height={4} fill={LIGHT} opacity={0.9 * flicker} />
            </g>
            <circle cx={bulb.x} cy={bulb.y} r={44 + 30 * turn} fill={`url(#lamp-glow-${uid})`} opacity={flicker} />
            <circle cx={bulb.x} cy={bulb.y + 4} r={9 + 6 * turn} fill="#FFFBEE" />

            {/* The moth: two wings flapping on twos, circling the bulb. */}
            {mothOn ? (
              <g transform={`translate(${moth.x} ${moth.y}) rotate(${(mothA * 180) / Math.PI + 90})`} opacity={0.9}>
                <ellipse cx={-4 * flap} cy={0} rx={5 * flap} ry={2.6} fill="#E7DCC4" />
                <ellipse cx={4 * flap} cy={0} rx={5 * flap} ry={2.6} fill="#E7DCC4" />
                <ellipse cx={0} cy={0} rx={1.4} ry={3} fill="#2a2520" />
              </g>
            ) : null}
          </>
        ) : null}

        {/* Blow-out. */}
        {white > 0 ? <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fff" opacity={white} /> : null}
      </svg>
    </AbsoluteFill>
  );
};

export const LAMP_BEATS = {
  click: CLICK_FRAME,
  apices: APEX_FRAMES,
  settle: SETTLE_FRAME,
  turn: TURN_START,
  thump: THUMP_FRAME,
  white: WHITE_FRAME,
  clear: CLEAR_FRAME,
};
