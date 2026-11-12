import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_MONO, LogoPiece, LOGO_ORDER, rand } from "./brand";

/**
 * LASER: a club laser show in haze, and the projector draws the mark.
 * One projector hangs at the top of a dark, hazy room. Cold white beams, thin and hard, read as
 * lines and sheets in the smoke (the haze density drifts, the beams sparkle in it).
 *   K1 a single beam snaps on and swings like a pendulum
 *   K2 it splits into a fan of seven, which sways; the scan speeds up and the fan fills into a sheet
 *   K3 the sheet curls into a cone, which turns to face the camera: a spinning tunnel around the lens
 *   K4 the tunnel collapses and folds into the mark on the scrim, sheets of light from the projector
 *      to every edge (the galvo rings at the corners, the scan rolls, the corners run hot)
 *   K5 the pieces are pulled apart and turned in 3D, then settle; the laser writes the title
 *   K6 the whole mark spins once on its vertical axis
 *   exit: everything folds back into one flat line, the line becomes a light sheet, and the sheet
 *   tilts toward the camera and sweeps down through the lens, wiping the room away to the content.
 *
 * Grid: 120 bpm, beat = 15 f. Sound: src/ident/laser/gen-audio.py renders one bed on this same timeline,
 * and the galvo buzz in it is the scan pattern itself (x on the left channel, y on the right).
 */
export const LASER_FRAMES = 136;

// ---- timeline (frames) ----
const KICKS = [8, 23, 38, 53, 68, 83, 98];
const ARM = 5; // projector aperture warms
const FAN = 23;
const CONE = 38;
const LOCK = 53;
const PULL = 68; // pieces pulled apart
const WRITE: [number, number] = [72, 84];
const SPIN = 83;
const RULE = 87;
const SUB = 89;
const FOLD = 106;
const STRETCH: [number, number] = [109, 113];
const SWEEP: [number, number] = [113, 125.5];
const CLEAR = 126;

const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const heavy = Easing.bezier(0.65, 0, 0.25, 1);
const ease = (f: number, a: number, b: number, e: (t: number) => number = heavy) =>
  interpolate(f, [a, b], [0, 1], { ...cl, easing: e });
const decay = (t: number, tau: number) => (t < 0 ? 0 : Math.exp(-t / tau));

// ---- 3D: camera at the origin looking down +z, y down ----
type Pt = [number, number];
type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const rot = (v: V3, k: V3, t: number): V3 =>
  add(add(mul(v, Math.cos(t)), mul(cross(k, v), Math.sin(t))), mul(k, dot(k, v) * (1 - Math.cos(t))));

