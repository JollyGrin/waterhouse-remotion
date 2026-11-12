import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, W } from "./brand";

/**
 * XEROX — an underground techno flyer coming off a photocopier.
 * Monochrome toner on black, generation loss, one thin caution-yellow rule.
 * 120 bpm grid: a beat is 15 frames. Three copy passes cut hard on the beat,
 * then a last scan pass that leaves the stream behind the light bar.
 */

export const XEROX_FRAMES = 124;

// ---------------------------------------------------------------------------
// Timing (frames).

const BEAT = 15;
type Pass = {
  cut: number; // hard cut to a fresh black sheet
  sweep: [number, number]; // light bar travel, top -> bottom
  seed: number;
  bleed: number; // edge raggedness
  holes: number; // rare big dropout blotches (lower = more)
  streak: number; // toner-starved vertical streaks (lower = more)
  salt: number; // fine missing specks inside solids (lower = more)
  dust: number; // toner dust threshold (lower = more dust)
  rough: number; // edge displacement px
  blur: number;
};
const PASSES: Pass[] = [
  { cut: 0, sweep: [3, 17], seed: 11, bleed: 0.5, holes: 0.75, streak: 0.715, salt: 0.75, dust: 0.79, rough: 3, blur: 1.8 },
  { cut: 2 * BEAT, sweep: [31, 41], seed: 23, bleed: 0.95, holes: 0.68, streak: 0.6, salt: 0.69, dust: 0.75, rough: 7, blur: 2.6 },
  { cut: 4 * BEAT, sweep: [61, 75], seed: 37, bleed: 0.6, holes: 0.74, streak: 0.69, salt: 0.74, dust: 0.78, rough: 3.5, blur: 2 },
];
const LAND = 5 * BEAT; // f75 final layout fully copied, sub boom
const EXIT_LAMP = 93;
const EXIT: [number, number] = [96, 112]; // clear from f113

const TONER = "#ebe8e2";
const BLACK = "#0d0d0d";

const sweepEase = Easing.bezier(0.42, 0, 0.58, 1); // carriage: short accel, steady run, short decel
const BAR_FROM = -40;
const BAR_TO = H + 180; // leading glow must clear the frame too
const barY = (frame: number, [a, b]: [number, number]) =>
  interpolate(frame, [a, b], [BAR_FROM, BAR_TO], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: sweepEase });

// ---------------------------------------------------------------------------
// Filters.

/** Toner: displaced, blurred, thresholded alpha with noise on the edge; dropout blotches; dust. */
const TonerFilter: React.FC<{ id: string; p: Pass }> = ({ id, p }) => (
  <filter id={id} x={0} y={0} width={W} height={H} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={2} seed={p.seed} result="warp" />
    <feDisplacementMap in="SourceAlpha" in2="warp" scale={p.rough * 2} xChannelSelector="R" yChannelSelector="G" result="disp" />
    <feGaussianBlur in="disp" stdDeviation={p.blur} result="blur" />
    <feTurbulence type="fractalNoise" baseFrequency="0.42" numOctaves={1} seed={p.seed + 1} result="n1" />
    <feColorMatrix in="n1" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="n1a" />
    <feComposite in="blur" in2="n1a" operator="arithmetic" k1={0} k2={1} k3={p.bleed} k4={-p.bleed / 2} result="edge" />
    <feComponentTransfer in="edge" result="solid">
      <feFuncA type="discrete" tableValues="0 1" />
    </feComponentTransfer>
    <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves={3} seed={p.seed + 2} result="n2" />
    <feColorMatrix in="n2" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  14 0 0 0 ${-14 * p.holes}`} result="blot" />
    <feTurbulence type="fractalNoise" baseFrequency="0.16 0.0035" numOctaves={2} seed={p.seed + 4} result="n4" />
    <feColorMatrix in="n4" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  10 0 0 0 ${-10 * p.streak}`} result="streak" />
    <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves={1} seed={p.seed + 5} result="n5" />
    <feColorMatrix in="n5" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  30 0 0 0 ${-30 * p.salt}`} result="salt" />
    <feComposite in="solid" in2="blot" operator="out" result="h1" />
    <feComposite in="h1" in2="streak" operator="out" result="h2" />
    <feComposite in="h2" in2="salt" operator="out" result="holed" />
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={1} seed={p.seed + 3} result="n3" />
    <feColorMatrix in="n3" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  40 0 0 0 ${-40 * p.dust}`} result="dust" />
    <feMerge result="toner">
      <feMergeNode in="holed" />
      <feMergeNode in="dust" />
    </feMerge>
    <feFlood floodColor={TONER} result="ink" />
    <feComposite in="ink" in2="toner" operator="in" />
  </filter>
);

