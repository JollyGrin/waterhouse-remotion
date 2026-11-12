import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, LogoPiece, LOGO_ORDER, LOGO_PATHS, rand } from "./brand";
import { Grain } from "./common";
import { THETA, THETA_SUB } from "./splice/motion";

/**
 * FUSE: Phosphor's picture on Splice's soundtrack (public/ident/audio/splice/mix.wav, untouched).
 *
 *   f0–55   SCOPE, at Scope time s = sOf(f) (Splice's compressed power-on: f0–6 = s1–11, then s = f + 5):
 *           dot, flat line, kicks f10/25 (s15/30), the 3:2 Lissajous, the beam pulls the mark out and it
 *           locks on the big kick at f55 (s60), at the size and place it is printed on the label.
 *   f55–62  THE MATERIALISE, without a cut and without a spin (the audio has the record caught dead and
 *           silent here): on the boom the beam bursts the label edge and the grooves outward around the
 *           locked mark, the glass dissolves and the booth light comes up on real vinyl and paper. The
 *           vector outline lingers on the label as a cold burn-in and fades under the first strokes.
 *   f62–    PLATTER on Splice's rotation curve (src/ident/splice/motion.ts, Splice frames): baby scratches, the
 *           transformer drag, chirps; the title on the hold (85), release (100), brake (107), the grooves
 *           part into rings (116). Clear from 140.
 * `Fuse` 1080×1920, `FuseWide` 1920×1080. Grid: 120 bpm, beat = 15 f.
 *
 * FUSE-LINES (2026-11-12): the same Fuse, with the scope beam redrawn after the Waterhouse Radio poster:
 * crisp white ink instead of blue phosphor glow, a thin companion line weaving through each stroke, halftone
 * dot shading under the curves, and mono callouts on leader lines. Three variants:
 *   ink   : the straight restyle
 *   wave  : every kick throws receding wavefronts (bowed echo lines), like the poster's speaker waves
 *   draft : a technical drawing: lines boil on twos, stochastic stipple, ruler and extra callouts
 * The record half (f62–) is Fuse's, untouched. Audio: a lower Denzo pressing (src/ident/fuselines/gen-audio.py).
 */
export const FUSE_FRAMES = 150;