// ---- the laser's stroke font (4 × 6 grid, square like Rubik Mono) ----
const GLYPH: Record<string, Pt[][]> = {
  W: [[[0, 0], [0.9, 6], [2, 2.4], [3.1, 6], [4, 0]]],
  A: [[[0, 6], [0, 1.3], [1.3, 0], [2.7, 0], [4, 1.3], [4, 6]], [[0, 3.4], [4, 3.4]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3.2, 3]]],
  R: [[[0, 6], [0, 0], [3.3, 0], [4, 0.7], [4, 2.3], [3.3, 3], [0, 3]], [[2.2, 3], [4, 6]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  O: [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]],
  U: [[[0, 0], [0, 6], [4, 6], [4, 0]]],
  S: [[[4, 0], [0, 0], [0, 3], [4, 3], [4, 6], [0, 6]]],
  I: [[[0, 0], [4, 0]], [[2, 0], [2, 6]], [[0, 6], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
};
// ---- layout: one scene per aspect ratio. Portrait values are the original 1080×1920 cut. ----
type Cfg = {
  W: number;
  H: number;
  F: number;
  APEX: Pt; // projector aperture on screen
  MW: number; // mark width on the scrim
  LY0: number; // mark top
  YLINE: number; // the exit fold line
  FAN_Y: number; // where the fan lands on the scrim
  FAN_X: number; // fan half-width at FAN_Y
  CONE_X: number; // cone radius on the scrim
  GU: number;
  GAP: number;
  T1Y: number;
  T2Y: number;
  SWEEP_Y: number; // the sheet sweeps from YLINE to here
  AMB_R: number;
  VIG: [number, number, number, number]; // vignette: y0, r0, y1, r1
  ORIGIN_Y: number; // camera push origin
  RULE_Y: number;
  SUB_Y: number;
  LBL: { l: number; r: number; t1: number; t2: number; b: number };
  wide: boolean;
};
const PORTRAIT: Cfg = {
  W: 1080, H: 1920, F: 1100, APEX: [540, 205], MW: 700, LY0: 455, YLINE: 860, FAN_Y: 1330, FAN_X: 400, CONE_X: 330,
  GU: 12, GAP: 22, T1Y: 1012, T2Y: 1112, SWEEP_Y: 2300, AMB_R: 900, VIG: [800, 300, 900, 1250], ORIGIN_Y: 700,
  RULE_Y: 1226, SUB_Y: 1258, LBL: { l: 60, r: 950, t1: 92, t2: 128, b: 1412 }, wide: false,
};
// 16:9: projector top centre, the mark centred on the scrim with the title under it, 5% title-safe.
const LANDSCAPE: Cfg = {
  W: 1920, H: 1080, F: 1100, APEX: [960, 82], MW: 590, LY0: 196, YLINE: 600, FAN_Y: 900, FAN_X: 780, CONE_X: 300,
  GU: 10, GAP: 19, T1Y: 646, T2Y: 728, SWEEP_Y: 1380, AMB_R: 1150, VIG: [430, 420, 520, 1250], ORIGIN_Y: 420,
  RULE_Y: 822, SUB_Y: 850, LBL: { l: 96, r: 1824, t1: 54, t2: 88, b: 1000 }, wide: true,
};

const makeScene = (S: Cfg) => {
const { W, H, F } = S;
const CX = W / 2;
const CY = H / 2;
const APEX: Pt = S.APEX;
const PZ = 5;
const P3: V3 = [((APEX[0] - CX) * PZ) / F, ((APEX[1] - CY) * PZ) / F, PZ];
const ZS = 12; // the scrim at the back of the room
const ZN = 0.22; // near clip, for beams aimed at the camera
const onScrim = ([sx, sy]: Pt): V3 => [((sx - CX) * ZS) / F, ((sy - CY) * ZS) / F, ZS];
const proj = (v: V3): Pt => [
  Math.max(-6e4, Math.min(6e4, CX + (F * v[0]) / v[2])),
  Math.max(-6e4, Math.min(6e4, CY + (F * v[1]) / v[2])),
];

// ---- the mark on the scrim ----
const MW = S.MW;
const LK = MW / 1000;
const LX0 = (W - MW) / 2;
const LY0 = S.LY0;
const S0: Pt = [CX, LY0 + 333 * LK]; // mark centre
const YLINE = S.YLINE; // where everything folds to in the exit

type Frame = { f: V3; r: V3; d: V3 };
const fwd0 = norm(sub(onScrim(S0), P3));
const right0 = norm(sub([1, 0, 0], mul(fwd0, fwd0[0])));
const down0 = (() => {
  let d = sub([0, 1, 0], mul(fwd0, fwd0[1]));
  d = sub(d, mul(right0, dot(d, right0)));
  return norm(d);
})();
const FRAME0: Frame = { f: fwd0, r: right0, d: down0 };
const patternOf = (p: Pt): Pt => {
  const v = sub(onScrim(p), P3);
  const c = dot(v, fwd0);
  return [dot(v, right0) / c, dot(v, down0) / c];
};
const TOWARD_CAM = norm(mul(P3, -1));
const AXIS = norm(cross(fwd0, TOWARD_CAM));
const ANG = Math.acos(Math.max(-1, Math.min(1, dot(fwd0, TOWARD_CAM))));
const aimed = (a: number): Frame =>
  a <= 0 ? FRAME0 : { f: rot(fwd0, AXIS, ANG * a), r: rot(right0, AXIS, ANG * a), d: rot(down0, AXIS, ANG * a) };
/** Cast one beam from the projector: where it ends on screen, and whether it lands on the scrim. */
const cast = (u: number, v: number, fr: Frame): { e: Pt; wall: boolean } => {
  const d = norm(add(add(fr.f, mul(fr.r, u)), mul(fr.d, v)));
  let t = 60;
  let wall = false;
  if (d[2] > 0.02) {
    t = (ZS - PZ) / d[2];
    wall = t <= 60;
    t = Math.min(t, 60);
  } else if (d[2] < -0.02) t = (ZN - PZ) / d[2];
  return { e: proj(add(P3, mul(d, t))), wall };
};

const FAN_Y = S.FAN_Y;
const FAN_V = patternOf([CX, FAN_Y])[1];
const FAN_A = patternOf([CX + S.FAN_X, FAN_Y])[0];
const R_CONE = patternOf([CX + S.CONE_X, S0[1]])[0];

const POLY: Record<LogoPiece, Pt[]> = {
  house: [[348, 3], [0, 283], [0, 665], [348, 665]],
  slatA: [[379.6, 48.7], [685.2, 149], [685.2, 287.5], [379.6, 204.4]],
  slatB: [[722.2, 161], [1000, 252.3], [1000, 372.9], [722.2, 297.6]],
  door: [[596.6, 398], [775.1, 438.8], [775.1, 665.9], [596.6, 665.9]],
};
const toS = ([x, y]: Pt): Pt => [LX0 + x * LK, LY0 + y * LK];
const SPOLY = LOGO_ORDER.map((p) => POLY[p].map(toS));
const perim = (p: Pt[]) =>
  p.reduce((s, a, i) => s + Math.hypot(p[(i + 1) % p.length][0] - a[0], p[(i + 1) % p.length][1] - a[1]), 0);
/** Sample a closed polygon evenly, with the galvo's overshoot ringing just after each corner. */
const sampleLoop = (poly: Pt[], n: number): Pt[] => {
  const pts = [...poly, poly[0]];
  const segs = pts.slice(1).map((b, i) => Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1]));
  const total = segs.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) {
    let s = (j / n) * total;
    let k = 0;
    while (k < segs.length - 1 && s > segs[k]) s -= segs[k++];
    const t = Math.min(1, s / segs[k]);
    const a = pts[k];
    const b = pts[k + 1];
    const prev = pts[(k - 1 + poly.length) % poly.length];
    const din: Pt = [(a[0] - prev[0]) / Math.hypot(a[0] - prev[0], a[1] - prev[1]), (a[1] - prev[1]) / Math.hypot(a[0] - prev[0], a[1] - prev[1])];
    const ring = 6 * Math.exp(-s / 9) * Math.sin(s / 4.5);
    out.push([a[0] + (b[0] - a[0]) * t + din[0] * ring, a[1] + (b[1] - a[1]) * t + din[1] * ring]);
  }
  return out;
};
const M = 300;
const PER = SPOLY.map(perim);
const PER_SUM = PER.reduce((a, b) => a + b, 0);
const COUNTS = PER.map((p) => Math.round((p / PER_SUM) * M));
COUNTS[COUNTS.length - 1] += M - COUNTS.reduce((a, b) => a + b, 0);
const STARTS = COUNTS.map((_, i) => COUNTS.slice(0, i).reduce((a, b) => a + b, 0));
const LOGO_S: Pt[] = SPOLY.flatMap((p, i) => sampleLoop(p, COUNTS[i]));
const PIECE_I: number[] = COUNTS.flatMap((c, i) => Array(c).fill(i) as number[]);
const LOGO_PAT: Pt[] = LOGO_S.map(patternOf);
const CENTRE: Pt[] = SPOLY.map((p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]);
// K5: each piece is pulled out and turned on its own vertical axis
const PK = MW / 700;
const PULLS: { dx: number; dy: number; th: number; hw: number }[] = [
  { dx: -78, dy: 10, th: 1.15, hw: 125 },
  { dx: -24, dy: -92, th: -1.0, hw: 110 },
  { dx: 86, dy: -46, th: 1.3, hw: 100 },
  { dx: 44, dy: 84, th: -1.2, hw: 65 },
].map((q) => ({ dx: q.dx * PK, dy: q.dy * PK, th: q.th, hw: q.hw * PK }));
const MORPH_W: [number, number][] = [
  [47, 52],
  [47.5, 52.5],
  [48, 53],
  [48.5, 53],
];

