import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_MONO, H, LogoPiece, LOGO_ORDER, W, rand } from "./brand";
import { Grain } from "./common";

/**
 * SCOPE: oscilloscope music. The mark is drawn by the beam of a vector CRT, and the
 * picture and the sound are the same signal (src/ident/scope/gen-audio.py renders the XY trace).
 * Black glass, cold white phosphor, persistence trails, a faint graticule.
 *   power-on: dot → flat line with mains hum
 *   Y–T: the line rides the kick as a triggered waveform
 *   the waveform folds into a 3:2 Lissajous, which twists
 *   each piece of the mark is pulled out of the Lissajous; locks on the big kick
 *   the beam writes WATERHOUSE / SESSIONS; kicks warp it (bass wobble, XY spin) and it snaps back
 *   CRT power-off: squash to a line, line to a dot, the dot flares and dies → content
 *
 * Two layouts share one timeline and one audio bed:
 *   `Scope`     1080×1920: mark centred, title stacked under it.
 *   `ScopeWide` 1920×1080: a horizontal lockup, mark left of centre and the title beside it,
 *               on a 14 × 8 graticule; the screen centre is the beam's origin and collapse point.
 *
 * Grid: 120 bpm, beat = 15 f.
 */
export const SCOPE_FRAMES = 134;

// ---- timeline (frames) ----
const ON = 2; // dot appears
const LINE = [5, 10]; // dot opens to a line
const KICKS = [15, 30, 45, 75, 90];
const FOLD = [33, 47]; // waveform → Lissajous
const MORPH: Record<LogoPiece, [number, number]> = {
  house: [45, 54],
  slatA: [48, 57],
  slatB: [50, 59],
  door: [52, 60],
};
const LOCK = 60; // big kick, the mark locks
const TITLE = [64, 83]; // the beam writes the title
const RULE = 84;
const SUB = 88;
const OFF = 105; // power-off
const SQUASH = [OFF, OFF + 5];
const SHRINK = [OFF + 5, OFF + 10];
const FLARE = OFF + 10;
const CLEAR = 124;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const heavy = Easing.bezier(0.65, 0, 0.25, 1);

type Pt = [number, number];

// ---- the mark as polygons (logo units; the house's tiny corner radii dropped) ----
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