// ---- timeline (frames) ----
const ON = 2;
const LINE = [5, 10];
const FOLD = [33, 47];
const MORPH: Record<LogoPiece, [number, number]> = {
  house: [45, 54],
  slatA: [48, 57],
  slatB: [50, 59],
  door: [52, 60],
};
const LOCK = 60; // Scope time (s) of the lock
const LOCK_F = 55; // = Splice CUT: the lock, in frames
const CATCH = 62.5; // first scratch stroke (Splice p52.5)
const sOf = (f: number) => (f < 6 ? 1 + (f * 10) / 6 : f + 5);
const CIRCLES: { r: number; at: [number, number]; a0: number }[] = [
  // a burst on the f55 boom: inside out, fast
  { r: 440, at: [55, 57.5], a0: -90 }, // label edge
  { r: 520, at: [55.4, 58.2], a0: 30 }, // run-out
  { r: 742, at: [55.8, 59], a0: 160 },
  { r: 990, at: [56.2, 59.8], a0: 260 },
  { r: 1262, at: [56.6, 60.6], a0: 10 }, // lead-in
];
const GLASS_OUT = [56.5, 62.5]; // the scope glass dissolves
const BEAM_OUT = [59, 64]; // the beam gives way to the print; from the drop it is a burn-in fading off the label
const BURN_END = 76;
// Splice's hit frames (Platter time p = f - 10)
const T = {
  lightIn: 55,
  lightFull: 63,
  drop: CATCH,
  hold: 85,
  word2: 88,
  rule: 92,
  host: 96,
  release: 100,
  brake: 107,
  rings: 116,
  clear: 140,
};
const KICKS_BIG = [LOCK_F, T.hold]; // the kicks in Splice's mix: none under the scratch
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
const TH0 = 0; // Splice: the record is caught upright at 0 and only the scratches, release and brake turn it
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
const rotOf = (f: number) => (f < CATCH - 0.5 ? 0 : theta(f) - TH0);

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
  const { pts, w } = trace(L, sOf(f));
  const CX = L.rx;
  const CY = L.ry;
  const lockS = 1 + 0.08 * decay(f - LOCK_F, 3.5);
  const rot = (rotOf(rotAt) * Math.PI) / 180;
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  const xf = (p: Pt): Pt => {
    let dx = p[0] - CX;
    let dy = p[1] - CY;
    if (f >= LOCK_F) [dx, dy] = [dx * lockS, dy * lockS];
    return [CX + dx * c - dy * s, CY + dx * s + dy * c];
  };
  const P = pts.map(xf);
  const paths: { d: string; a: number; pts: Pt[] }[] = [];
  LOGO_ORDER.forEach((piece, k) => {
    const seg = P.slice(STARTS[k], STARTS[k] + COUNTS[k]);
    paths.push({ d: pathOf(seg), a: 1, pts: seg });
    if (k < LOGO_ORDER.length - 1) {
      const nxt = P[STARTS[k + 1]];
      const lock = Math.min(w[piece], w[LOGO_ORDER[k + 1]]);
      paths.push({ d: pathOf([seg[seg.length - 1], nxt]), a: 1 - lock * 0.94, pts: [seg[seg.length - 1], nxt] });
    }
  });
  // the label and the grooves, traced around the locked mark
  const heads: Pt[] = [];
  for (const cc of CIRCLES) {
    const p = interpolate(f, cc.at, [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    if (p <= 0) continue;
    const r = cc.r * L.s;
    const n = Math.max(2, Math.ceil(180 * p));
    const arc: Pt[] = [];
    for (let j = 0; j <= n; j++) {
      const a = ((cc.a0 + 360 * p * (j / n)) * Math.PI) / 180;
      arc.push(xf([CX + r * Math.cos(a), CY + r * Math.sin(a)]));
    }
    paths.push({ d: pathOf(arc), a: 0.85, pts: arc });
    if (p < 1) heads.push(arc[arc.length - 1]);
  }
  const corners = L.CORNERS.map(({ p, piece }) => ({ p: xf(p), a: w[piece] }));
  return { paths, heads, corners };
};

// ================= the beam, as ink (f0–75) =================
export type LineVariant = "ink" | "wave" | "draft";
const INKW = "#f1f0ea";
const SPIN_TRAILS = Array.from({ length: 8 }, (_, j) => (j + 1) * 0.375); // frames back, while the record turns

/** Points every `step` px along a polyline. */
const resample = (pts: Pt[], step: number): Pt[] => {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  return out;
};

type Dot = { x: number; y: number; r: number };
/** Halftone shading hugging the curves, dropped below them like the poster's wave shading. */
const halftone = (polys: { pts: Pt[]; a: number }[], L: Layout, cell: number, R: number, drop: number, f: number, stochastic: boolean): Dot[] => {
  const grid = new Map<number, number>();
  const r0 = Math.ceil(R / cell);
  for (const { pts, a } of polys) {
    if (a < 0.05 || pts.length < 3) continue;
    for (const [px, py] of resample(pts, cell * 0.9)) {
      const cx = px;
      const cy = py + drop;
      if (cx < -R || cx > L.w + R || cy < -R || cy > L.h + R) continue;
      const gi = Math.round(cx / cell);
      const gj = Math.round(cy / cell);
      for (let di = -r0; di <= r0; di++) {
        for (let dj = -r0; dj <= r0; dj++) {
          const i = gi + di;
          const j = gj + dj;
          const d = Math.hypot(i * cell - cx, j * cell - cy) / R;
          if (d >= 1) continue;
          const val = Math.pow(1 - d, 2.3) * a;
          const key = (i + 1000) * 4096 + (j + 2048);
          const prev = grid.get(key);
          if (prev === undefined || val > prev) grid.set(key, val);
        }
      }
    }
  }
  const dots: Dot[] = [];
  const sd = Math.floor(f / 2) * 3.1;
  grid.forEach((val, key) => {
    const i = Math.floor(key / 4096) - 1000;
    const j = (key % 4096) - 2048;
    const x0 = i * cell;
    const y0 = j * cell;
    if (x0 < -cell || x0 > L.w + cell || y0 < -cell || y0 > L.h + cell) return;
    const n = rand(key * 0.0137 + 7.7);
    if (stochastic) {
      // stipple: same density, dots of one size scattered in the cell, re-drawn on twos
      if (rand(key * 0.291 + sd) > val * 1.15) return;
      dots.push({ x: x0 + (rand(key * 0.71 + sd) - 0.5) * cell, y: y0 + (rand(key * 0.53 + sd * 1.3) - 0.5) * cell, r: cell * 0.2 });
      return;
    }
    const vv = val * (0.6 + 0.8 * n);
    if (vv < 0.2) return;
    dots.push({ x: x0, y: y0, r: Math.min(1, vv) * cell * 0.34 });
  });
  return dots;
};

/** The thin second line that weaves through each stroke (the poster draws every wave twice). */
const companion = (pts: Pt[], amp: number, freq: number, ph: number): Pt[] =>
  pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    const o = amp * Math.sin((i / pts.length) * 2 * Math.PI * freq + ph);
    return [p[0] + (nx / l) * o, p[1] + (ny / l) * o] as Pt;
  });