const { GU, GAP, T1Y, T2Y } = S;
const subdivide = (pl: Pt[], step = 9): Pt[] => {
  const out: Pt[] = [pl[0]];
  for (let i = 1; i < pl.length; i++) {
    const [a, b] = [pl[i - 1], pl[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j <= n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
};
const word = (s: string, y: number): Pt[][] => {
  const w = s.length * 4 * GU + (s.length - 1) * GAP;
  const x0 = (W - w) / 2;
  return s.split("").flatMap((ch, i) =>
    GLYPH[ch].map((pl) => subdivide(pl.map(([x, yy]) => [x0 + i * (4 * GU + GAP) + x * GU, y + yy * GU] as Pt))),
  );
};
const TITLE = [...word("WATERHOUSE", T1Y), ...word("SESSIONS", T2Y)];
const strokeLen = (pl: Pt[]) => pl.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - pl[i][0], b[1] - pl[i][1]), 0);
const TITLE_LENS = TITLE.map(strokeLen);
const TITLE_TOTAL = TITLE_LENS.reduce((a, b) => a + b, 0);

// ---- the per-frame light: rays (projector → end), scrim segments, hit dots ----
type Ray = { e: Pt; a: number; w: number };
type Seg = { a: Pt; b: Pt; al: number; w: number };
type Dot = { p: Pt; a: number; r: number };
/** A sheet of light: triangles from the projector to each consecutive pair of points. Narrow
 * (edge-on) triangles run brighter, as a real sheet does in haze: alpha = k * edge / area. */
type Fan = { pts: Pt[]; k: number; cap: number; floor?: number; closed?: boolean; am?: number[] };

const foldPt = (p: Pt, f: number): Pt => {
  if (f < FOLD) return p;
  const fd = ease(f, FOLD, STRETCH[0] + 1, Easing.in(Easing.cubic));
  const st = ease(f, STRETCH[0], STRETCH[1], Easing.out(Easing.cubic));
  return [CX + (p[0] - CX) * (1 + 0.12 * fd + 1.6 * st), p[1] + (YLINE - p[1]) * fd];
};

/** The mark on the scrim at frame f: K5 pull, K6 spin, kick pumps, the exit fold. */
const markAt = (f: number) => {
  const e5 = f < PULL ? 0 : f < PULL + 3 ? Easing.out(Easing.cubic)((f - PULL) / 3) : f < PULL + 5 ? 1 : 1 - ease(f, PULL + 5, PULL + 14);
  const th6 = 2 * Math.PI * ease(f, SPIN, SPIN + 14);
  const pump = 1 + 0.05 * decay(f - LOCK, 4) + 0.03 * decay(f - 98, 4);
  const tf = (p: Pt, k: number): Pt => {
    let [x, y] = p;
    if (e5 > 0) {
      const c = CENTRE[k];
      const P = PULLS[k];
      const th = P.th * e5;
      const lx = x - c[0];
      const ly = y - c[1];
      x = c[0] + lx * Math.cos(th) + P.dx * e5;
      y = c[1] + ly * (1 + 0.3 * Math.sin(th) * (lx / P.hw)) + P.dy * e5;
    }
    if (th6 > 0 && th6 < 2 * Math.PI) {
      const lx = x - CX;
      x = CX + lx * Math.cos(th6);
      y = S0[1] + (y - S0[1]) * (1 + 0.12 * Math.sin(th6) * (lx / (350 * PK)));
    }
    x = CX + (x - CX) * pump;
    y = S0[1] + (y - S0[1]) * pump;
    return foldPt([x, y], f);
  };
  return {
    pts: LOGO_S.map((p, i) => tf(p, PIECE_I[i])),
    corners: SPOLY.flatMap((poly, k) => poly.map((p) => tf(p, k))),
  };
};

const build = (f: number) => {
  const rays: Ray[] = [];
  const segs: Seg[] = [];
  const dots: Dot[] = [];
  const fans: Fan[] = [];
  const hd: { p: Pt | null } = { p: null };
  let band: { y: number; th: number; a: number } | null = null;
  const pump = 1 + 0.32 * Math.max(...KICKS.map((k) => decay(f - k, 2.6)));
  const g = pump * (0.93 + 0.07 * rand(f * 1.7 + 3));
  if (f < KICKS[0]) return { rays, segs, dots, fans, head: hd.p, band, out: 0 };

  if (f < FAN) {
    // one beam, a heavy pendulum swing
    const u = FAN_A * 0.8 * Math.sin((Math.PI * (f - KICKS[0])) / 15);
    const { e, wall } = cast(u, FAN_V, FRAME0);
    rays.push({ e, a: 0.9 * g, w: 3.2 });
    if (wall) dots.push({ p: e, a: g, r: 6 });
    return { rays, segs, dots, fans, head: hd.p, band, out: 0.5 };
  }

  if (f < CONE) {
    // the fan of seven, swaying; the scan fills it into a sheet
    const open = interpolate(f, [FAN, FAN + 3], [0, 1], { ...cl, easing: Easing.out(Easing.exp) });
    const sway = 0.2 * FAN_A * Math.sin((2 * Math.PI * (f - FAN)) / 30);
    const sheet = ease(f, 29, 36);
    for (let k = -3; k <= 3; k++) {
      const { e, wall } = cast(sway + (open * FAN_A * k) / 3, FAN_V, FRAME0);
      rays.push({ e, a: (0.82 - 0.4 * sheet) * g, w: 2.6 });
      if (wall) dots.push({ p: e, a: (1 - 0.5 * sheet) * g, r: 5 });
    }
    if (sheet > 0) {
      const n = 140;
      const pts = Array.from({ length: n }, (_, i) => cast(sway + open * FAN_A * -Math.cos((2 * Math.PI * i) / n), FAN_V, FRAME0));
      fans.push({ pts: pts.slice(0, n / 2 + 1).map((h) => h.e), k: 16 * sheet * g, cap: 0.3 * sheet * g });
      pts.forEach(({ e }, i) => i % 10 === 5 && rays.push({ e, a: 0.06 * sheet * g, w: 1.4 }));
      segs.push({ a: pts[0].e, b: pts[n / 2].e, al: sheet * g, w: 2.6 });
    }
    return { rays, segs, dots, fans, head: hd.p, band, out: 0.6 + 0.4 * sheet };
  }

  if (f < LOCK) {
    // cone → tunnel at the camera → collapse into the mark
    const hgt = ease(f, CONE, CONE + 4, Easing.out(Easing.cubic));
    const mv = ease(f, CONE, CONE + 5);
    const cv = FAN_V * (1 - mv);
    const aim = f < 47 ? ease(f, 40, 46.5) : 1 - ease(f, 47, 51.5, Easing.in(Easing.cubic));
    const rad = (FAN_A + (R_CONE - FAN_A) * mv) * (1 + 0.35 * aim);
    const sp = 2 * Math.PI * 0.012 * Math.pow(f - CONE, 1.6);
    const fr = aimed(aim);
    const w = MORPH_W.map(([a, b]) => ease(f, a, b, Easing.in(Easing.cubic)));
    // wide: the broad fan curls in as a flat ellipse and tightens to the circle, instead of overshooting the frame
    const vr = S.wide ? Math.min(rad, R_CONE * 1.15 * (1 + 0.35 * aim)) : rad;
    const circ = (s: number): Pt => [rad * -Math.cos(2 * Math.PI * s + sp), cv + vr * hgt * Math.sin(2 * Math.PI * s + sp)];
    const hits = LOGO_PAT.map((lp, i) => {
      const wk = w[PIECE_I[i]];
      const c = circ(i / M);
      const sm = 4 * wk * (1 - wk) * 0.012;
      const u = c[0] + (lp[0] - c[0]) * wk + sm * Math.sin(i * 0.9 + f * 1.3);
      const v = c[1] + (lp[1] - c[1]) * wk + sm * Math.cos(i * 0.7 - f);
      return cast(u, v, fr);
    });
    fans.push({
      pts: hits.map((h) => h.e),
      k: 16 * g,
      cap: 0.3 * g,
      floor: 0.012 * g,
      closed: true,
      am: hits.map((_, i) => {
        const j = (i + 1) % M;
        return PIECE_I[i] !== PIECE_I[j] || j === 0 ? 1 - Math.min(w[PIECE_I[i]], w[PIECE_I[j]]) : 1;
      }),
    });
    hits.forEach(({ e }, i) => i % 12 === 0 && rays.push({ e, a: 0.08 * g, w: 1.5 }));
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M;
      const [A, B] = [hits[i], hits[j]];
      if (!A.wall || !B.wall || Math.hypot(A.e[0] - B.e[0], A.e[1] - B.e[1]) > 260) continue;
      const crossPiece = PIECE_I[i] !== PIECE_I[j] || j === 0;
      const lock = crossPiece ? Math.min(w[PIECE_I[i]], w[PIECE_I[j]]) : 0;
      // inside a piece, the closing edge back to its first point appears as it locks
      segs.push({ a: A.e, b: B.e, al: g * (1 - lock * 0.95), w: 2.6 });
    }
    for (let k = 0; k < 4; k++) {
      if (w[k] < 0.05) continue;
      const a = STARTS[k] + COUNTS[k] - 1;
      const b = STARTS[k];
      if (hits[a].wall && hits[b].wall) segs.push({ a: hits[a].e, b: hits[b].e, al: g * w[k], w: 2.6 });
    }
    // the cone's scan, seen as spokes: brightest while it is aimed through the lens
    const wavg = (w[0] + w[1] + w[2] + w[3]) / 4;
    const spokeA = (0.1 * hgt + 0.55 * aim) * (1 - wavg) * g;
    if (spokeA > 0.01)
      for (let k = 0; k < 40; k++) {
        const c = circ(k / 40 + 0.0125);
        const { e } = cast(c[0], c[1], fr);
        rays.push({ e, a: spokeA * (0.7 + 0.3 * rand(k * 7.7 + Math.floor(f / 2))), w: 2.2 });
      }
    // the seven fan ribs ride the upper arc of the cone, then fade into the collapse
    const ribA = 0.5 * (1 - ease(f, 46, 51));
    for (let k = -3; k <= 3; k++) {
      const s = Math.acos(-k / 3) / (2 * Math.PI);
      const c = circ(s);
      const { e, wall } = cast(c[0], c[1], fr);
      rays.push({ e, a: ribA * g, w: 2.4 });
      if (wall) dots.push({ p: e, a: ribA * g, r: 4 });
    }
    return { rays, segs, dots, fans, head: hd.p, band, out: 1 };
  }

  if (f < SWEEP[0]) {
    const gl = 1 - 0.16 * ease(f, WRITE[0], WRITE[1], Easing.linear); // the scan budget: more to draw, dimmer
    const { pts, corners } = markAt(f);
    const roll = (i: number) => 0.74 + 0.26 * Math.cos(2 * Math.PI * ((2 * i) / M - f * 0.21));
    for (let k = 0; k < 4; k++)
      fans.push({ pts: pts.slice(STARTS[k], STARTS[k] + COUNTS[k]), k: 15 * g * gl, cap: 0.28 * g * gl, closed: true });
    pts.forEach((p, i) => i % 7 === 3 && rays.push({ e: p, a: 0.05 * g * gl, w: 1.3 }));
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < COUNTS[k]; j++) {
        const i = STARTS[k] + j;
        const n = STARTS[k] + ((j + 1) % COUNTS[k]);
        segs.push({ a: pts[i], b: pts[n], al: g * gl * roll(i), w: 3.4 });
      }
    }
    corners.forEach((p) => {
      rays.push({ e: p, a: 0.3 * g * gl, w: 2.1 });
      dots.push({ p, a: 0.9 * g * gl, r: 3.6 });
    });
    // the title, written by the laser
    const prog = interpolate(f, WRITE, [0, TITLE_TOTAL], cl);
    if (prog > 0) {
      let left = prog;
      TITLE.forEach((pl, s) => {
        if (left <= 0) return;
        const L = TITLE_LENS[s];
        let cut = pl;
        if (left < L) {
          let acc = 0;
          cut = [pl[0]];
          for (let i = 1; i < pl.length; i++) {
            const d = Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
            if (acc + d >= left) {
              const t = (left - acc) / d;
              cut.push([pl[i - 1][0] + (pl[i][0] - pl[i - 1][0]) * t, pl[i - 1][1] + (pl[i][1] - pl[i - 1][1]) * t]);
              break;
            }
            acc += d;
            cut.push(pl[i]);
          }
          hd.p = foldPt(cut[cut.length - 1], f);
        }
        left -= L;
        const q = cut.map((p) => foldPt(p, f));
        for (let i = 1; i < q.length; i++) segs.push({ a: q[i - 1], b: q[i], al: 0.92 * g * gl, w: 3 });
        if (q.length > 1) fans.push({ pts: q, k: 5 * g, cap: 0.08 * g });
      });
      if (hd.p) {
        rays.push({ e: hd.p, a: 0.6 * g, w: 2.2 });
        dots.push({ p: hd.p, a: 1, r: 5 });
      }
    }
    return { rays, segs, dots, fans, head: hd.p, band, out: 1 };
  }

  // the light sheet tilts toward the camera and sweeps down through the lens
  const p = ease(f, SWEEP[0], SWEEP[1], Easing.in(Easing.quad));
  const y = YLINE + (S.SWEEP_Y - YLINE) * p;
  const fade = 1 - ease(f, SWEEP[0] + 2, SWEEP[1], Easing.linear);
  const bp: Pt[] = Array.from({ length: 91 }, (_, i) => [-420 + ((W + 840) * i) / 90, y] as Pt);
  fans.push({ pts: bp, k: 16 * fade * g, cap: 0.3 * fade * g });
  bp.forEach((e, i) => i % 9 === 4 && rays.push({ e, a: 0.06 * fade * g, w: 1.4 }));
  band = { y, th: 5 + 46 * p * p, a: Math.min(1, g) * (1 - 0.3 * p) };
  return { rays, segs, dots, fans, head: hd.p, band, out: fade };
};