// ---- stroke font for the beam (4 × 6 grid, square like Rubik Mono) ----
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
const subdivide = (pl: Pt[], step = 10): Pt[] => {
  const out: Pt[] = [pl[0]];
  for (let i = 1; i < pl.length; i++) {
    const [a, b] = [pl[i - 1], pl[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j <= n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
};
const strokeLen = (pl: Pt[]) => pl.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - pl[i][0], b[1] - pl[i][1]), 0);

// ---- layout ----
type Layout = {
  w: number;
  h: number;
  CX: number; // beam origin, Lissajous centre, warp centre, collapse point
  CY: number;
  SX0: number; // scope area (the waveform spans it, the collapse line too)
  SX1: number;
  LX: number; // Lissajous amplitudes
  LY: number;
  grat: { x0: number; y0: number; div: number; cols: number; rows: number };
  LOGO_PTS: Pt[];
  CORNERS: { p: Pt; piece: LogoPiece }[];
  TITLE_STROKES: Pt[][];
  TITLE_LENS: number[];
  TITLE_TOTAL: number;
  rule: { left: number; top: number; w: number };
  sub: { top: number; left: number; width: number; align: "center" | "left" };
  ro: { l: number; r: number; t1: number; t2: number; b: number }; // readouts
  glassBg: string;
  vignette: string;
  originY: number; // power-off squash origin
};

const makeLayout = (wide: boolean): Layout => {
  const w = wide ? 1920 : W;
  const h = wide ? 1080 : H;
  // mark
  const MW = 760;
  const K = MW / 1000;
  const GU = 13; // px per grid unit → 52 × 78 glyphs
  const GAP = 24;
  const titleW = 10 * 4 * GU + 9 * GAP; // WATERHOUSE
  const LOCKUP_GAP = 96;
  const X0 = wide ? (w - (MW + LOCKUP_GAP + titleW)) / 2 : (W - MW) / 2;
  const Y0 = wide ? 540 - 333 * K : 420;
  const CX = wide ? w / 2 : W / 2;
  const CY = wide ? h / 2 : Y0 + 333 * K;
  const toScreen = ([x, y]: Pt): Pt => [X0 + x * K, Y0 + y * K];
  const LOGO_PTS: Pt[] = LOGO_ORDER.flatMap((p, i) => sampleLoop(POLY[p], COUNTS[i]).map(toScreen));
  const CORNERS = LOGO_ORDER.flatMap((piece) => POLY[piece].map((p) => ({ p: toScreen(p), piece })));
  // title
  const TX = X0 + MW + LOCKUP_GAP; // wide: left-aligned beside the mark
  const T1Y = wide ? 392 : 1030;
  const T2Y = wide ? 392 + 110 : 1140;
  const word = (s: string, y: number): Pt[][] => {
    const ww = s.length * 4 * GU + (s.length - 1) * GAP;
    const x0 = wide ? TX : (W - ww) / 2;
    return s.split("").flatMap((ch, i) =>
      GLYPH[ch].map((pl) => subdivide(pl.map(([x, yy]) => [x0 + i * (4 * GU + GAP) + x * GU, y + yy * GU] as Pt))),
    );
  };
  const TITLE_STROKES = [...word("WATERHOUSE", T1Y), ...word("SESSIONS", T2Y)];
  const TITLE_LENS = TITLE_STROKES.map(strokeLen);
  const TITLE_TOTAL = TITLE_LENS.reduce((a, b) => a + b, 0);
  // graticule: portrait 8 × 10 divs of 120 from (60, 180); wide 14 × 8 divs of 105, centred
  const grat = wide
    ? { x0: CX - 7 * 105, y0: CY - 4 * 105, div: 105, cols: 14, rows: 8 }
    : { x0: 60, y0: 180, div: 120, cols: 8, rows: 10 };
  const SX0 = wide ? grat.x0 : 60;
  const SX1 = wide ? grat.x0 + grat.cols * grat.div : 1020;
  return {
    w,
    h,
    CX,
    CY,
    SX0,
    SX1,
    LX: wide ? 560 : 400,
    LY: 300,
    grat,
    LOGO_PTS,
    CORNERS,
    TITLE_STROKES,
    TITLE_LENS,
    TITLE_TOTAL,
    rule: wide ? { left: TX, top: T2Y + 6 * GU + 46, w: 132 } : { left: CX - 66, top: 1262, w: 132 },
    sub: wide
      ? { top: T2Y + 6 * GU + 82, left: TX, width: w - TX, align: "left" }
      : { top: 1296, left: 0, width: W, align: "center" },
    ro: wide ? { l: 96, r: w - 96, t1: 50, t2: 86, b: 1000 } : { l: 60, r: 950, t1: 96, t2: 134, b: 1420 },
    glassBg: wide
      ? "radial-gradient(ellipse 70% 85% at 50% 48%, #0e1116 0%, #07080b 55%, #020203 100%)"
      : "radial-gradient(ellipse 85% 60% at 50% 40%, #0e1116 0%, #07080b 55%, #020203 100%)",
    vignette: wide
      ? "linear-gradient(112deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 90% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.65) 100%)"
      : "linear-gradient(118deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.65) 100%)",
    originY: CY,
  };
};
const PORTRAIT = makeLayout(false);
const LANDSCAPE = makeLayout(true);

// ---- signal ----
const decay = (t: number, tau: number) => (t < 0 ? 0 : Math.exp(-t / tau));
const kickShape = (u: number) => {
  const t = (u - 0.07) * 0.34; // trigger point at 7% of the screen
  if (t < 0) return 0;
  const ph = 2 * Math.PI * (48 * t + (165 - 48) * 0.035 * (1 - Math.exp(-t / 0.035)));
  return Math.sin(ph) * Math.exp(-t / 0.085);
};
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The raw beam path at frame f (before kick warps): N points, split into the four pieces. */
const trace = (L: Layout, f: number): { pts: Pt[]; w: Record<LogoPiece, number> } => {
  const { CX, CY, SX0, SX1, LX, LY, LOGO_PTS } = L;
  const open = interpolate(f, LINE, [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const amp = 250 * Math.max(decay(f - 15, 6.5), decay(f - 30, 6.5) * 1.1);
  const fold = interpolate(f, FOLD, [0, 1], { ...clamp, easing: heavy });
  const lisAmp = 1 + 0.16 * decay(f - 45, 4);
  const phi = (f - FOLD[0]) * 0.16;
  const w = Object.fromEntries(
    LOGO_ORDER.map((p) => [p, interpolate(f, MORPH[p], [0, 1], { ...clamp, easing: heavy })]),
  ) as Record<LogoPiece, number>;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    let p: Pt;
    if (fold < 1) {
      const hum = 5 * Math.sin(2 * Math.PI * u * 12 + f * 0.7) + (rand(i * 1.37 + f * 97.1) - 0.5) * 2.2;
      const wave: Pt = [CX + (SX0 + (SX1 - SX0) * u - CX) * open, CY - (amp * kickShape(u) + hum) * open];
      p = wave;
    } else p = [0, 0];
    if (fold > 0) {
      const th = u * 2 * Math.PI;
      const lis: Pt = [CX + LX * lisAmp * Math.sin(3 * th + phi), CY + LY * lisAmp * Math.sin(2 * th)];
      p = fold < 1 ? lerp(p, lis, fold) : lis;
      // twist while folding
      const tw = 4 * fold * (1 - fold) * 0.7;
      if (tw > 0) {
        const [dx, dy] = [p[0] - CX, p[1] - CY];
        p = [CX + dx * Math.cos(tw) - dy * Math.sin(tw), CY + dx * Math.sin(tw) + dy * Math.cos(tw)];
      }
    }
    const wk = w[PIECE_OF[i]];
    if (wk > 0) {
      p = lerp(p, LOGO_PTS[i], wk);
      const s = 4 * wk * (1 - wk); // frequency smear mid-morph
      p = [p[0] + s * 34 * Math.sin(u * 2 * Math.PI * 23 + f * 0.9), p[1] + s * 34 * Math.cos(u * 2 * Math.PI * 17 - f * 0.7)];
    }
    pts.push(p);
  }
  return { pts, w };
};

/** Kick warps after the lock, applied to everything the beam draws. */
const warp = (L: Layout, f: number) => {
  const { CX, CY } = L;
  const lockS = 1 + 0.05 * decay(f - LOCK, 4.5);
  const wobT = f - 75;
  const wobA = 44 * decay(wobT, 4.2);
  const spinT = f - 90;
  const spin = 0.95 * decay(spinT, 3);
  const smear = 9 * decay(spinT, 2.4);
  return (p: Pt, i: number): Pt => {
    let [x, y] = p;
    if (lockS !== 1) [x, y] = [CX + (x - CX) * lockS, CY + (y - CY) * lockS];
    if (wobA > 0.05) {
      y += wobA * Math.sin(((x - CX) / 150) * Math.PI + wobT * 1.3);
      x += wobA * 0.25 * Math.cos(((y - CY) / 200) * Math.PI + wobT);
    }
    if (spin > 0.003) {
      const dx = x - CX;
      x = CX + dx * Math.cos(spin);
      y += dx * Math.sin(spin) * 0.14;
      x += smear * Math.sin(i * 0.21 + f * 2.1);
      y += smear * Math.cos(i * 0.13 - f * 1.7);
    }
    return [x, y];
  };
};

const pathOf = (pts: Pt[]) => (pts.length ? "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") : "");

/** Everything the beam draws at frame f, as path strings with an intensity each. */
const beam = (L: Layout, f: number) => {
  const { pts, w } = trace(L, f);
  const wp = f >= LOCK ? warp(L, f) : null;
  const P = wp ? pts.map(wp) : pts;
  const paths: { d: string; a: number }[] = [];
  LOGO_ORDER.forEach((piece, k) => {
    const seg = P.slice(STARTS[k], STARTS[k] + COUNTS[k]);
    paths.push({ d: pathOf(seg), a: 1 });
    if (k < LOGO_ORDER.length - 1) {
      // the retrace between pieces: solid while it's one curve, faint once the pieces lock
      const nxt = P[STARTS[k + 1]];
      const lock = Math.min(w[piece], w[LOGO_ORDER[k + 1]]);
      paths.push({ d: pathOf([seg[seg.length - 1], nxt]), a: 1 - lock * 0.94 });
    }
  });
  // the title, written on by the beam
  let head: Pt | null = null;
  const prog = interpolate(f, TITLE, [0, L.TITLE_TOTAL], clamp);
  if (prog > 0) {
    let left = prog;
    let idx = 0;
    L.TITLE_STROKES.forEach((pl, s) => {
      if (left <= 0) return;
      const len = L.TITLE_LENS[s];
      let cut = pl;
      if (left < len) {
        let acc = 0;
        cut = [pl[0]];
        for (let i = 1; i < pl.length; i++) {
          const d = Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
          if (acc + d >= left) {
            cut.push(lerp(pl[i - 1], pl[i], (left - acc) / d));
            break;
          }
          acc += d;
          cut.push(pl[i]);
        }
        head = cut[cut.length - 1];
      }
      left -= len;
      const q = wp ? cut.map((p, i) => wp(p, idx + i)) : cut;
      idx += pl.length;
      paths.push({ d: pathOf(q), a: 1 });
      if (head && left < 0 && wp) head = q[q.length - 1];
    });
  }
  const corners = L.CORNERS.map(({ p, piece }, i) => ({ p: wp ? wp(p, i * 37) : p, a: w[piece] }));
  return { paths, head: head as Pt | null, corners };
};

// ---- the glass ----
const Graticule: React.FC<{ L: Layout }> = ({ L }) => {
  const { CX, CY } = L;
  const { x0, y0, div, cols, rows } = L.grat;
  const x1 = x0 + cols * div;
  const lines: React.ReactNode[] = [];
  for (let i = 0; i <= cols; i++) lines.push(<line key={`v${i}`} x1={x0 + i * div} y1={y0} x2={x0 + i * div} y2={y0 + rows * div} />);
  for (let j = 0; j <= rows; j++) lines.push(<line key={`h${j}`} x1={x0} y1={y0 + j * div} x2={x1} y2={y0 + j * div} />);
  const tick = div / 5;
  for (let t = 0; t <= cols * 5; t++) {
    const x = x0 + t * tick;
    lines.push(<line key={`tx${t}`} x1={x} y1={CY - 7} x2={x} y2={CY + 7} />);
  }
  for (let t = 0; t <= rows * 5; t++) {
    const y = y0 + t * tick;
    lines.push(<line key={`ty${t}`} x1={CX - 7} y1={y} x2={CX + 7} y2={y} />);
  }
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0 }}>
      <g stroke="rgb(190,205,235)" strokeOpacity={0.06} strokeWidth={1.5}>
        {lines}
      </g>
    </svg>
  );
};

