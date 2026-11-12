import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, W, rand } from "./brand";

/**
 * STROBE — the mark cut out of a black wall, a club strobe behind it.
 * Black room, low drone. Strobe hits on a 130 bpm grid blaze the cutouts white and throw
 * hard-edged shafts of the mark into the haze toward camera, decaying like a real tube.
 * The title cuts into the wall on a later hit and the light sustains. Darkness, a riser,
 * an accelerating burst, the light holds, and on the big kick the cutouts become the
 * holes to the content and the wall flies past the lens.
 *
 * Grid: 130 bpm → beat ≈ 13.85 f at 30 fps.
 */
export const STROBE_FRAMES = 132;

// ---- timeline (frames) ----
const HITS = [8, 22, 36, 50]; // the build: kick on every beat
const TITLE = 64; // the title cuts in, the strobe goes to a sustained light
const DARK = 86; // light cuts out
const BURST = [94, 102, 107]; // accelerating (gaps 8, 5), the last one holds
const HOLD = 107; // the last burst hit holds full into the reveal
const REVEAL = 112; // big kick: cutouts become the holes to the content
const CLEAR = 121; // fully transparent from here

// ---- layout ----
const MW = 820;
const K = MW / 1000;
const X0 = (W - MW) / 2;
const Y0 = 470;
const TITLE_Y1 = Y0 + 666 * K + 150; // baseline WATERHOUSE
const TITLE_Y2 = TITLE_Y1 + 118; // baseline SESSIONS
const LABEL_Y = TITLE_Y2 + 110;
const LIGHT_O: [number, number] = [W / 2, Y0 + 300]; // the strobe, behind the wall
const EXIT_O_LOCAL: [number, number] = [200, 470]; // inside the house cutout (logo units)

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ---- light ----
const DECAY = [1, 0.5, 0.24, 0.1, 0.03]; // tube afterglow, per frame after a hit
const pulse = (f: number, at: number, amp = 1) => {
  const t = f - at;
  return t >= 0 && t < DECAY.length ? DECAY[t] * amp : 0;
};
const light = (f: number) => {
  let i = 0;
  for (const h of HITS) i = Math.max(i, pulse(f, h));
  // sustained after the title hit, with a tube's uneven breath (no dropouts: every bright onset counts as a flash)
  if (f >= TITLE && f < DARK) {
    const s = 0.86 + (rand(f * 3.1) - 0.5) * 0.06;
    i = Math.max(i, f < TITLE + 2 ? 1 : s);
  }
  for (const h of BURST) i = Math.max(i, pulse(f, h));
  if (f >= HOLD && f < REVEAL) i = 1;
  return i;
};
// haze glow lags the tube a little and holds longer
const haze = (f: number) => {
  let v = 0;
  for (let k = 0; k < 6; k++) v = Math.max(v, light(f - k) * Math.pow(0.62, k));
  return v;
};

