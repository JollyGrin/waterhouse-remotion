import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, LogoPiece, LOGO_ORDER, LOGO_PATHS, rand } from "./brand";
import { Grain } from "./common";
import { THETA, THETA_SUB } from "./phosphor/motion";

/**
 * PHOSPHOR: Scope's first half becomes Platter's second half, without a cut.
 *
 *   f0–60   SCOPE. The power-on dot sits exactly where the spindle will be. Flat line + hum, the line
 *           rides the kicks, folds into a 3:2 Lissajous, and the beam pulls the mark out of it; it
 *           locks on the big kick (60) at the size and place it is printed on the label.
 *   f60–75  THE MATERIALISE. The beam traces the label edge and the grooves around the locked mark
 *           (each circle is a pure tone in the XY audio). The needle drops (64) and the record spins
 *           up two turns (65–75): the beam-drawn mark rotates with it, its persistence smears into
 *           rings, and under the smear the glass dissolves and the booth light comes up on real vinyl
 *           and a paper label. The vector outline lingers on the label as a cold burn-in, then fades.
 *   f75–    PLATTER. Caught dead upright on the drop, baby scratches and chirps, held still for the
 *           title (90), release (105), power-off brake (109), the grooves part into rings to the
 *           content (116). Clear from 140.
 *
 * One rotation curve drives the picture and the soundtrack (src/ident/phosphor/gen-audio.py), so the beam's
 * spin, the record's spin-up zip and every scratch are the same signal.
 * `Phosphor` 1080×1920, `PhosphorWide` 1920×1080. Grid: 120 bpm, beat = 15 f.
 */
export const PHOSPHOR_FRAMES = 150;

// ---- timeline (frames) ----
const ON = 2;
const LINE = [5, 10];
const KICKS_SCOPE = [15, 30, 45];
const FOLD = [33, 47];
const MORPH: Record<LogoPiece, [number, number]> = {
  house: [45, 54],
  slatA: [48, 57],
  slatB: [50, 59],
  door: [52, 60],
};
const LOCK = 60;
const CIRCLES: { r: number; at: [number, number]; a0: number }[] = [
  { r: 440, at: [61, 65], a0: -90 }, // label edge
  { r: 520, at: [62, 66.5], a0: 30 }, // run-out
  { r: 742, at: [63, 68], a0: 160 },
  { r: 990, at: [64, 69.5], a0: 260 },
  { r: 1262, at: [65, 71], a0: 10 }, // lead-in
];
const GLASS_OUT = [63, 73]; // the scope glass dissolves
const BEAM_OUT = [68, 75]; // the beam gives way to the print; from the drop it is a burn-in fading off the label
const BURN_END = 88;
const T = {
  needle: 64,
  lightIn: 64,
  lightFull: 76,
  drop: 75,
  hold: 90,
  word2: 93,
  rule: 97,
  host: 101,
  release: 105,
  brake: 109,
  rings: 116,
  clear: 140,
};
const KICKS_BIG = [T.drop, T.hold];
const KICKS = [T.release];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const heavy = Easing.bezier(0.65, 0, 0.25, 1);
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
const decay = (t: number, tau: number) => (t < 0 ? 0 : Math.exp(-t / tau));
type Pt = [number, number];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ---- rotation (degrees, clockwise), shared with the audio ----
const theta = (u: number) => {
  const x = Math.min(Math.max(u * THETA_SUB, 0), THETA.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  return THETA[i] + (THETA[Math.min(i + 1, THETA.length - 1)] - THETA[i]) * t;
};
const TH0 = THETA[0]; // -720: the spin ends two turns later, upright
const SHUTTER = 0.75;

// ---- record geometry (record-plane px), from Platter ----
const D = 2800;
const PC = D / 2;
const RR = 1320;
const LR = 440;
const SPINDLE = 30;
const LOGO_S = 0.6; // the mark on the label: 600 px wide, its gap (500,333) on the spindle
const PERSP = 1800;

// ---- the mark as polygons, from Scope ----
const POLY: Record<LogoPiece, Pt[]> = {
  house: [[348, 3], [0, 283], [0, 665], [348, 665]],
  slatA: [[379.6, 48.7], [685.2, 149], [685.2, 287.5], [379.6, 204.4]],
  slatB: [[722.2, 161], [1000, 252.3], [1000, 372.9], [722.2, 297.6]],
  door: [[596.6, 398], [775.1, 438.8], [775.1, 665.9], [596.6, 665.9]],
};
const perim = (p: Pt[]) => p.reduce((s, a, i) => s + Math.hypot(p[(i + 1) % p.length][0] - a[0], p[(i + 1) % p.length][1] - a[1]), 0);
const sampleLoop = (poly: Pt[], n: number): Pt[] => {
  const pts = [...poly, poly[0]];
  const segs = pts.slice(1).map((b, i) => Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1]));
  const total = segs.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) {
    let s = (j / (n - 1)) * total;
    let k = 0;
    while (k < segs.length - 1 && s > segs[k]) s -= segs[k++];
    const t = Math.min(1, s / segs[k]);
    out.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t]);
  }
  return out;
};
const N = 960;
const PER = LOGO_ORDER.map((p) => perim(POLY[p]));
const PER_SUM = PER.reduce((a, b) => a + b, 0);
const COUNTS = PER.map((p) => Math.round((p / PER_SUM) * N));
COUNTS[COUNTS.length - 1] += N - COUNTS.reduce((a, b) => a + b, 0);
const STARTS = COUNTS.map((_, i) => COUNTS.slice(0, i).reduce((a, b) => a + b, 0));
const PIECE_OF = LOGO_ORDER.flatMap((p, i) => Array(COUNTS[i]).fill(p) as LogoPiece[]);