// ---- canvases (one set per render tab) ----
type Bufs = {
  beam: HTMLCanvasElement;
  scrim: HTMLCanvasElement;
  s1: HTMLCanvasElement;
  s2: HTMLCanvasElement;
  haze: HTMLCanvasElement;
  hazeF: HTMLCanvasElement;
  spark: HTMLCanvasElement[];
};
let BUFS: Bufs | null = null;
const [HZW, HZH] = S.wide ? [360, 200] : [200, 360]; // haze texture
const [SW, SH] = S.wide ? [480, 270] : [270, 480]; // small blur buffers
const [TW, TH] = S.wide ? [192, 108] : [108, 192];
const mk = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const vnoise = (x: number, y: number, seed: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const h = (a: number, b: number) => rand(a * 157.31 + b * 311.7 + seed * 71.3);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const [a, b, c, d] = [h(xi, yi), h(xi + 1, yi), h(xi, yi + 1), h(xi + 1, yi + 1)];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const bufs = (): Bufs => {
  if (BUFS) return BUFS;
  const haze = mk(HZW, HZH);
  const hc = haze.getContext("2d")!;
  const img = hc.createImageData(HZW, HZH);
  for (let y = 0; y < HZH; y++)
    for (let x = 0; x < HZW; x++) {
      let n = 0;
      let amp = 0.55;
      let fq = 1 / 34;
      for (let o = 0; o < 4; o++) {
        n += amp * vnoise(x * fq, y * fq * 0.75, o + 1);
        amp *= 0.5;
        fq *= 2.1;
      }
      const d = Math.max(0, Math.min(1, (n - 0.28) / 0.62));
      const i = (y * HZW + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * (0.42 + 0.58 * d));
    }
  hc.putImageData(img, 0, 0);
  const spark = [0, 1, 2, 3].map((s) => {
    const c = mk(256, 256);
    const cx = c.getContext("2d")!;
    const im = cx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const r = rand(i * 0.731 + s * 911.3);
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255;
      im.data[i * 4 + 3] = Math.round(255 * (0.5 + 0.5 * r));
    }
    cx.putImageData(im, 0, 0);
    return c;
  });
  BUFS = { beam: mk(W, H), scrim: mk(W, H), s1: mk(SW, SH), s2: mk(TW, TH), haze, hazeF: mk(SW, SH), spark };
  return BUFS;
};