/** Small type: a lighter copy so the mono stays legible. */
const LabelFilter: React.FC<{ id: string; seed: number }> = ({ id, seed }) => (
  <filter id={id} x={0} y={0} width={W} height={H} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves={1} seed={seed} result="warp" />
    <feDisplacementMap in="SourceAlpha" in2="warp" scale={2.2} xChannelSelector="R" yChannelSelector="G" result="disp" />
    <feGaussianBlur in="disp" stdDeviation={0.6} result="blur" />
    <feComponentTransfer in="blur" result="solid">
      <feFuncA type="discrete" tableValues="0 0 1 1 1" />
    </feComponentTransfer>
    <feFlood floodColor={TONER} result="ink" />
    <feComposite in="ink" in2="solid" operator="in" />
  </filter>
);

/** Film grain on dark: re-seeded every frame. */
const GrainFilter: React.FC<{ id: string; seed: number }> = ({ id, seed }) => (
  <filter id={id} x={0} y={0} width={W} height={H} filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} stitchTiles="stitch" />
    <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1" result="flat" />
    <feColorMatrix type="saturate" values="0" />
    <feComponentTransfer>
      <feFuncR type="linear" slope="2.4" intercept="-0.7" />
      <feFuncG type="linear" slope="2.4" intercept="-0.7" />
      <feFuncB type="linear" slope="2.4" intercept="-0.7" />
    </feComponentTransfer>
  </filter>
);

// ---------------------------------------------------------------------------
// Art per pass. Everything is drawn in a flat colour; the filter turns it into toner.

const logoScale = (w: number) => w / LOGO_VIEWBOX.w;
const LogoArt: React.FC<{ x: number; y: number; w: number }> = ({ x, y, w }) => (
  <g transform={`translate(${x} ${y}) scale(${logoScale(w)})`}>
    {LOGO_ORDER.map((p) => (
      <path key={p} d={LOGO_PATHS[p]} fill="#fff" />
    ))}
  </g>
);

const TopLabels: React.FC<{ copy: string; zoom: string }> = ({ copy, zoom }) => (
  <g fontFamily={FONT_MONO} fontWeight={700} fontSize={26} letterSpacing="0.18em" fill="#fff">
    <text x={90} y={170}>
      WH—S · COPY {copy}
    </text>
    <text x={990} y={170} textAnchor="end">
      {zoom}
    </text>
    <rect x={90} y={186} width={900} height={2} />
  </g>
);

type Xf = { dx: number; dy: number; rot: number; skew: number };
const PASS_XF: Xf[] = [
  { dx: 0, dy: 0, rot: -0.4, skew: 0 },
  { dx: 0, dy: 0, rot: -2.2, skew: 1.5 },
  { dx: 0, dy: 0, rot: 0.35, skew: -0.4 },
];