// ---- layout ----
type Layout = {
  w: number;
  h: number;
  // record camera (settled): plane centre on screen, push
  cx: number;
  cy: number;
  z0: number;
  // where the label centre lands on screen at tilt 0, and the plane → screen scale there
  rx: number;
  ry: number;
  s: number;
  // scope
  SX0: number;
  SX1: number;
  LX: number;
  LY: number;
  grat: { x0: number; y0: number; div: number; cols: number; rows: number };
  LOGO_PTS: Pt[];
  CORNERS: { p: Pt; piece: LogoPiece }[];
  ro: { l: number; r: number; t1: number; t2: number; b: number };
  glassBg: string;
  vignette: string;
  // platter
  reach: number;
  steadyMask: boolean;
  shaft: { left: number; top: number; w: number; h: number; rot: number };
  motesH: number;
  vig: { cx: string; cy: string; r: string };
  labels: { x0: number; x1: number; y: number };
  title: { x: number; y1: number; y2: number; rule: number; host: number; anchor: "middle" | "start"; size: number; len: number; hostSize: number };
};

const makeLayout = (wide: boolean): Layout => {
  const w = wide ? 1920 : 1080;
  const h = wide ? 1080 : 1920;
  const cx = wide ? 560 : 540;
  const cy = wide ? 540 : 700;
  const z0 = wide ? -360 : 0;
  const s = PERSP / (PERSP - z0);
  const rx = w / 2 + (cx - w / 2) * s;
  const ry = h / 2 + (cy - h / 2) * s;
  const K = LOGO_S * s;
  const toScreen = ([x, y]: Pt): Pt => [rx + (x - 500) * K, ry + (y - 333) * K];
  const LOGO_PTS: Pt[] = LOGO_ORDER.flatMap((p, i) => sampleLoop(POLY[p], COUNTS[i]).map(toScreen));
  const CORNERS = LOGO_ORDER.flatMap((piece) => POLY[piece].map((p) => ({ p: toScreen(p), piece })));
  // graticule: a grid line through the spindle both ways
  const grat = wide
    ? { x0: rx - 4 * 105, y0: ry - 4 * 105, div: 105, cols: 14, rows: 8 }
    : { x0: 60, y0: ry - 5 * 120, div: 120, cols: 8, rows: 10 };
  return {
    w,
    h,
    cx,
    cy,
    z0,
    rx,
    ry,
    s,
    SX0: grat.x0,
    SX1: grat.x0 + grat.cols * grat.div,
    LX: wide ? 520 : 400,
    LY: 300,
    grat,
    LOGO_PTS,
    CORNERS,
    ro: wide ? { l: 96, r: w - 96, t1: 50, t2: 86, b: 1000 } : { l: 60, r: 1020, t1: 96, t2: 134, b: 1420 },
    glassBg: wide
      ? `radial-gradient(ellipse 70% 85% at ${((rx / w) * 100).toFixed(1)}% 48%, #0e1116 0%, #07080b 55%, #020203 100%)`
      : "radial-gradient(ellipse 85% 60% at 50% 37%, #0e1116 0%, #07080b 55%, #020203 100%)",
    vignette: wide
      ? "linear-gradient(112deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 90% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.65) 100%)"
      : "linear-gradient(118deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.65) 100%)",
    reach: wide ? 1750 : 1450,
    steadyMask: wide,
    shaft: wide ? { left: -300, top: -500, w: 1000, h: 2400, rot: -40 } : { left: -400, top: -300, w: 900, h: 2600, rot: -28 },
    motesH: wide ? 1080 : 1300,
    vig: wide ? { cx: "36%", cy: "50%", r: "75%" } : { cx: "50%", cy: "42%", r: "78%" },
    labels: wide ? { x0: 96, x1: w - 96, y: 92 } : { x0: 92, x1: w - 140, y: 150 },
    title: wide
      ? { x: 1100, y1: 486, y2: 596, rule: 632, host: 688, anchor: "start", size: 96, len: 724, hostSize: 28 }
      : { x: w / 2, y1: 1268, y2: 1378, rule: 1414, host: 1470, anchor: "middle", size: 96, len: 820, hostSize: 30 },
  };
};
const PORTRAIT = makeLayout(false);
const LANDSCAPE = makeLayout(true);

// ================= the beam (f0–75) =================
const kickShape = (u: number) => {
  const t = (u - 0.07) * 0.34;
  if (t < 0) return 0;
  const ph = 2 * Math.PI * (48 * t + (165 - 48) * 0.035 * (1 - Math.exp(-t / 0.035)));
  return Math.sin(ph) * Math.exp(-t / 0.085);
};
const rotOf = (f: number) => (f < 64 ? 0 : theta(f) - TH0);