/** Hand-drawn boil: a slow wobble re-drawn on twos. */
const boil = (pts: Pt[], f: number, k: number, amp: number): Pt[] => {
  const sd = Math.floor(f / 2) * 13.7 + k * 5.1;
  return pts.map(([x, y], i) => {
    const u = i / Math.max(1, pts.length);
    return [
      x + amp * (Math.sin(u * 37 + sd) * 0.6 + Math.sin(u * 91 + sd * 1.7) * 0.4),
      y + amp * (Math.cos(u * 41 + sd * 1.3) * 0.6 + Math.sin(u * 77 - sd) * 0.4),
    ] as Pt;
  });
};

/** WAVE: the trace a moment ago, thrown outward: bowed and stacked below on the line, ringed out in X–Y. */
const echoesOf = (L: Layout, f: number): { pts: Pt[]; a: number }[] => {
  const s = sOf(f);
  if (s < LINE[0] + 1) return [];
  const fo = interpolate(s, FOLD, [0, 1], { ...clamp, easing: heavy });
  const mAvg = LOGO_ORDER.reduce((acc, p) => acc + interpolate(s, MORPH[p], [0, 1], clamp), 0) / LOGO_ORDER.length;
  const out = interpolate(f, [LOCK_F - 1, LOCK_F + 2], [1, 0], clamp);
  if (out <= 0) return [];
  const gap = L.w > L.h ? 78 : 96;
  const res: { pts: Pt[]; a: number }[] = [];
  for (let k = 1; k <= 4; k++) {
    const se = s - k * 2.2 * (1 - fo);
    if (se < LINE[0]) continue;
    const { pts } = trace(L, se);
    const sc = 1 + k * 0.13 * (1 - mAvg);
    const P = pts.map(([x, y]): Pt => {
      const nx = (x - (L.SX0 + L.SX1) / 2) / ((L.SX1 - L.SX0) / 2);
      const yt: Pt = [x, L.ry + (y - L.ry) * Math.pow(0.82, k) + k * gap + k * 46 * nx * nx];
      const xy: Pt = [L.rx + (x - L.rx) * sc, L.ry + (y - L.ry) * sc];
      return fo <= 0 ? yt : fo >= 1 ? xy : lerp(yt, xy, fo);
    });
    res.push({ pts: P, a: 0.62 * Math.pow(0.7, k - 1) * (1 - 0.75 * mAvg) * out });
  }
  return res;
};