const passArt = (k: number) => {
  if (k === 0)
    return {
      toner: <LogoArt x={540 - 340} y={860 - 226} w={680} />,
      labels: <TopLabels copy="01/03" zoom="100%" />,
    };
  if (k === 1)
    return {
      toner: <LogoArt x={-900} y={120} w={2600} />,
      labels: <TopLabels copy="02/03" zoom="260%" />,
    };
  // Final flyer.
  return {
    toner: (
      <>
        <LogoArt x={540 - 380} y={400} w={760} />
        <g fontFamily={FONT_DISPLAY} fill="#fff">
          <text x={90} y={1082} fontSize={96} textLength={900} lengthAdjust="spacingAndGlyphs">
            WATERHOUSE
          </text>
          <text x={90} y={1196} fontSize={120} textLength={900} lengthAdjust="spacingAndGlyphs">
            SESSIONS
          </text>
        </g>
      </>
    ),
    labels: (
      <>
        <TopLabels copy="03/03" zoom="100%" />
        <g fontFamily={FONT_MONO} fontWeight={700} fontSize={34} letterSpacing="0.14em" fill="#fff">
          <text x={90} y={1306}>
            TUESDAYS · AMSTERDAM
          </text>
          <text x={990} y={1306} textAnchor="end">
            EP —
          </text>
          <text x={90} y={1356}>
            WITH DENZO
          </text>
          <text x={990} y={1356} textAnchor="end">
            52.37N 4.90E
          </text>
        </g>
      </>
    ),
  };
};