const trace = (L: Layout, f: number): { pts: Pt[]; w: Record<LogoPiece, number> } => {
  const CX = L.rx;
  const CY = L.ry;
  const open = interpolate(f, LINE, [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const amp = 250 * Math.max(decay(f - 15, 6.5), decay(f - 30, 6.5) * 1.1);
  const fold = interpolate(f, FOLD, [0, 1], { ...clamp, easing: heavy });
  const lisAmp = 1 + 0.16 * decay(f - 45, 4);
  const phi = (f - FOLD[0]) * 0.16;
  const w = Object.fromEntries(LOGO_ORDER.map((p) => [p, interpolate(f, MORPH[p], [0, 1], { ...clamp, easing: heavy })])) as Record<LogoPiece, number>;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    let p: Pt = [0, 0];
    if (fold < 1) {
      const hum = 5 * Math.sin(2 * Math.PI * u * 12 + f * 0.7) + (rand(i * 1.37 + f * 97.1) - 0.5) * 2.2;
      p = [CX + (L.SX0 + (L.SX1 - L.SX0) * u - CX) * open, CY - (amp * kickShape(u) + hum) * open];
    }
    if (fold > 0) {
      const th = u * 2 * Math.PI;
      const lis: Pt = [CX + L.LX * lisAmp * Math.sin(3 * th + phi), CY + L.LY * lisAmp * Math.sin(2 * th)];
      p = fold < 1 ? lerp(p, lis, fold) : lis;
      const tw = 4 * fold * (1 - fold) * 0.7;
      if (tw > 0) {
        const [dx, dy] = [p[0] - CX, p[1] - CY];
        p = [CX + dx * Math.cos(tw) - dy * Math.sin(tw), CY + dx * Math.sin(tw) + dy * Math.cos(tw)];
      }
    }
    const wk = w[PIECE_OF[i]];
    if (wk > 0) {
      p = lerp(p, L.LOGO_PTS[i], wk);
      const s = 4 * wk * (1 - wk);
      p = [p[0] + s * 34 * Math.sin(u * 2 * Math.PI * 23 + f * 0.9), p[1] + s * 34 * Math.cos(u * 2 * Math.PI * 17 - f * 0.7)];
    }
    pts.push(p);
  }
  return { pts, w };
};

const pathOf = (pts: Pt[]) => (pts.length ? "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") : "");