const CORE = "#f7faff";
const GLOW = "#cddcff";
const HALO = "#7f9fe6";

const BeamLayer: React.FC<{ L: Layout; f: number; gain: number }> = ({ L, f, gain }) => {
  const now = beam(L, f);
  const trails = [1, 2, 3, 4].filter((k) => f - k >= LINE[0]).map((k) => ({ k, b: beam(L, f - k) }));
  const TRAIL_A = [0, 0.42, 0.22, 0.11, 0.05];
  const flick = 0.95 + rand(f * 2.3) * 0.05;
  const g = gain * flick;
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id="halo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={20} />
        </filter>
        <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={4.5} />
        </filter>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* halo: wide, soft, cold */}
        <g filter="url(#halo)" stroke={HALO} strokeWidth={14} opacity={Math.min(1, 0.5 * g)}>
          {now.paths.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
        {/* phosphor persistence */}
        {trails.map(({ k, b }) => (
          <g key={k} stroke={GLOW} strokeWidth={3} opacity={TRAIL_A[k] * Math.min(1, g)}>
            {b.paths.map((p, i) => (
              <path key={i} d={p.d} strokeOpacity={p.a} />
            ))}
          </g>
        ))}
        <g filter="url(#glow)" stroke={GLOW} strokeWidth={7} opacity={Math.min(1, 0.88 * g)}>
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
      {/* hot corners: the beam dwells there */}
      <g fill={CORE}>
        {now.corners.map((c, i) =>
          c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={4.2} opacity={c.a * 0.9 * Math.min(1, g)} /> : null,
        )}
      </g>
      <g fill={GLOW} filter="url(#glow)">
        {now.corners.map((c, i) =>
          c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={9} opacity={c.a * 0.55 * Math.min(1, g)} /> : null,
        )}
      </g>
      {now.head ? (
        <>
          <circle cx={now.head[0]} cy={now.head[1]} r={16} fill={GLOW} opacity={0.55} filter="url(#glow)" />
          <circle cx={now.head[0]} cy={now.head[1]} r={5} fill="#ffffff" />
        </>
      ) : null}
    </svg>
  );
};