// ---- camera ----
const KICKS = [...HITS, TITLE, ...BURST];
const camera = (f: number) => {
  const push = interpolate(f, [0, REVEAL], [0.9, 1.0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const dx = Math.sin(f / 23) * 6 + interpolate(f, [0, REVEAL], [-18, 0], clamp);
  const dy = Math.cos(f / 29) * 4 + interpolate(f, [0, REVEAL], [24, 0], clamp);
  const rot = Math.sin(f / 31) * 0.35 + interpolate(f, [0, REVEAL], [-0.9, 0], clamp);
  // weighty kick: a short low thump, not a rattle
  let kx = 0;
  let ky = 0;
  for (const k of KICKS) {
    const t = f - k;
    if (t < 0 || t > 8) continue;
    const a = (k === TITLE ? 6 : 3) * Math.exp(-t / 2.2);
    kx += (rand(k * 7 + t) - 0.5) * 2 * a;
    ky += a * 0.9 * (t === 0 ? 1 : (rand(k * 11 + t) - 0.5) * 2);
  }
  return { s: push, x: dx + kx, y: dy + ky, r: rot };
};
const camTransform = (c: ReturnType<typeof camera>) =>
  `translate(${W / 2 + c.x} ${H / 2 + c.y}) rotate(${c.r}) scale(${c.s}) translate(${-W / 2} ${-H / 2})`;
const camPoint = (c: ReturnType<typeof camera>, p: [number, number]): [number, number] => {
  const x = (p[0] - W / 2) * c.s;
  const y = (p[1] - H / 2) * c.s;
  const r = (c.r * Math.PI) / 180;
  return [W / 2 + c.x + x * Math.cos(r) - y * Math.sin(r), H / 2 + c.y + x * Math.sin(r) + y * Math.cos(r)];
};

// ---- colour ----
const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.min(1, Math.max(0, t)))).join(",")})`;
};
const WALL = "#070707";
const VOID = "#040404";

// ---- the cutouts (logo + title), in wall coordinates ----
const Cutouts: React.FC<{ fill: string; title: boolean; titleOpacity?: number }> = ({ fill, title, titleOpacity = 1 }) => (
  <>
    <g transform={`translate(${X0} ${Y0}) scale(${K})`}>
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={fill} />
      ))}
    </g>
    {title ? (
      <g fill={fill} opacity={titleOpacity} style={{ fontFamily: FONT_DISPLAY }} fontSize={98} textAnchor="middle">
        <text x={W / 2} y={TITLE_Y1} textLength={MW} lengthAdjust="spacing">
          WATERHOUSE
        </text>
        <text x={W / 2} y={TITLE_Y2} textLength={MW} lengthAdjust="spacing">
          SESSIONS
        </text>
      </g>
    ) : null}
  </>
);

const DUST = Array.from({ length: 90 }, (_, i) => ({
  x: rand(i * 3.3) * W,
  y: rand(i * 7.7) * H,
  r: 1.2 + rand(i * 1.9) * 3.2,
  a: 0.25 + rand(i * 5.1) * 0.75,
  vx: (rand(i * 2.2) - 0.5) * 0.5,
  vy: -0.25 - rand(i * 4.4) * 0.6,
}));

export const Strobe: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= CLEAR) return <AbsoluteFill />;

  const cam = camera(f);
  const L = light(f);
  const Hz = haze(f);
  const titleOn = f >= TITLE;
  const revealed = f >= REVEAL;

  // exit: scale the whole wall about a point inside the house cutout, so that cutout eats the frame
  const exitT = interpolate(f, [REVEAL - 1, CLEAR], [0, 1], clamp);
  const exitS = Math.exp(Math.log(16) * Easing.in(Easing.cubic)(exitT));
  const eo = camPoint(cam, [X0 + EXIT_O_LOCAL[0] * K, Y0 + EXIT_O_LOCAL[1] * K]);
  const exitTransform = `translate(${eo[0]} ${eo[1]}) scale(${exitS}) translate(${-eo[0]} ${-eo[1]})`;

  // gate weave
  const gx = (rand(f * 1.7) - 0.5) * 2.4;
  const gy = (rand(f * 2.9 + 4) - 0.5) * 2.4;

  // beams: the cutout silhouettes projected from the light toward camera
  const beamI = revealed ? 0 : Hz;
  const par: [number, number] = [
    interpolate(f, [0, REVEAL], [-150, -40], clamp) + Math.sin(f / 19) * 14,
    interpolate(f, [0, REVEAL], [90, 30], clamp),
  ];
  const NB = 18;
  const beams = [];
  if (beamI > 0.01) {
    for (let i = NB; i >= 1; i--) {
      const t = i / NB;
      const s = 1 + t * 1.15;
      const op = beamI * 0.055 * Math.pow(1 - t, 1.1) + beamI * 0.012;
      beams.push(
        <g
          key={i}
          opacity={op}
          transform={`translate(${par[0] * t} ${par[1] * t}) translate(${LIGHT_O[0]} ${LIGHT_O[1]}) scale(${s}) translate(${-LIGHT_O[0]} ${-LIGHT_O[1]})`}
        >
          <Cutouts fill={C.paper} title={titleOn && t <= 0.4} titleOpacity={0.45} />
        </g>,
      );
    }
  }

  const seed = f % 24;
  const labelCol = mix("#2c2c2c", "#9a9a95", Hz * 0.9);
  const cornerCol = mix("#262626", "#6a6a66", Hz * 0.8);
  const panel = mix(VOID, C.paper, L);
  const labelsOn = f >= TITLE + 6;

  return (
    <AbsoluteFill style={{ transform: `translate(${gx}px, ${gy}px)` }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        <defs>
          <mask id="wall" maskUnits="userSpaceOnUse" x={-W * 20} y={-H * 20} width={W * 41} height={H * 41}>
            <rect x={-W * 20} y={-H * 20} width={W * 41} height={H * 41} fill="#fff" />
            <g transform={camTransform(cam)}>
              <Cutouts fill="#000" title={titleOn} />
            </g>
          </mask>
          <filter id="concrete" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.018" numOctaves={4} seed={3} />
            <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0 0 0 -0.32" />
          </filter>
          <filter id={`grain${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves={2} seed={seed * 7 + 1} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <radialGradient id="vig" cx="50%" cy="44%" r="75%">
            <stop offset="55%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.85} />
          </radialGradient>
        </defs>

        <g transform={exitTransform}>
          {/* what's behind the wall: the strobe panel, until the reveal makes it the content */}
          {!revealed ? <rect x={-W} y={-H} width={W * 3} height={H * 3} fill={panel} /> : null}

          {/* the wall: near-black concrete, lit only by haze spill */}
          <g mask="url(#wall)">
            <rect x={-W * 20} y={-H * 20} width={W * 41} height={H * 41} fill={mix(WALL, "#2a2a29", Hz * 0.35)} />
            <g transform={camTransform(cam)}>
              <rect x={-60} y={-60} width={W + 120} height={H + 120} filter="url(#concrete)" opacity={0.035 + Hz * 0.08} />
              {/* printed on the wall */}
              <g style={{ fontFamily: FONT_MONO }} fontWeight={500}>
                <text x={92} y={168} fontSize={24} letterSpacing={6} fill={cornerCol}>
                  WATERHOUSE STUDIOS
                </text>
                <text x={W - 140} y={168} fontSize={24} letterSpacing={6} fill={cornerCol} textAnchor="end">
                  TUE
                </text>
                <text x={92} y={1430} fontSize={20} letterSpacing={5} fill={cornerCol}>
                  52.37°N 4.90°E
                </text>
                <text x={W - 140} y={1430} fontSize={20} letterSpacing={5} fill={cornerCol} textAnchor="end">
                  130 BPM
                </text>
                {labelsOn ? (
                  <>
                    <rect x={W / 2 - 70} y={LABEL_Y - 62} width={140} height={4} fill={C.yellow} />
                    <text x={W / 2} y={LABEL_Y} fontSize={34} letterSpacing={10} fill={labelCol} textAnchor="middle">
                      WITH DENZO · TUESDAY
                    </text>
                    <text x={W / 2} y={LABEL_Y + 52} fontSize={24} letterSpacing={12} fill={mix("#262626", "#6f6f6b", Hz)} textAnchor="middle">
                      AMSTERDAM
                    </text>
                  </>
                ) : null}
              </g>
            </g>
            <rect x={-W * 20} y={-H * 20} width={W * 41} height={H * 41} fill="url(#vig)" />
            <rect x={-60} y={-60} width={W + 120} height={H + 120} filter={`url(#grain${seed})`} opacity={0.055 + Hz * 0.05} style={{ mixBlendMode: "screen" }} />
          </g>

          {/* volume: haze lift, beams, dust — in front of the wall, toward camera */}
          {!revealed ? (
            <g style={{ mixBlendMode: "screen" }}>
              <rect x={-W} y={-H} width={W * 3} height={H * 3} fill={C.paper} opacity={Hz * 0.035} />
              <g transform={camTransform(cam)}>{beams}</g>
              {DUST.map((d, i) => {
                const x = (((d.x + d.vx * f) % W) + W) % W;
                const y = (((d.y + d.vy * f) % H) + H) % H;
                return <rect key={i} x={x} y={y} width={d.r} height={d.r} fill={C.paper} opacity={Hz * d.a * 0.55} />;
              })}
            </g>
          ) : null}
        </g>
      </svg>

      {/* ---- sound ---- */}
      <Sequence layout="none">
        <Audio src={staticFile("ident/audio/strobe/drone.wav")} volume={(fr) => interpolate(fr, [0, 10, REVEAL - 2, REVEAL + 2], [0, 0.55, 0.7, 0], clamp)} />
      </Sequence>
      <Sequence layout="none">
        <Audio src={staticFile("audio/bumper/hum.wav")} volume={0.25} playbackRate={0.7} />
      </Sequence>
      {HITS.map((h, i) => (
        <Sequence key={h} from={h} layout="none">
          <Audio src={staticFile("ident/audio/strobe/kick.wav")} volume={() => 0.75 + i * 0.05} />
          <Audio src={staticFile("ident/audio/strobe/zap.wav")} volume={0.45} playbackRate={1 - i * 0.03} />
        </Sequence>
      ))}
      <Sequence from={TITLE} layout="none">
        <Audio src={staticFile("ident/audio/strobe/kick-big.wav")} volume={0.75} />
        <Audio src={staticFile("audio/bumper/clunk.wav")} volume={0.35} playbackRate={0.6} />
        <Audio src={staticFile("ident/audio/strobe/zap.wav")} volume={0.5} playbackRate={0.85} />
      </Sequence>
      <Sequence from={TITLE + 1} durationInFrames={DARK - TITLE - 1} layout="none">
        <Audio src={staticFile("audio/bumper/fluoro.wav")} volume={0.22} playbackRate={0.8} />
      </Sequence>
      <Sequence from={DARK} layout="none">
        <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.45} playbackRate={0.6} />
      </Sequence>
      <Sequence from={REVEAL - 27} layout="none">
        <Audio src={staticFile("ident/audio/strobe/riser.wav")} volume={0.5} />
      </Sequence>
      {BURST.map((h, i) => (
        <Sequence key={h} from={h} layout="none">
          <Audio src={staticFile("ident/audio/strobe/kick.wav")} volume={() => 0.55 + i * 0.08} playbackRate={1 + i * 0.04} />
          <Audio src={staticFile("ident/audio/strobe/zap.wav")} volume={0.4} playbackRate={1 + i * 0.06} />
        </Sequence>
      ))}
      <Sequence from={REVEAL} layout="none">
        <Audio src={staticFile("ident/audio/strobe/kick-big.wav")} volume={0.85} />
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={0.5} playbackRate={0.75} />
      </Sequence>
    </AbsoluteFill>
  );
};