/** Everything the beam draws at frame f, in screen space, already turned with the record. */
const beam = (L: Layout, f: number, rotAt: number = f) => {
  const { pts, w } = trace(L, f);
  const CX = L.rx;
  const CY = L.ry;
  const lockS = 1 + 0.05 * decay(f - LOCK, 4.5);
  const rot = (rotOf(rotAt) * Math.PI) / 180;
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  const xf = (p: Pt): Pt => {
    let dx = p[0] - CX;
    let dy = p[1] - CY;
    if (f >= LOCK) [dx, dy] = [dx * lockS, dy * lockS];
    return [CX + dx * c - dy * s, CY + dx * s + dy * c];
  };
  const P = pts.map(xf);
  const paths: { d: string; a: number }[] = [];
  LOGO_ORDER.forEach((piece, k) => {
    const seg = P.slice(STARTS[k], STARTS[k] + COUNTS[k]);
    paths.push({ d: pathOf(seg), a: 1 });
    if (k < LOGO_ORDER.length - 1) {
      const nxt = P[STARTS[k + 1]];
      const lock = Math.min(w[piece], w[LOGO_ORDER[k + 1]]);
      paths.push({ d: pathOf([seg[seg.length - 1], nxt]), a: 1 - lock * 0.94 });
    }
  });
  // the label and the grooves, traced around the locked mark
  const heads: Pt[] = [];
  for (const cc of CIRCLES) {
    const p = interpolate(f, cc.at, [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
    if (p <= 0) continue;
    const r = cc.r * L.s;
    const n = Math.max(2, Math.ceil(180 * p));
    const arc: Pt[] = [];
    for (let j = 0; j <= n; j++) {
      const a = ((cc.a0 + 360 * p * (j / n)) * Math.PI) / 180;
      arc.push(xf([CX + r * Math.cos(a), CY + r * Math.sin(a)]));
    }
    paths.push({ d: pathOf(arc), a: 0.85 });
    if (p < 1) heads.push(arc[arc.length - 1]);
  }
  const corners = L.CORNERS.map(({ p, piece }) => ({ p: xf(p), a: w[piece] }));
  return { paths, heads, corners };
};

const CORE = "#f7faff";
const GLOW = "#cddcff";
const HALO = "#7f9fe6";

const SPIN_TRAILS = Array.from({ length: 24 }, (_, j) => (j + 1) * 0.125); // frames back
const BeamLayer: React.FC<{ L: Layout; f: number; gain: number; dy: number }> = ({ L, f, gain, dy }) => {
  const now = beam(L, f);
  // persistence: before the spin, whole frames of phosphor decay; while the record turns, the same
  // decay sampled along the rotation, which is what smears the mark and the circles into rings
  const turning = f >= 65;
  const trails = turning
    ? SPIN_TRAILS.map((back, k) => ({ k, a: 0.5 * Math.exp(-back / 0.85), b: beam(L, f, f - back) }))
    : [1, 2, 3, 4].filter((k) => f - k >= LINE[0]).map((k) => ({ k, a: [0, 0.42, 0.22, 0.11, 0.05][k], b: beam(L, f - k) }));
  const g = gain * (0.95 + rand(f * 2.3) * 0.05);
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible", transform: dy ? `translateY(${dy}px)` : undefined }}>
      <defs>
        <filter id="ph-halo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={20} />
        </filter>
        <filter id="ph-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={4.5} />
        </filter>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g filter="url(#ph-halo)" stroke={HALO} strokeWidth={14} opacity={Math.min(1, 0.5 * g)}>
          {now.paths.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
        {trails.map(({ k, a, b }) => (
          <g key={k} stroke={GLOW} strokeWidth={3} opacity={a * Math.min(1, g)}>
            {b.paths.map((p, i) => (
              <path key={i} d={p.d} strokeOpacity={p.a} />
            ))}
          </g>
        ))}
        <g filter="url(#ph-glow)" stroke={GLOW} strokeWidth={7} opacity={Math.min(1, 0.88 * g)}>
          {now.paths.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
        <g stroke={CORE} strokeWidth={2.8} opacity={Math.min(1, g)}>
          {now.paths.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
      </g>
      <g fill={CORE}>
        {now.corners.map((c, i) => (c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={4.2} opacity={c.a * 0.9 * Math.min(1, g)} /> : null))}
      </g>
      <g fill={GLOW} filter="url(#ph-glow)">
        {now.corners.map((c, i) => (c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={9} opacity={c.a * 0.55 * Math.min(1, g)} /> : null))}
      </g>
      {now.heads.map((h, i) => (
        <g key={i}>
          <circle cx={h[0]} cy={h[1]} r={16} fill={GLOW} opacity={0.55 * Math.min(1, g)} filter="url(#ph-glow)" />
          <circle cx={h[0]} cy={h[1]} r={5} fill="#ffffff" opacity={Math.min(1, g)} />
        </g>
      ))}
    </svg>
  );
};

const Graticule: React.FC<{ L: Layout }> = ({ L }) => {
  const CX = L.rx;
  const CY = L.ry;
  const { x0, y0, div, cols, rows } = L.grat;
  const x1 = x0 + cols * div;
  const lines: React.ReactNode[] = [];
  for (let i = 0; i <= cols; i++) lines.push(<line key={`v${i}`} x1={x0 + i * div} y1={y0} x2={x0 + i * div} y2={y0 + rows * div} />);
  for (let j = 0; j <= rows; j++) lines.push(<line key={`h${j}`} x1={x0} y1={y0 + j * div} x2={x1} y2={y0 + j * div} />);
  const tick = div / 5;
  for (let t = 0; t <= cols * 5; t++) lines.push(<line key={`tx${t}`} x1={x0 + t * tick} y1={CY - 7} x2={x0 + t * tick} y2={CY + 7} />);
  for (let t = 0; t <= rows * 5; t++) lines.push(<line key={`ty${t}`} x1={CX - 7} y1={y0 + t * tick} x2={CX + 7} y2={y0 + t * tick} />);
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0 }}>
      <g stroke="rgb(190,205,235)" strokeOpacity={0.06} strokeWidth={1.5}>
        {lines}
      </g>
    </svg>
  );
};

const Readout: React.FC<{ L: Layout; x: number; y: number; align?: "left" | "right"; children: React.ReactNode; o?: number }> = ({ L, x, y, align = "left", children, o = 1 }) => (
  <div
    style={{
      position: "absolute",
      top: y,
      ...(align === "left" ? { left: x } : { right: L.w - x }),
      fontFamily: FONT_MONO,
      fontWeight: 500,
      fontSize: 24,
      letterSpacing: "0.18em",
      color: "rgba(200,210,230,0.5)",
      opacity: o,
      whiteSpace: "pre",
    }}
  >
    {children}
  </div>
);

/** The scope's glass: black, graticule, readouts, scanlines. Dissolves away during the spin. */
const Glass: React.FC<{ L: Layout; f: number; o: number }> = ({ L, f, o }) => {
  const glass = interpolate(f, [0, 14], [0, 1], clamp);
  const ui = (f >= 11 ? (f < 13 ? 0.45 : 1) : 0) * interpolate(f, [62, 69], [1, 0], clamp);
  const mode = f < FOLD[0] ? "Y–T   50ms/DIV" : f < LOCK ? "X–Y   3:2" : f < 64 ? "X–Y   LOCKED" : "X–Y   33⅓";
  const trig = KICKS_SCOPE.concat([LOCK]).some((k) => f - k >= 0 && f - k < 4);
  const { ro } = L;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ backgroundColor: "#000" }} />
      <AbsoluteFill style={{ opacity: glass, background: L.glassBg }} />
      <AbsoluteFill style={{ opacity: glass }}>
        <Graticule L={L} />
      </AbsoluteFill>
      <Readout L={L} x={ro.l} y={ro.t1} o={ui}>
        {mode}
      </Readout>
      <Readout L={L} x={ro.r} y={ro.t1} align="right" o={ui}>
        {"120 BPM"}
      </Readout>
      <Readout L={L} x={ro.l} y={ro.t2} o={ui}>
        <span style={{ color: trig ? "rgba(240,245,255,0.95)" : "rgba(200,210,230,0.35)" }}>TRIG'D</span>
        {"   CH1·X  CH2·Y"}
      </Readout>
      <Readout L={L} x={ro.l} y={ro.b} o={ui}>
        {"WATERHOUSE STUDIOS"}
      </Readout>
      <Readout L={L} x={ro.r} y={ro.b} align="right" o={ui}>
        {"AMS"}
      </Readout>
      <AbsoluteFill
        style={{
          opacity: 0.5 * glass,
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <Grain opacity={0.07 * glass} blend="screen" />
      <AbsoluteFill style={{ opacity: glass, background: L.vignette }} />
    </AbsoluteFill>
  );
};