const InkBeam: React.FC<{ L: Layout; f: number; gain: number; dy: number; v: LineVariant }> = ({ L, f, gain, dy, v }) => {
  const now = beam(L, f);
  const g = Math.min(1, gain);
  const flash = f >= LOCK_F ? 1 + 0.7 * decay(f - LOCK_F, 3) : 1;
  const draft = v === "draft";
  const turning = f >= CATCH;
  const main = now.paths.map((p, k) => ({ pts: draft ? boil(p.pts, f, k, 1.8) : p.pts, a: p.a }));
  const echoes = v === "wave" ? echoesOf(L, f) : [];
  const shadeGain = interpolate(f, [CATCH - 2, CATCH + 3], [1, 0], clamp);
  const dots =
    shadeGain > 0
      ? halftone([...main, ...echoes], L, draft ? 8 : 11, draft ? 66 : 58, draft ? 20 : 30, f, draft)
      : [];
  const trails = turning ? SPIN_TRAILS.map((back, k) => ({ k, a: 0.42 * Math.exp(-back / 1.1), b: beam(L, f, f - back) })) : [];
  const comp = (pts: Pt[], k: number) => (pts.length > 8 ? pathOf(companion(draft ? boil(pts, f + 7, k + 40, 1.4) : pts, draft ? 5 : 7, 2 + (k % 3), f * 0.12 + k * 1.9)) : "");
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible", transform: dy ? `translateY(${dy}px)` : undefined }}>
      <g fill={INKW} opacity={(draft ? 0.62 : 0.42) * g * shadeGain}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={d.r.toFixed(2)} />
        ))}
      </g>
      <g fill="none" stroke={INKW} strokeLinecap="round" strokeLinejoin="round">
        {echoes.map((e, k) => (
          <g key={`e${k}`} opacity={e.a * g}>
            <path d={pathOf(e.pts)} strokeWidth={1.8} />
            <path d={comp(e.pts, k + 10)} strokeWidth={0.9} opacity={0.6} />
          </g>
        ))}
        {trails.map(({ k, a, b }) => (
          <g key={`t${k}`} strokeWidth={1.2} opacity={a * g}>
            {b.paths.map((p, i) => (
              <path key={i} d={p.d} strokeOpacity={p.a} />
            ))}
          </g>
        ))}
        <g strokeWidth={1.1} opacity={0.55 * g}>
          {main.map((p, k) => (p.a > 0.5 ? <path key={k} d={comp(p.pts, k)} /> : null))}
        </g>
        <g strokeWidth={(draft ? 2.4 : 2.9) * flash} opacity={g}>
          {main.map((p, k) => (
            <path key={k} d={pathOf(p.pts)} strokeOpacity={p.a} />
          ))}
        </g>
      </g>
      <g fill={INKW}>
        {now.corners.map((c, i) => (c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={3.6} opacity={c.a * g} /> : null))}
      </g>
      {now.heads.map((h, i) => (
        <g key={i} opacity={g}>
          <circle cx={h[0]} cy={h[1]} r={13} fill="none" stroke={INKW} strokeWidth={1} />
          <circle cx={h[0]} cy={h[1]} r={4.5} fill={INKW} />
        </g>
      ))}
    </svg>
  );
};

// ---- callouts: mono label + leader line, the poster's DRIVER / FLAT WALL ----
type Call = { text: string; at: [number, number]; target: (f: number) => Pt | null; label: Pt; only?: LineVariant[] };
const CALL_FS = 23;
const callsFor = (L: Layout): Call[] => {
  const wide = L.w > L.h;
  const CX = L.rx;
  const CY = L.ry;
  const span = L.SX1 - L.SX0;
  const ptsAt = (f: number) => trace(L, sOf(f)).pts;
  const corner = (i: number) => L.CORNERS[i].p;
  const peak = (f: number): Pt => {
    const p = ptsAt(f).slice(0, Math.floor(N * 0.3));
    return p.reduce((m, q) => (Math.abs(q[1] - CY) > Math.abs(m[1] - CY) ? q : m), p[0]);
  };
  const right = (f: number): Pt => ptsAt(f).reduce((m, q) => (q[0] > m[0] ? q : m));
  return [
    { text: "SIGNAL", at: [5, 23], target: () => [L.SX0 + span * 0.8, CY + 3], label: wide ? [L.SX0 + span * 0.86, CY - 120] : [L.SX0 + span * 0.5, CY + 170] },
    { text: "KICK", at: [10, 29], target: peak, label: wide ? [L.SX0 + span * 0.2, CY - 330] : [L.SX0 + span * 0.42, CY - 360] },
    { text: "120 BPM", at: [25, 31], target: () => null, label: wide ? [L.SX0 + span * 0.2, CY - 330 + 34] : [L.SX0 + span * 0.42, CY - 326], only: ["draft"] },
    { text: "X–Y 3:2", at: [31, 45], target: right, label: wide ? [CX + L.LX + 110, CY - 300] : [CX + 80, CY - L.LY - 170] },
    { text: "HOUSE", at: [44, 61], target: () => corner(1), label: [corner(1)[0] - (wide ? 300 : 120), corner(1)[1] - 150] },
    { text: "DOOR", at: [49, 61], target: () => corner(14), label: [corner(14)[0] + 170, corner(14)[1] + 120] },
    { text: "SLAT", at: [47, 61], target: () => corner(9), label: [corner(9)[0] + 120, corner(9)[1] - 170], only: ["draft"] },
    { text: "LOCK", at: [55, 61], target: () => [CX, CY], label: [CX - 40, CY + 330], only: ["draft"] },
  ];
};