const CORE = (a: number) => `rgba(238,243,255,${Math.max(0, Math.min(1, a))})`;

const draw = (ctx: CanvasRenderingContext2D, f: number) => {
  const B = bufs();
  const L = build(f);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.clearRect(0, 0, W, H);
  if (f >= CLEAR) return;

  const roomTop = L.band ? L.band.y : -100; // the room survives only below the sweeping sheet
  const roomIn = interpolate(f, [0, 10], [0, 1], cl);

  // ---- room ----
  if (L.band) {
    const gr = ctx.createLinearGradient(0, roomTop - 36, 0, roomTop + 6);
    gr.addColorStop(0, "rgba(2,2,3,0)");
    gr.addColorStop(1, "rgba(2,2,3,1)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, roomTop - 36, W, H - roomTop + 36);
  } else {
    ctx.fillStyle = "#020203";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Math.max(0, roomTop), W, H);
  ctx.clip();
  // haze lit around the projector (it warms on ARM)
  const warm = interpolate(f, [ARM, ARM + 3], [0, 1], cl) * (0.35 + 0.65 * L.out);
  const amb = ctx.createRadialGradient(APEX[0], APEX[1], 0, APEX[0], APEX[1], S.AMB_R);
  amb.addColorStop(0, `rgba(150,165,205,${0.1 * warm * roomIn})`);
  amb.addColorStop(0.5, `rgba(80,90,120,${0.035 * warm * roomIn})`);
  amb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = amb;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ---- beams in the haze ----
  const bc = B.beam.getContext("2d")!;
  bc.globalCompositeOperation = "source-over";
  bc.clearRect(0, 0, W, H);
  bc.globalCompositeOperation = "lighter";
  bc.lineCap = "round";
  for (const r of L.rays) {
    if (r.a <= 0.002) continue;
    bc.strokeStyle = CORE(r.a);
    bc.lineWidth = r.w;
    bc.beginPath();
    bc.moveTo(APEX[0], APEX[1]);
    bc.lineTo(r.e[0], r.e[1]);
    bc.stroke();
  }
  for (const fan of L.fans) {
    const n = fan.pts.length;
    const last = fan.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = fan.pts[i];
      const b = fan.pts[(i + 1) % n];
      const ax = a[0] - APEX[0];
      const ay = a[1] - APEX[1];
      const bx = b[0] - APEX[0];
      const by = b[1] - APEX[1];
      const area = Math.abs(ax * by - ay * bx) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let al = Math.max(fan.floor ?? 0, Math.min(fan.cap, (fan.k * len) / Math.max(area, 1)));
      if (fan.am) al *= fan.am[i];
      if (al < 0.003) continue;
      bc.fillStyle = CORE(al);
      bc.beginPath();
      bc.moveTo(APEX[0], APEX[1]);
      bc.lineTo(a[0], a[1]);
      bc.lineTo(b[0], b[1]);
      bc.closePath();
      bc.fill();
    }
  }
  // the lit smoke: a wide blur of the light before the haze, then shaped by the haze itself
  const s2 = B.s2.getContext("2d")!;
  s2.globalCompositeOperation = "source-over";
  s2.clearRect(0, 0, TW, TH);
  s2.filter = "blur(5px)";
  s2.drawImage(B.beam, 0, 0, TW, TH);
  s2.filter = "none";
  s2.globalCompositeOperation = "destination-in";
  if (S.wide) s2.drawImage(B.haze, 40 + f * 0.3, 30 + f * 0.25, 250, 140, 0, 0, TW, TH);
  else s2.drawImage(B.haze, 30, 40 + f * 0.4, 140, 250, 0, 0, TW, TH);
  // haze density: two drifting layers multiplied, then a fine sparkle
  const hf = B.hazeF.getContext("2d")!;
  hf.globalCompositeOperation = "source-over";
  hf.clearRect(0, 0, SW, SH);
  if (S.wide) {
    hf.drawImage(B.haze, -60 + f * 0.45, -40 - f * 0.3, 594, 330);
    hf.globalCompositeOperation = "destination-in";
    hf.drawImage(B.haze, 0, 120, 140, 80, -10 - f * 0.22, -10 + f * 0.1, 520, 300);
  } else {
    hf.drawImage(B.haze, -20 + f * 0.25, -60 - f * 0.55, 330, 594);
    hf.globalCompositeOperation = "destination-in";
    hf.drawImage(B.haze, 120, 0, 80, 140, -10 - f * 0.18, -10 + f * 0.12, 300, 520);
  }
  bc.globalCompositeOperation = "destination-in";
  bc.drawImage(B.hazeF, 0, 0, W, H);
  const pat = bc.createPattern(B.spark[f % 4], "repeat")!;
  bc.save();
  bc.translate((f * 37) % 256, (f * 91) % 256);
  bc.fillStyle = pat;
  bc.fillRect(-256, -256, W + 512, H + 512);
  bc.restore();

  // ---- scrim: what the laser draws on the back wall ----
  const sc = B.scrim.getContext("2d")!;
  sc.globalCompositeOperation = "source-over";
  sc.clearRect(0, 0, W, H);
  sc.globalCompositeOperation = "lighter";
  sc.lineCap = "butt";
  sc.lineJoin = "round";
  for (const s of L.segs) {
    sc.strokeStyle = CORE(s.al);
    sc.lineWidth = s.w;
    sc.beginPath();
    sc.moveTo(s.a[0], s.a[1]);
    sc.lineTo(s.b[0], s.b[1]);
    sc.stroke();
  }
  for (const d of L.dots) {
    sc.fillStyle = CORE(d.a);
    sc.beginPath();
    sc.arc(d.p[0], d.p[1], d.r, 0, Math.PI * 2);
    sc.fill();
  }
  if (L.band) {
    const { y, th, a } = L.band;
    const gb = sc.createLinearGradient(0, y - th * 3, 0, y + th * 3);
    gb.addColorStop(0, "rgba(190,208,255,0)");
    gb.addColorStop(0.42, `rgba(214,226,255,${0.5 * a})`);
    gb.addColorStop(0.5, CORE(a));
    gb.addColorStop(0.58, `rgba(214,226,255,${0.5 * a})`);
    gb.addColorStop(1, "rgba(190,208,255,0)");
    sc.fillStyle = gb;
    sc.fillRect(0, y - th * 3, W, th * 6);
  }

  // ---- composite: beams, scrim, and their scatter in the haze ----
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(B.beam, 0, 0);
  ctx.drawImage(B.scrim, 0, 0);
  const s1 = B.s1.getContext("2d")!;
  s1.globalCompositeOperation = "source-over";
  s1.clearRect(0, 0, SW, SH);
  s1.filter = "blur(2.5px)";
  s1.drawImage(B.beam, 0, 0, SW, SH);
  s1.globalCompositeOperation = "lighter";
  s1.drawImage(B.scrim, 0, 0, SW, SH);
  s1.filter = "none";
  ctx.globalAlpha = 0.95;
  ctx.drawImage(B.s1, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.drawImage(B.s2, 0, 0, W, H);
  ctx.drawImage(B.s2, 0, 0, W, H);
  ctx.globalAlpha = 1;

  // ---- the projector aperture ----
  if (f >= ARM && (!L.band || f < SWEEP[1])) {
    const ap = (f < KICKS[0] ? 0.35 * interpolate(f, [ARM, ARM + 3], [0, 1], cl) : Math.min(1.2, 0.6 + 0.6 * L.out)) * (L.band ? 1 - ease(f, SWEEP[0], SWEEP[0] + 6, Easing.linear) : 1);
    const ag = ctx.createRadialGradient(APEX[0], APEX[1], 0, APEX[0], APEX[1], 70);
    ag.addColorStop(0, CORE(0.9 * ap));
    ag.addColorStop(0.15, `rgba(200,215,255,${0.45 * ap})`);
    ag.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ag;
    ctx.fillRect(APEX[0] - 70, APEX[1] - 70, 140, 140);
    const fl = ctx.createLinearGradient(APEX[0] - 260, 0, APEX[0] + 260, 0);
    fl.addColorStop(0, "rgba(0,0,0,0)");
    fl.addColorStop(0.5, `rgba(205,218,255,${0.22 * ap})`);
    fl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fl;
    ctx.fillRect(APEX[0] - 260, APEX[1] - 1.5, 520, 3);
  }

  // ---- the projector housing, rim-lit by its own spill (room only) ----
  ctx.globalCompositeOperation = "source-over";
  if (!L.band) {
    const rim = 0.05 + 0.1 * warm;
    ctx.fillStyle = "#07080a";
    ctx.fillRect(APEX[0] - 64, APEX[1] - 40, 128, 34);
    ctx.fillStyle = `rgba(210,220,245,${rim})`;
    ctx.fillRect(APEX[0] - 64, APEX[1] - 7, 128, 1.5);
    ctx.fillRect(APEX[0] - 64, APEX[1] - 40, 1.5, 34);
    ctx.fillRect(APEX[0] + 62.5, APEX[1] - 40, 1.5, 34);
  }

  // ---- grain and vignette, on the room only ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Math.max(0, roomTop), W, H);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.045 * roomIn;
  const gp = ctx.createPattern(B.spark[(f + 2) % 4], "repeat")!;
  ctx.translate((f * 53) % 256, (f * 29) % 256);
  ctx.fillStyle = gp;
  ctx.fillRect(-256, -256, W + 512, H + 512);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const vg = ctx.createRadialGradient(CX, S.VIG[0], S.VIG[1], CX, S.VIG[2], S.VIG[3]);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

return { draw, W, H, CX, YLINE };
};
const SCENES = { portrait: makeScene(PORTRAIT), wide: makeScene(LANDSCAPE) };

const Label: React.FC<{ x: number; y: number; cw: number; right?: boolean; o: number; children: React.ReactNode }> = ({ x, y, cw, right, o, children }) => (
  <div
    style={{
      position: "absolute",
      top: y,
      ...(right ? { right: cw - x } : { left: x }),
      fontFamily: FONT_MONO,
      fontWeight: 500,
      fontSize: 23,
      letterSpacing: "0.18em",
      color: "rgba(205,214,232,0.5)",
      opacity: o,
      whiteSpace: "pre",
    }}
  >
    {children}
  </div>
);

const CUES: [number, string][] = [
  [0, "STANDBY"],
  [KICKS[0], "CUE 01  BEAM"],
  [FAN, "CUE 02  FAN"],
  [CONE, "CUE 03  CONE"],
  [LOCK, "CUE 04  LOGO"],
  [WRITE[0], "CUE 05  TEXT"],
  [FOLD, "CUE 06  SHEET"],
];

const LaserView: React.FC<{ wide: boolean }> = ({ wide }) => {
  const S = wide ? LANDSCAPE : PORTRAIT;
  const { draw, W, H, CX, YLINE } = wide ? SCENES.wide : SCENES.portrait;
  const f = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) draw(ctx, f);
  }, [f, draw]);

  const audio = <Audio src={staticFile("ident/audio/laser/bed.wav")} volume={0.9} />;
  if (f >= CLEAR) return <AbsoluteFill>{audio}</AbsoluteFill>;

  // camera: a slow push, a jolt on the lock
  const push = 1 + 0.035 * (f / LASER_FRAMES);
  const jolt = 5 * decay(f - LOCK, 3);
  const jx = (rand(f * 3.3) - 0.5) * jolt;
  const jy = (rand(f * 7.1) - 0.5) * jolt;

  const sweepY = f >= SWEEP[0] ? YLINE + (S.SWEEP_Y - YLINE) * ease(f, SWEEP[0], SWEEP[1], Easing.in(Easing.quad)) : -1e4;
  const vis = (y: number) => (y > sweepY ? 1 : 0);
  const ui = (f >= 4 ? (f < 6 ? 0.4 : 1) : 0) * 1;
  const cue = [...CUES].reverse().find(([k]) => f >= k)![1];
  const cueBlink = CUES.some(([k]) => k > 0 && f - k >= 0 && f - k < 2) ? 0.35 : 1;

  const fold = f < FOLD ? 1 : 1 - ease(f, FOLD, STRETCH[0] + 1, Easing.in(Easing.cubic));
  const ruleW = interpolate(f, [RULE, RULE + 6], [0, 132], { ...cl, easing: Easing.out(Easing.cubic) });
  const SUBTXT = "WITH DENZO · TUESDAY";
  const subChars = Math.floor(interpolate(f, [SUB, SUB + 11], [0, SUBTXT.length], cl));

  return (
    <AbsoluteFill>
      {audio}
      <AbsoluteFill style={{ transform: `translate(${jx}px, ${jy}px) scale(${push})`, transformOrigin: `${CX}px ${S.ORIGIN_Y}px` }}>
        <canvas ref={ref} width={W} height={H} style={{ position: "absolute", inset: 0, width: W, height: H }} />
        {f < SWEEP[0] ? (
          <div style={{ position: "absolute", inset: 0, transform: `scale(1, ${Math.max(0.001, fold)})`, transformOrigin: `${CX}px ${YLINE}px` }}>
            <div
              style={{
                position: "absolute",
                left: CX - 66,
                top: S.RULE_Y,
                width: ruleW,
                height: 5,
                backgroundColor: C.yellow,
                boxShadow: "0 0 16px rgba(255,212,0,0.35)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: S.SUB_Y,
                width: W,
                textAlign: "center",
                fontFamily: FONT_MONO,
                fontWeight: 700,
                fontSize: 29,
                letterSpacing: "0.3em",
                color: "rgba(238,242,252,0.74)",
                whiteSpace: "pre",
              }}
            >
              {SUBTXT.slice(0, subChars).padEnd(SUBTXT.length, " ")}
            </div>
          </div>
        ) : null}
        <Label cw={W} x={S.LBL.l} y={S.LBL.t1} o={ui * vis(S.LBL.t1) * cueBlink}>
          {cue}
        </Label>
        <Label cw={W} x={S.LBL.r} y={S.LBL.t1} right o={ui * vis(S.LBL.t1)}>
          {"120 BPM"}
        </Label>
        <Label cw={W} x={S.LBL.l} y={S.LBL.t2} o={ui * vis(S.LBL.t2) * 0.7}>
          {"SCAN 30K PPS  ·  CH 1"}
        </Label>
        <Label cw={W} x={S.LBL.l} y={S.LBL.b} o={ui * vis(S.LBL.b)}>
          {"WATERHOUSE STUDIOS"}
        </Label>
        <Label cw={W} x={S.LBL.r} y={S.LBL.b} right o={ui * vis(S.LBL.b)}>
          {"AMS"}
        </Label>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Laser: React.FC = () => <LaserView wide={false} />;
/** 16:9 cut, 1920×1080, registered as "Laser-16x9". Same timeline and audio. */
export const LaserWide: React.FC = () => <LaserView wide />;