// ================= the record (f62–) =================
const VINYL = "#0b0b0b";
const PAPER = "#d6d0c4";
const INK = "#121110";

const light = (f: number) => interpolate(f, [T.lightIn, T.lightFull, T.brake, T.brake + 26], [0, 1, 1, 0.42], { ...clamp, easing: easeIO });
const sheenAngle = (f: number) => interpolate(f, [62, 92, 150], [-20, -58, -66], { ...clamp, easing: easeIO });
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const lobe = (a: number, phi: number, w = 13) => {
  const d1 = wrap(a - phi);
  const d2 = wrap(a - phi - 180);
  return Math.max(Math.exp(-((d1 / w) ** 2)), Math.exp(-((d2 / w) ** 2)));
};

const camera = (f: number, lay: Layout) => {
  // flat to the lens while the beam hands over (so the screen-space beam sits exactly on the print), then Platter's tilt
  const tilt = interpolate(f, [BURN_END - 6, BURN_END + 18], [0, 7], { ...clamp, easing: easeIO }) + interpolate(f, [90, 120, 150], [0, -3, -6], clamp);
  const z = lay.z0 + interpolate(f, [110, 142], [0, 70], { ...clamp, easing: Easing.in(Easing.quad) });
  let dy = 0;
  for (const k of [...KICKS_BIG, ...KICKS]) {
    const t = f - k;
    if (t < 0 || t > 8) continue;
    const a = (KICKS_BIG.includes(k) ? 7 : 2.5) * Math.exp(-t / 2);
    dy += t === 0 ? a : a * Math.cos(t * 1.7) * 0.6;
  }
  return { tilt, cx: lay.cx, cy: lay.cy + dy, z };
};

const DUST = Array.from({ length: 46 }, (_, i) => ({ r: LR + 30 + rand(i * 3.7) * (RR - LR - 50), a: rand(i * 9.1) * 360, s: 1.6 + rand(i * 2.3) ** 2 * 4.5 }));
const SCRATCHES = Array.from({ length: 14 }, (_, i) => ({
  r: LR + 60 + rand(i * 5.3 + 1) * (RR - LR - 100),
  a: rand(i * 7.9 + 2) * 360,
  len: 14 + rand(i * 1.3 + 3) * 70,
  w: 0.9 + rand(i * 4.1) * 1.1,
}));
const CHORDS = Array.from({ length: 4 }, (_, i) => ({ a: rand(i * 11.1 + 5) * 360, r: LR + 120 + rand(i * 6.6) * 600, len: 140 + rand(i * 3.3) * 260 }));
const SPINDLE_MARKS = Array.from({ length: 11 }, (_, i) => ({ a: rand(i * 2.9 + 7) * 360, len: 26 + rand(i * 8.3) * 44, bend: (rand(i * 1.7) - 0.5) * 14 }));
const polar = (r: number, aDeg: number): [number, number] => {
  const a = (aDeg * Math.PI) / 180;
  return [PC + r * Math.sin(a), PC - r * Math.cos(a)];
};
const arcPath = (r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  if (Math.abs(a1 - a0) < 0.05) return `M${x0} ${y0} L${x0 + 0.01} ${y0}`;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
};
const RIM_TEXT = "WATERHOUSE SESSIONS  ·  SIDE A  ·  33⅓ RPM  ·  STEREO  ·  WH-001  ·  AMSTERDAM  ·  WITH DENZO  ·  ";

const Ink: React.FC<{ textO: number; opacity: number }> = ({ textO, opacity }) => (
  <g opacity={opacity}>
    <g transform={`translate(${PC - 500 * LOGO_S} ${PC - 333 * LOGO_S}) scale(${LOGO_S})`}>
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={INK} />
      ))}
    </g>
    <circle cx={PC} cy={PC} r={366} fill="none" stroke={INK} strokeWidth={2.5} />
    <circle cx={PC} cy={PC} r={424} fill="none" stroke={INK} strokeWidth={2.5} />
    {textO > 0.01 ? (
      <g style={{ fontFamily: FONT_MONO }} fontWeight={700} fill={INK} opacity={textO}>
        <text fontSize={22} letterSpacing={3}>
          <textPath href="#ph-rim" textLength={2 * Math.PI * 388 - 8} lengthAdjust="spacing">
            {RIM_TEXT}
          </textPath>
        </text>
        <text x={PC} y={PC + 262} fontSize={20} letterSpacing={6} textAnchor="middle" fontWeight={500}>
          ℗ 2026 WATERHOUSE STUDIOS
        </text>
        <text x={PC} y={PC + 300} fontSize={34} letterSpacing={8} textAnchor="middle" fontWeight={800}>
          A1
        </text>
      </g>
    ) : null}
    {textO < 0.99 ? (
      <g fill="none" stroke={INK} opacity={1 - textO}>
        <circle cx={PC} cy={PC} r={395} strokeWidth={20} opacity={0.32} />
        <circle cx={PC} cy={PC} r={256} strokeWidth={14} opacity={0.1} />
        <circle cx={PC} cy={PC} r={290} strokeWidth={22} opacity={0.12} />
      </g>
    ) : null}
  </g>
);