const Callouts: React.FC<{ L: Layout; f: number; v: LineVariant; o: number }> = ({ L, f, v, o }) => {
  const calls = callsFor(L).filter((c) => !c.only || c.only.includes(v));
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      {calls.map((c) => {
        const [a, b] = c.at;
        if (f < a || f >= b) return null;
        const alpha = interpolate(f, [b - 3, b], [1, 0], clamp) * o;
        if (alpha <= 0) return null;
        const nch = Math.ceil(c.text.length * interpolate(f, [a, a + 4], [0, 1], clamp));
        const draw = interpolate(f, [a + 1, a + 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        const [lx, ly] = c.label;
        const tw = c.text.length * CALL_FS * 0.6 + (c.text.length - 1) * CALL_FS * 0.12;
        const t = c.target(f);
        let leader = "";
        if (t) {
          const toLeft = t[0] < lx;
          const s0: Pt = toLeft ? [lx - 14, ly - CALL_FS * 0.33] : [lx + tw + 14, ly - CALL_FS * 0.33];
          const knee: Pt = [s0[0] + (t[0] - s0[0]) * 0.45, s0[1]];
          const ctl: Pt = [knee[0] + (t[0] - knee[0]) * 0.55, s0[1]];
          leader = `M${s0[0].toFixed(1)} ${s0[1].toFixed(1)} L${knee[0].toFixed(1)} ${knee[1].toFixed(1)} Q${ctl[0].toFixed(1)} ${ctl[1].toFixed(1)} ${t[0].toFixed(1)} ${t[1].toFixed(1)}`;
        }
        return (
          <g key={c.text} opacity={alpha}>
            <text x={lx} y={ly} fontSize={CALL_FS} letterSpacing={CALL_FS * 0.12} fill={INKW} fillOpacity={0.88} style={{ fontFamily: FONT_MONO }} fontWeight={500}>
              {c.text.slice(0, nch)}
            </text>
            {leader ? <path d={leader} fill="none" stroke={INKW} strokeOpacity={0.8} strokeWidth={1.4} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} /> : null}
          </g>
        );
      })}
    </svg>
  );
};

/** DRAFT: a ruler under the line while it is still Y–T. */
const Ruler: React.FC<{ L: Layout; f: number }> = ({ L, f }) => {
  const s = sOf(f);
  const o = interpolate(s, [LINE[0], LINE[1]], [0, 1], clamp) * (1 - interpolate(s, FOLD, [0, 1], clamp));
  if (o <= 0) return null;
  const y = L.ry + (L.w > L.h ? 300 : 360);
  const span = L.SX1 - L.SX0;
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i <= 70; i++) {
    const x = L.SX0 + (span * i) / 70;
    const big = i % 10 === 0;
    ticks.push(<line key={i} x1={x} y1={y} x2={x} y2={y + (big ? 16 : i % 5 === 0 ? 10 : 6)} />);
  }
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, opacity: 0.45 * o }}>
      <g stroke={INKW} strokeWidth={1}>
        <line x1={L.SX0} y1={y} x2={L.SX1} y2={y} />
        {ticks}
      </g>
      <g fill={INKW} style={{ fontFamily: FONT_MONO }} fontSize={16} letterSpacing={2}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <text key={i} x={L.SX0 + (span * i * 10) / 70 + 4} y={y + 36}>
            {i * 50}
          </text>
        ))}
        <text x={L.SX1} y={y + 36} textAnchor="end">
          350 ms
        </text>
      </g>
    </svg>
  );
};