const Readout: React.FC<{ L: Layout; x: number; y: number; align?: "left" | "right"; children: React.ReactNode; o?: number }> = ({
  L,
  x,
  y,
  align = "left",
  children,
  o = 1,
}) => (
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

const ScopeView: React.FC<{ L: Layout }> = ({ L }) => {
  const f = useCurrentFrame();
  const { CX, CY, SX0, SX1, ro } = L;
  const audio = <Audio src={staticFile("ident/audio/scope/bed.wav")} volume={0.9} />;
  if (f >= CLEAR) return <AbsoluteFill>{audio}</AbsoluteFill>;

  // power-off
  const sy = interpolate(f, SQUASH, [1, 0.004], { ...clamp, easing: Easing.in(Easing.quad) });
  const sx = interpolate(f, SHRINK, [1, 0.0], { ...clamp, easing: Easing.in(Easing.cubic) });
  const offBright = interpolate(f, [OFF, OFF + 5], [1, 2.4], clamp);
  const lineA = f < SQUASH[1] ? interpolate(sy, [0.004, 0.2], [1, 0], clamp) : 1;
  const dotA = interpolate(f, [FLARE - 1, FLARE, FLARE + 3, CLEAR - 1], [0, 1, 0.85, 0], clamp);
  const dotR = interpolate(f, [FLARE, FLARE + 2, CLEAR - 1], [14, 46, 8], { ...clamp, easing: Easing.out(Easing.quad) });

  const glass = interpolate(f, [0, 14], [0, 1], clamp);
  const ui = f >= 11 ? (f < 13 ? 0.45 : 1) : 0;
  const mode = f < FOLD[0] ? "Y–T   50ms/DIV" : f < LOCK ? "X–Y   3:2" : "X–Y   LOCKED";
  const trig = KICKS.concat([LOCK]).some((k) => f - k >= 0 && f - k < 4);
  // beam gain: the lone dot is hot; the long curves spread the energy thinner
  const gain =
    f < LINE[1] ? 1.25 : f < LOCK ? 1 : 1 + 0.5 * decay(f - LOCK, 5) + 0.15 * decay(f - 75, 4) + 0.15 * decay(f - 90, 4);
  const ruleW = interpolate(f, [RULE, RULE + 6], [0, L.rule.w], { ...clamp, easing: Easing.out(Easing.cubic) });
  const subChars = Math.floor(interpolate(f, [SUB, SUB + 12], [0, 20], clamp));
  const SUBTXT = "WITH DENZO · TUESDAY";

  return (
    <AbsoluteFill>
      {audio}
      {f < SHRINK[0] ? (
        <AbsoluteFill
          style={{
            transform: `scale(1, ${sy})`,
            transformOrigin: `${CX}px ${L.originY}px`,
            filter: offBright > 1 ? `brightness(${offBright})` : undefined,
          }}
        >
          <AbsoluteFill style={{ backgroundColor: "#000" }} />
          <AbsoluteFill style={{ opacity: glass, background: L.glassBg }} />
          <AbsoluteFill style={{ opacity: glass }}>
            <Graticule L={L} />
          </AbsoluteFill>
          {f >= ON && f < LINE[0] + 2 ? (
            <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0 }}>
              <defs>
                <filter id="dotglow">
                  <feGaussianBlur stdDeviation={10} />
                </filter>
              </defs>
              <circle cx={CX} cy={CY} r={interpolate(f, [ON, ON + 2], [10, 22], clamp)} fill={GLOW} opacity={0.8} filter="url(#dotglow)" />
              <circle cx={CX} cy={CY} r={5} fill="#fff" />
            </svg>
          ) : null}
          {f >= LINE[0] ? <BeamLayer L={L} f={f} gain={gain} /> : null}

          {/* instrument readouts */}
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

          {/* the one accent, and the subline */}
          <div style={{ position: "absolute", left: L.rule.left, top: L.rule.top, width: ruleW, height: 5, backgroundColor: C.yellow, boxShadow: "0 0 14px rgba(255,212,0,0.35)" }} />
          <div
            style={{
              position: "absolute",
              top: L.sub.top,
              ...(L.sub.align === "left" ? { left: L.sub.left } : {}),
              width: L.sub.width,
              textAlign: L.sub.align,
              fontFamily: FONT_MONO,
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: "0.3em",
              color: "rgba(240,244,252,0.72)",
              whiteSpace: "pre",
            }}
          >
            {SUBTXT.slice(0, subChars).padEnd(SUBTXT.length, " ")}
          </div>

          {/* scanlines, glass noise, sheen */}
          <AbsoluteFill
            style={{
              opacity: 0.5 * glass,
              background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 3px)",
            }}
          />
          <Grain opacity={0.07 * glass} blend="screen" />
          <AbsoluteFill style={{ opacity: glass, background: L.vignette }} />
        </AbsoluteFill>
      ) : null}

      {/* the collapsed line, then the dot */}
      {f >= SQUASH[0] + 2 && f < FLARE + 1 ? (
        <div
          style={{
            position: "absolute",
            left: CX - ((SX1 - SX0) / 2) * sx,
            top: CY - 3,
            width: (SX1 - SX0) * sx,
            height: 6,
            backgroundColor: "#fbfdff",
            opacity: lineA,
            borderRadius: 3,
            boxShadow: "0 0 18px 6px rgba(190,212,255,0.7), 0 0 60px 14px rgba(127,159,230,0.35)",
          }}
        />
      ) : null}
      {dotA > 0 ? (
        <div
          style={{
            position: "absolute",
            left: CX - dotR,
            top: CY - dotR,
            width: dotR * 2,
            height: dotR * 2,
            borderRadius: "50%",
            opacity: dotA,
            background: "radial-gradient(circle, #ffffff 0%, #ffffff 16%, rgba(225,235,255,0.9) 26%, rgba(150,180,240,0.45) 46%, rgba(127,159,230,0) 72%)",
            boxShadow: "0 0 30px 4px rgba(0,0,0,0.25)",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** 1080×1920 (Shorts). */
export const Scope: React.FC = () => <ScopeView L={PORTRAIT} />;
/** 1920×1080 (stream / YouTube). Same timeline and audio bed as `Scope`. */
export const ScopeWide: React.FC = () => <ScopeView L={LANDSCAPE} />;