const Record: React.FC<{ lay: Layout; f: number }> = ({ lay, f }) => {
  const { w: W, h: H } = lay;
  const cam = camera(f, lay);
  const Lt = light(f);
  const phi = sheenAngle(f);
  const th = theta(f);
  const thA = theta(f - SHUTTER / 2);
  const thB = theta(f + SHUTTER / 2);
  const smear = Math.abs(thB - thA);
  const n = Math.max(1, Math.min(44, Math.ceil(smear / 1.5)));
  const copyA = n === 1 ? 1 : 1 - Math.pow(1 - 0.96, 1 / n);
  const copies = Array.from({ length: n }, (_, i) => (n === 1 ? th : theta(f - SHUTTER / 2 + (SHUTTER * (i + 0.5)) / n)));
  const textO = Math.min(1, Math.max(0, (4.2 - smear) / 3));
  const seed = Math.floor(f / 2) % 12;

  const sheenStops = (alpha: number) => {
    const s: [number, number][] = [[0, 1], [3, 0.82], [7, 0.5], [13, 0.25], [22, 0.1], [36, 0.03], [60, 0]];
    const col = (a: number) => `rgba(236,232,224,${(a * alpha).toFixed(3)})`;
    const out: string[] = [];
    for (const lobeAt of [0, 180, 360]) {
      for (const [d, a] of [...s].reverse()) if (lobeAt - d >= 0 && d > 0) out.push(`${col(a)} ${lobeAt - d}deg`);
      out.push(`${col(1)} ${lobeAt}deg`);
      for (const [d, a] of s) if (lobeAt + d <= 360 && d > 0) out.push(`${col(a)} ${lobeAt + d}deg`);
    }
    return out.join(", ");
  };
  const trackMask =
    `radial-gradient(circle at 50% 50%, transparent 0px, transparent 520px, #000 521px, #000 742px, transparent 743px, transparent 754px, ` +
    `#000 755px, #000 990px, transparent 991px, transparent 1000px, #000 1001px, #000 1262px, transparent 1263px)`;
  const grooveMask = `repeating-radial-gradient(circle at 50% 50%, #000 0px, #000 1.1px, rgba(0,0,0,0.3) 1.6px, rgba(0,0,0,0.3) 2.6px, #000 3.2px)`;
  const gapMask =
    "radial-gradient(circle at 50% 50%, transparent 742px, #000 744px, #000 753px, transparent 755px, transparent 989px, #000 991px, #000 999px, transparent 1001px, transparent 1262px, #000 1265px, #000 1298px, transparent 1300px)";
  const labelsCol = `rgba(150,148,142,${(0.85 * interpolate(f, [72, 82], [0, 1], clamp)).toFixed(3)})`;

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: -24, top: -24, width: W + 48, height: H + 48, backgroundColor: "#050505" }} />
      <AbsoluteFill style={{ perspective: `${PERSP}px`, perspectiveOrigin: `${W / 2}px ${H / 2}px` }}>
        <div
          style={{
            position: "absolute",
            left: cam.cx - PC,
            top: cam.cy - PC,
            width: D,
            height: D,
            transformOrigin: "50% 50%",
            transform: `translateZ(${cam.z}px) rotateX(${cam.tilt}deg)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: PC - RR,
              top: PC - RR,
              width: RR * 2,
              height: RR * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle at 50% 50%, #101010 0px, ${VINYL} 600px, #090909 1250px, #1a1a1a 1302px, #0d0d0d 1312px, #050505 1320px)`,
              boxShadow: "0 0 0 2px #030303",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              clipPath: `circle(${RR}px at 50% 50%)`,
              background: `radial-gradient(ellipse 900px 700px at 30% 26%, rgba(220,216,208,${(0.07 * Lt).toFixed(3)}), transparent 70%)`,
            }}
          />
          <div style={{ position: "absolute", inset: 0, WebkitMaskImage: trackMask, maskImage: trackMask }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                WebkitMaskImage: grooveMask,
                maskImage: grooveMask,
                background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.95 * Lt)})`,
              }}
            />
            <div style={{ position: "absolute", inset: 0, background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.1 * Lt)})` }} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,${(0.022 * Lt).toFixed(3)}) 0px, rgba(255,255,255,0) 2px, rgba(255,255,255,0) 7px, rgba(255,255,255,${(0.022 * Lt).toFixed(3)}) 9px)`,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              WebkitMaskImage: gapMask,
              maskImage: gapMask,
              background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.25 * Lt)})`,
            }}
          />
          <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <defs>
              <path id="ph-rim" d={`M ${PC - 388} ${PC} A 388 388 0 1 1 ${PC + 388} ${PC} A 388 388 0 1 1 ${PC - 388} ${PC}`} />
              <filter id="ph-paper" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={3} seed={11} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="ph-fibres" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves={3} seed={4} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="ph-wear" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={21} />
                <feColorMatrix type="matrix" values={`0 0 0 0 0.84  0 0 0 0 0.81  0 0 0 0 0.77  14 0 0 0 -9.4`} />
              </filter>
              <clipPath id="ph-labelClip">
                <circle cx={PC} cy={PC} r={LR} />
              </clipPath>
              <radialGradient id="ph-labelLight" cx="30%" cy="24%" r="90%">
                <stop offset="0%" stopColor="#fffaf0" stopOpacity={0.12} />
                <stop offset="40%" stopColor="#000" stopOpacity={0} />
                <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
              </radialGradient>
            </defs>

            <g fill="none" strokeLinecap="round">
              {SCRATCHES.map((s, i) => {
                const op = (0.02 + 0.45 * lobe(s.a + s.len / 2 + th, phi, 20)) * Lt;
                return <path key={i} d={arcPath(s.r, s.a + thA, s.a + s.len + thB)} stroke="#e8e4dc" strokeWidth={s.w} opacity={op} />;
              })}
              {CHORDS.map((c, i) => {
                const [x0, y0] = polar(c.r, c.a + th);
                const dir = ((c.a + th + 74) * Math.PI) / 180;
                const op = (0.05 + 0.2 * lobe(c.a + th, phi, 30)) * Lt;
                return <path key={`c${i}`} d={`M${x0} ${y0} l${Math.sin(dir) * c.len} ${-Math.cos(dir) * c.len}`} stroke="#e8e4dc" strokeWidth={1} opacity={op} />;
              })}
              {DUST.map((d, i) => {
                const op = (0.025 + 0.8 * lobe(d.a + th, phi, 14)) * Lt;
                return <path key={`d${i}`} d={arcPath(d.r, d.a + thA, d.a + thB)} stroke="#efebe3" strokeWidth={d.s} opacity={op} />;
              })}
            </g>

            <g clipPath="url(#ph-labelClip)">
              <circle cx={PC} cy={PC} r={LR} fill={PAPER} />
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#ph-paper)" opacity={0.16} style={{ mixBlendMode: "multiply" }} />
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#ph-fibres)" opacity={0.1} style={{ mixBlendMode: "multiply" }} />
              </g>
              {copies.map((a, i) => (
                <g key={i} transform={`rotate(${a} ${PC} ${PC})`}>
                  <Ink textO={textO} opacity={copyA} />
                </g>
              ))}
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#ph-wear)" />
                <g fill="none" stroke="#3b3833" strokeWidth={1.2} opacity={0.5}>
                  {SPINDLE_MARKS.map((m, i) => {
                    const [x0, y0] = polar(SPINDLE + 3, m.a);
                    const [x1, y1] = polar(SPINDLE + 3 + m.len, m.a + m.bend);
                    const [qx, qy] = polar(SPINDLE + 3 + m.len * 0.5, m.a + m.bend * 1.6);
                    return <path key={i} d={`M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}`} />;
                  })}
                </g>
              </g>
              <circle cx={PC} cy={PC} r={LR} fill="url(#ph-labelLight)" />
              <circle cx={PC} cy={PC} r={LR} fill="#000" opacity={1 - (0.18 + 0.82 * Lt)} />
            </g>
            <circle cx={PC} cy={PC} r={LR} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3} />
            <circle cx={PC} cy={PC} r={SPINDLE} fill="#060606" />
            <circle cx={PC} cy={PC} r={SPINDLE - 9} fill="#2a2a2a" />
            <circle cx={PC - 5} cy={PC - 6} r={6} fill="#8a8a86" opacity={0.35 * Lt} />

          </svg>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ mixBlendMode: "screen", opacity: Lt }}>
        <div
          style={{
            position: "absolute",
            left: lay.shaft.left,
            top: lay.shaft.top,
            width: lay.shaft.w,
            height: lay.shaft.h,
            transform: `rotate(${lay.shaft.rot}deg)`,
            transformOrigin: "50% 0%",
            background: "linear-gradient(90deg, rgba(230,226,218,0) 0%, rgba(230,226,218,0.045) 45%, rgba(230,226,218,0.06) 55%, rgba(230,226,218,0) 100%)",
            filter: "blur(30px)",
          }}
        />
      </AbsoluteFill>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`ph-grain${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed * 5 + 3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <radialGradient id="ph-vig" cx={lay.vig.cx} cy={lay.vig.cy} r={lay.vig.r}>
            <stop offset="50%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.88} />
          </radialGradient>
        </defs>
        {Array.from({ length: 46 }, (_, i) => {
          const x = (rand(i * 3.1) * W + f * (0.3 + rand(i) * 0.5)) % W;
          const y = (rand(i * 5.7) * lay.motesH - f * (0.2 + rand(i * 2) * 0.5) + lay.motesH) % lay.motesH;
          return <rect key={i} x={x} y={y} width={2 + rand(i * 4) * 2} height={2 + rand(i * 4) * 2} fill={C.paper} opacity={Lt * 0.25 * rand(i * 6.3)} />;
        })}
        <rect width={W} height={H} fill="url(#ph-vig)" />
        <rect width={W} height={H} filter={`url(#ph-grain${seed})`} opacity={0.075} style={{ mixBlendMode: "screen" }} />
        <rect width={W} height={H} filter={`url(#ph-grain${seed})`} opacity={0.12} style={{ mixBlendMode: "multiply" }} />

        <g style={{ fontFamily: FONT_MONO }} fontWeight={500} fill={labelsCol}>
          <text x={lay.labels.x0} y={lay.labels.y} fontSize={24} letterSpacing={6}>
            WATERHOUSE STUDIOS
          </text>
          <text x={lay.labels.x1} y={lay.labels.y} fontSize={24} letterSpacing={6} textAnchor="end">
            SIDE A · 33⅓
          </text>
        </g>
        {f >= T.hold ? (
          <g fill={C.paper} style={{ fontFamily: FONT_DISPLAY }} fontSize={lay.title.size} textAnchor={lay.title.anchor}>
            <text x={lay.title.x} y={lay.title.y1} textLength={lay.title.len} lengthAdjust="spacing">
              WATERHOUSE
            </text>
            {f >= T.word2 ? (
              <text x={lay.title.x} y={lay.title.y2} textLength={lay.title.len} lengthAdjust="spacing">
                SESSIONS
              </text>
            ) : null}
          </g>
        ) : null}
        {f >= T.rule ? <rect x={lay.title.anchor === "middle" ? lay.title.x - 64 : lay.title.x} y={lay.title.rule} width={128} height={5} fill={C.yellow} /> : null}
        {f >= T.host ? (
          <text x={lay.title.x} y={lay.title.host} fontSize={lay.title.hostSize} letterSpacing={10} fill="#a3a19b" textAnchor={lay.title.anchor} style={{ fontFamily: FONT_MONO }} fontWeight={500}>
            WITH DENZO · TUESDAY
          </text>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};

// root: the exit mask plus the gate weave
const MaskFrame: React.FC<{ mask: string; weave: [number, number]; steady: boolean; children: React.ReactNode }> = ({ mask, weave, steady, children }) => {
  const tr = `translate(${weave[0]}px, ${weave[1]}px)`;
  if (!steady) return <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, transform: tr }}>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>
      <AbsoluteFill style={{ transform: tr }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const PhosphorView: React.FC<{ L: Layout }> = ({ L }) => {
  const f = useCurrentFrame();
  const audio = <Audio src={staticFile("ident/audio/phosphor/mix.wav")} volume={0.9} />;
  if (f >= T.clear) return <AbsoluteFill>{audio}</AbsoluteFill>;

  const cam = camera(f, L);
  // exit: the grooves part into rings, centre out (Platter)
  const sc = PERSP / (PERSP - cam.z);
  const pcx = L.w / 2 + (cam.cx - L.w / 2) * sc;
  const pcy = L.h / 2 + (cam.cy - L.h / 2) * sc;
  let mask = "none";
  if (f >= T.rings) {
    const BW = 54;
    const DUR = 18;
    const stops: string[] = [];
    for (let k = 0; k * BW < L.reach; k++) {
      const r0 = k * BW;
      const tk = T.rings + DUR * Math.pow(r0 / L.reach, 1 / 1.6);
      const o = Easing.in(Easing.cubic)(Math.min(1, Math.max(0, (f - tk) / 6)));
      if (o <= 0) continue;
      const a = r0 + ((1 - o) * BW) / 2;
      const b = r0 + ((1 + o) * BW) / 2;
      stops.push(`#000 ${a.toFixed(1)}px`, `transparent ${(a + 0.8).toFixed(1)}px`, `transparent ${b.toFixed(1)}px`, `#000 ${(b + 0.8).toFixed(1)}px`);
    }
    if (stops.length) mask = `radial-gradient(circle at ${pcx.toFixed(1)}px ${pcy.toFixed(1)}px, #000 0px, ${stops.join(", ")})`;
  }
  // the gate weave arrives with the film world
  const wv = interpolate(f, [66, 76], [0, 1], clamp);
  const weave: [number, number] = [(rand(f * 1.7) - 0.5) * 2 * wv, (rand(f * 2.9 + 4) - 0.5) * 2 * wv];

  const glassO = 1 - interpolate(f, GLASS_OUT, [0, 1], { ...clamp, easing: easeIO });
  const beamGain =
    (f < LINE[1] ? 1.25 : f < LOCK ? 1 : 1 + 0.5 * decay(f - LOCK, 5)) *
    interpolate(f, BEAM_OUT, [1, 0.5], { ...clamp, easing: easeIO }) *
    (f >= T.drop ? Math.exp(-(f - T.drop) / 3.6) : 1);

  return (
    <MaskFrame mask={mask} weave={weave} steady={L.steadyMask}>
      {audio}
      {f >= 62 ? <Record lay={L} f={f} /> : null}
      {glassO > 0.001 ? <Glass L={L} f={f} o={glassO} /> : null}
      {f >= ON && f < LINE[0] + 2 ? (
        <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="ph-dotglow">
              <feGaussianBlur stdDeviation={10} />
            </filter>
          </defs>
          <circle cx={L.rx} cy={L.ry} r={interpolate(f, [ON, ON + 2], [10, 22], clamp)} fill={GLOW} opacity={0.8} filter="url(#ph-dotglow)" />
          <circle cx={L.rx} cy={L.ry} r={5} fill="#fff" />
        </svg>
      ) : null}
      {f >= LINE[0] && f < BURN_END ? <BeamLayer L={L} f={f} gain={beamGain} dy={cam.cy - L.cy} /> : null}
    </MaskFrame>
  );
};

/** 1080×1920 (Shorts). */
export const Phosphor: React.FC = () => <PhosphorView L={PORTRAIT} />;
/** 1920×1080 (stream / YouTube). Same timeline and soundtrack. */
export const PhosphorWide: React.FC = () => <PhosphorView L={LANDSCAPE} />;