/** The glass, as paper-black: no graticule, no scanlines, no blue; a soft vignette and grain. */
const InkGlass: React.FC<{ L: Layout; f: number; o: number; v: LineVariant }> = ({ L, f, o, v }) => {
  const s = sOf(f);
  const glass = interpolate(s, [0, 14], [0, 1], clamp);
  const ui = (s >= 11 ? (s < 13 ? 0.45 : 1) : 0) * interpolate(f, [56, 61], [1, 0], clamp);
  const mode = s < FOLD[0] ? "Y–T  50ms/div" : s < LOCK ? "X–Y  3:2" : "X–Y  locked";
  const { ro } = L;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ backgroundColor: "#050505" }} />
      <AbsoluteFill style={{ opacity: glass, background: "radial-gradient(ellipse 80% 80% at 50% 45%, #0d0d0c 0%, #070707 60%, #030303 100%)" }} />
      {v === "draft" ? <Ruler L={L} f={f} /> : null}
      <div style={{ position: "absolute", left: ro.l, top: ro.t1 - 6, opacity: ui, color: INKW }}>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 30, letterSpacing: "0.02em" }}>Waterhouse Sessions</div>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 500, fontSize: 22, letterSpacing: "0.06em", opacity: 0.7, marginTop: 6 }}>{mode}</div>
      </div>
      <div style={{ position: "absolute", right: L.w - ro.r, top: ro.t1, opacity: ui * 0.7, color: INKW, fontFamily: FONT_MONO, fontWeight: 500, fontSize: 22, letterSpacing: "0.06em" }}>
        120 BPM
      </div>
      <Grain opacity={0.06 * glass} blend="screen" />
      <AbsoluteFill style={{ opacity: glass, background: "radial-gradient(ellipse 110% 110% at 50% 50%, transparent 55%, rgba(0,0,0,0.6) 100%)" }} />
    </AbsoluteFill>
  );
};

// ================= the record (f62–) =================
const VINYL = "#0b0b0b";
const PAPER = "#d6d0c4";
const INK = "#121110";

const light = (f: number) => interpolate(f, [T.lightIn, T.lightFull, T.brake, T.brake + 26], [0, 1, 1, 0.42], { ...clamp, easing: easeIO });
const sheenAngle = (f: number) => interpolate(f, [55, 87, 150], [-20, -58, -66], { ...clamp, easing: easeIO });
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const lobe = (a: number, phi: number, w = 13) => {
  const d1 = wrap(a - phi);
  const d2 = wrap(a - phi - 180);
  return Math.max(Math.exp(-((d1 / w) ** 2)), Math.exp(-((d2 / w) ** 2)));
};