/** Dirty drum: thin vertical streaks, some light (toner smear), one dark (scratch through the toner). */
const Streaks: React.FC<{ seed: number }> = ({ seed }) => {
  const r = (i: number) => {
    const x = Math.sin((seed * 97 + i) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const light = Array.from({ length: 3 }, (_, i) => ({
    x: 40 + r(i) * 1000,
    w: 1 + r(i + 10) * 3,
    o: 0.12 + r(i + 20) * 0.3,
    y0: r(i + 30) * 600,
    y1: H - r(i + 40) * 500,
  }));
  return (
    <g>
      {light.map((s, i) => (
        <rect key={i} x={s.x} y={s.y0} width={s.w} height={s.y1 - s.y0} fill={TONER} opacity={s.o} />
      ))}
      <rect x={160 + r(99) * 700} y={0} width={5} height={H} fill={BLACK} opacity={0.85} />
    </g>
  );
};

// ---------------------------------------------------------------------------

export const Xerox: React.FC = () => {
  const frame = useCurrentFrame();

  const inExit = frame >= EXIT[0];
  const k = frame >= PASSES[2].cut ? 2 : frame >= PASSES[1].cut ? 1 : 0;
  const pass = PASSES[k];

  // Light bar position for the current scan (reveal passes or the exit).
  const sweep = inExit || frame >= EXIT_LAMP ? EXIT : pass.sweep;
  const by = barY(frame, sweep);
  const barOn = frame >= sweep[0] && by < BAR_TO;

  // Gate weave, a slow push on the final hold, exposure flicker.
  const weaveX = 1.1 * Math.sin(frame * 0.83) + 0.6 * Math.sin(frame * 2.31 + 1);
  const weaveY = 0.9 * Math.sin(frame * 0.61 + 2) + 0.5 * Math.sin(frame * 1.97);
  const push =
    k === 2
      ? interpolate(frame, [LAND, EXIT[1]], [1, 1.025], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) })
      : k === 0
        ? interpolate(frame, [pass.sweep[1], PASSES[1].cut], [1, 1.02], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) })
        : 1;
  const flick = Math.sin(frame * 7.13) * Math.sin(frame * 3.07);
  const bg = Math.round(11 + flick * 2);
  const bgCol = `rgb(${bg},${bg},${bg})`;

  const xf = PASS_XF[k];
  const art = passArt(k);
  const copyClipH = frame >= EXIT_LAMP ? H : Math.max(0, by);

  // Exit: everything the bar has passed is gone.
  const layerClipY = inExit ? Math.max(0, by) : 0;
  const cleared = inExit && by >= BAR_TO;

  return (
    <AbsoluteFill>
      {!cleared && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <TonerFilter id={`toner-${k}`} p={pass} />
            <LabelFilter id={`label-${k}`} seed={pass.seed + 50} />
            <GrainFilter id="grain" seed={frame % 24} />
            <clipPath id="layer">
              <rect x={0} y={layerClipY} width={W} height={H - layerClipY} />
            </clipPath>
            <clipPath id="copied">
              <rect x={-200} y={-200} width={W + 400} height={copyClipH + 200} />
            </clipPath>
            <radialGradient id="vig" cx="50%" cy="45%" r="75%">
              <stop offset="55%" stopColor="#000" stopOpacity={0} />
              <stop offset="100%" stopColor="#000" stopOpacity={0.75} />
            </radialGradient>
            <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dfeaf2" stopOpacity={0.38} />
              <stop offset="30%" stopColor="#dfeaf2" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#dfeaf2" stopOpacity={0} />
            </linearGradient>
          </defs>

          <g clipPath="url(#layer)">
            <rect width={W} height={H} fill={bgCol} />
            <g clipPath="url(#copied)">
              <g
                transform={`translate(${weaveX + xf.dx} ${weaveY + xf.dy}) translate(540 960) scale(${push}) rotate(${xf.rot}) skewX(${xf.skew}) translate(-540 -960)`}
              >
                <g filter={`url(#toner-${k})`}>{art.toner}</g>
                <g filter={`url(#label-${k})`}>{art.labels}</g>
                {k === 2 && (
                  // The one accent: a thin caution rule under the title, printed slightly off-square.
                  <rect x={90} y={1232} width={900} height={6} fill={C.yellow} transform="rotate(-0.25 540 1235)" />
                )}
              </g>
              <Streaks seed={pass.seed} />
            </g>
            <rect width={W} height={H} filter="url(#grain)" style={{ mixBlendMode: "screen" }} opacity={0.11} />
            <rect width={W} height={H} filter="url(#grain)" style={{ mixBlendMode: "multiply" }} opacity={0.22} />
            <rect width={W} height={H} fill="url(#vig)" />
            {barOn && <rect width={W} height={H} fill="#dfeaf2" opacity={0.02} />}
          </g>

          {barOn && (
            <g>
              {/* trailing edge: hard */}
              <rect x={0} y={by - 22} width={W} height={22} fill="#cfd9e0" opacity={0.55} />
              {/* the lamp */}
              <rect x={0} y={by} width={W} height={16} fill="#f3f8fb" />
              <rect x={0} y={by + 5} width={W} height={4} fill="#ffffff" />
              {/* leading edge: the only soft light */}
              <rect x={0} y={by + 16} width={W} height={150} fill="url(#glow)" />
            </g>
          )}
        </svg>
      )}

      {/* Sound: room hum under everything, lamp relay per pass, carriage per scan, hard-cut knocks, sub on the flyer. */}
      <Sequence durationInFrames={EXIT[1] + 4}>
        <Audio
          src={staticFile("ident/audio/xerox/hum.wav")}
          volume={(f) => interpolate(f, [0, 6, EXIT[0], EXIT[1] + 4], [0, 0.55, 0.55, 0], { extrapolateRight: "clamp" })}
        />
      </Sequence>
      {[0, PASSES[1].cut, PASSES[2].cut, EXIT_LAMP].map((f) => (
        <Sequence key={`lamp${f}`} from={f}>
          <Audio src={staticFile("ident/audio/xerox/lamp.wav")} volume={0.7} />
        </Sequence>
      ))}
      {[...PASSES.map((p) => p.sweep), EXIT].map(([a, b]) => (
        <Sequence key={`scan${a}`} from={a - 1}>
          <Audio src={staticFile("ident/audio/xerox/scan.wav")} volume={0.75} playbackRate={Math.min(1.5, 16.5 / (b - a + 2))} />
        </Sequence>
      ))}
      {[PASSES[1].cut, PASSES[2].cut].map((f) => (
        <Sequence key={`cut${f}`} from={f}>
          <Audio src={staticFile("ident/audio/xerox/cut.wav")} volume={0.8} />
          <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.25} playbackRate={0.7} />
        </Sequence>
      ))}
      <Sequence from={LAND - 1}>
        <Audio src={staticFile("ident/audio/xerox/boom.wav")} volume={0.95} />
        <Audio src={staticFile("audio/bumper/clunk.wav")} volume={0.35} playbackRate={0.6} />
      </Sequence>
      <Sequence from={EXIT[1] - 2}>
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={0.45} playbackRate={0.7} />
      </Sequence>
    </AbsoluteFill>
  );
};