const camera = (f: number, lay: Layout) => {
  // flat to the lens while the beam hands over (so the screen-space beam sits exactly on the print), then Platter's tilt
  const tilt = interpolate(f, [BURN_END - 6, BURN_END + 18], [0, 7], { ...clamp, easing: easeIO }) + interpolate(f, [85, 115, 150], [0, -3, -6], clamp);
  const z = lay.z0 + interpolate(f, [108, 140], [0, 70], { ...clamp, easing: Easing.in(Easing.quad) });
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
          <textPath href="#fu-rim" textLength={2 * Math.PI * 388 - 8} lengthAdjust="spacing">
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
  const labelsCol = `rgba(150,148,142,${(0.85 * interpolate(f, [62, 72], [0, 1], clamp)).toFixed(3)})`;

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
              <path id="fu-rim" d={`M ${PC - 388} ${PC} A 388 388 0 1 1 ${PC + 388} ${PC} A 388 388 0 1 1 ${PC - 388} ${PC}`} />
              <filter id="fu-paper" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={3} seed={11} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="fu-fibres" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves={3} seed={4} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="fu-wear" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={21} />
                <feColorMatrix type="matrix" values={`0 0 0 0 0.84  0 0 0 0 0.81  0 0 0 0 0.77  14 0 0 0 -9.4`} />
              </filter>
              <clipPath id="fu-labelClip">
                <circle cx={PC} cy={PC} r={LR} />
              </clipPath>
              <radialGradient id="fu-labelLight" cx="30%" cy="24%" r="90%">
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

            <g clipPath="url(#fu-labelClip)">
              <circle cx={PC} cy={PC} r={LR} fill={PAPER} />
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#fu-paper)" opacity={0.16} style={{ mixBlendMode: "multiply" }} />
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#fu-fibres)" opacity={0.1} style={{ mixBlendMode: "multiply" }} />
              </g>
              {copies.map((a, i) => (
                <g key={i} transform={`rotate(${a} ${PC} ${PC})`}>
                  <Ink textO={textO} opacity={copyA} />
                </g>
              ))}
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#fu-wear)" />
                <g fill="none" stroke="#3b3833" strokeWidth={1.2} opacity={0.5}>
                  {SPINDLE_MARKS.map((m, i) => {
                    const [x0, y0] = polar(SPINDLE + 3, m.a);
                    const [x1, y1] = polar(SPINDLE + 3 + m.len, m.a + m.bend);
                    const [qx, qy] = polar(SPINDLE + 3 + m.len * 0.5, m.a + m.bend * 1.6);
                    return <path key={i} d={`M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}`} />;
                  })}
                </g>
              </g>
              <circle cx={PC} cy={PC} r={LR} fill="url(#fu-labelLight)" />
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
          <filter id={`fu-grain${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed * 5 + 3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <radialGradient id="fu-vig" cx={lay.vig.cx} cy={lay.vig.cy} r={lay.vig.r}>
            <stop offset="50%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.88} />
          </radialGradient>
        </defs>
        {Array.from({ length: 46 }, (_, i) => {
          const x = (rand(i * 3.1) * W + f * (0.3 + rand(i) * 0.5)) % W;
          const y = (rand(i * 5.7) * lay.motesH - f * (0.2 + rand(i * 2) * 0.5) + lay.motesH) % lay.motesH;
          return <rect key={i} x={x} y={y} width={2 + rand(i * 4) * 2} height={2 + rand(i * 4) * 2} fill={C.paper} opacity={Lt * 0.25 * rand(i * 6.3)} />;
        })}
        <rect width={W} height={H} fill="url(#fu-vig)" />
        <rect width={W} height={H} filter={`url(#fu-grain${seed})`} opacity={0.075} style={{ mixBlendMode: "screen" }} />
        <rect width={W} height={H} filter={`url(#fu-grain${seed})`} opacity={0.12} style={{ mixBlendMode: "multiply" }} />

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

const FuseLinesView: React.FC<{ L: Layout; v: LineVariant; audio: string }> = ({ L, v, audio: audioSrc }) => {
  const f = useCurrentFrame();
  const audio = <Audio src={staticFile(audioSrc)} volume={0.9} />;
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
  const wv = interpolate(f, [57, 64], [0, 1], clamp);
  const weave: [number, number] = [(rand(f * 1.7) - 0.5) * 2 * wv, (rand(f * 2.9 + 4) - 0.5) * 2 * wv];

  const glassO = 1 - interpolate(f, GLASS_OUT, [0, 1], { ...clamp, easing: easeIO });
  const beamGain =
    (sOf(f) < LINE[1] ? 1.25 : f < LOCK_F ? 1 : 1 + 0.6 * decay(f - LOCK_F, 4)) *
    interpolate(f, BEAM_OUT, [1, 0.5], { ...clamp, easing: easeIO }) *
    (f >= T.drop ? Math.exp(-(f - T.drop) / 3.6) : 1);

  return (
    <MaskFrame mask={mask} weave={weave} steady={L.steadyMask}>
      {audio}
      {f >= LOCK_F ? <Record lay={L} f={f} /> : null}
      {glassO > 0.001 ? <InkGlass L={L} f={f} o={glassO} v={v} /> : null}
      {sOf(f) >= ON && sOf(f) < LINE[0] + 2 ? (
        <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0 }}>
          <circle cx={L.rx} cy={L.ry} r={interpolate(sOf(f), [ON, ON + 2], [8, 16], clamp)} fill="none" stroke={INKW} strokeWidth={1.2} />
          <circle cx={L.rx} cy={L.ry} r={4.5} fill={INKW} />
        </svg>
      ) : null}
      {sOf(f) >= LINE[0] && f < BURN_END ? <InkBeam L={L} f={f} gain={beamGain} dy={cam.cy - L.cy} v={v} /> : null}
      {glassO > 0.001 ? <Callouts L={L} f={f} v={v} o={glassO} /> : null}
    </MaskFrame>
  );
};

/** 1080×1920 (Shorts) and 1920×1080 (stream / YouTube), per variant. */
export const makeFuseLines = (v: LineVariant, audio: string) => ({
  Tall: (() => <FuseLinesView L={PORTRAIT} v={v} audio={audio} />) as React.FC,
  Wide: (() => <FuseLinesView L={LANDSCAPE} v={v} audio={audio} />) as React.FC,
});
