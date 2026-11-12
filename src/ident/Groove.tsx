import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, W, rand } from "./brand";
import { Grain } from "./common";
import { THETA, THETA_SUB } from "./groove/motion";

/**
 * GROOVE: the first half of Scope, the second half of Platter, joined by a graphic morph.
 *   Scope: power-on dot → flat line → the line rides two kicks → the waveform folds into a 3:2 Lissajous.
 *   The bridge: the Lissajous resolves to a 1:1 circle, a hot spot starts turning round it at 33⅓ like a
 *   platter, the circle swells to the record's rim and the beam spirals in, ring by ring, to the label edge.
 *   The rings are the grooves: the black glass gives way to black vinyl, the booth light sweeps across them,
 *   the DJ's hand stops and spins the record back (the dim label smears into rings) and catches it dead,
 *   mark upright, on the drop. The mark is never drawn by the beam: it is born on the record.
 *   Platter: scratches on the beat → the title on the held record → release, the power-off brake → the
 *   grooves part into rings that open to the content.
 *
 * Picture and sound share one rotation curve (src/ident/groove/gen-audio.py): the circle IS the record's tone in
 * quadrature, so the XY buzz glides into the stylus reading that same sine, slowed by the hand and wound back.
 * Two layouts, one timeline: `Groove` 1080×1920, `GrooveWide` 1920×1080. Grid: 120 bpm, beat = 15 f.
 */
export const GROOVE_FRAMES = 150;

// ---- timeline (frames) ----
const ON = 2;
const LINE = [5, 10];
const KICKS_SCOPE = [15, 30, 45];
const FOLD = [33, 47];
const GLIDE = [46, 51]; // Lissajous → 1:1 circle
const EXPAND = [50.5, 53]; // the circle swells to the rim
const SPIRAL = [53, 59]; // the beam spirals in to the label edge
const REC_IN = [53, 59]; // vinyl through the glass
const LIGHT_IN = [54, 60];
const T = {
  lock: 60, // caught dead: the drop
  hold: 90,
  word2: 93,
  rule: 97,
  host: 101,
  release: 105,
  brake: 109,
  rings: 115,
  clear: 138, // fully transparent from here
};
const KICKS_BIG = [T.lock, T.hold];
const KICKS = [75, T.release];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const heavy = Easing.bezier(0.65, 0, 0.25, 1);
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
type Pt = [number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const decay = (t: number, tau: number) => (t < 0 ? 0 : Math.exp(-t / tau));

// ---- record geometry (record-plane px), as Platter ----
const D = 2800;
const PC = D / 2;
const RR = 1320;
const LR = 440;
const RS = 900; // where the beam's spiral starts (the circle swells to here, still in frame)
const SPINDLE = 30;
const LOGO_S = 0.6;
const PERSP = 1800;
const VINYL = "#0b0b0b";
const PAPER = "#d6d0c4";
const INK = "#121110";

// ---- phosphor ----
const CORE = "#f7faff";
const GLOW = "#cddcff";
const HALO = "#7f9fe6";

// ---- layout ----
type Layout = {
  w: number;
  h: number;
  // scope half
  CX: number;
  CY: number;
  SX0: number;
  SX1: number;
  LX: number;
  LY: number;
  grat: { x0: number; y0: number; div: number; cols: number; rows: number };
  ro: { l: number; r: number; t1: number; t2: number; b: number };
  glassBg: string;
  vignette: string;
  // record half
  cx: number;
  cy: number;
  z: number;
  tilt: number; // settles after the drop
  reach: number;
  steadyMask: boolean;
  shaft: { left: number; top: number; w: number; h: number; rot: number };
  motesH: number;
  vig: { cx: string; cy: string; r: string };
  labels: { x0: number; x1: number; y: number };
  title: { x: number; y1: number; y2: number; rule: number; host: number; anchor: "middle" | "start"; size: number; len: number; hostSize: number };
};

const PORTRAIT: Layout = {
  w: W,
  h: H,
  CX: W / 2,
  CY: 420 + 333 * 0.76,
  SX0: 60,
  SX1: 1020,
  LX: 400,
  LY: 300,
  grat: { x0: 60, y0: 180, div: 120, cols: 8, rows: 10 },
  ro: { l: 60, r: 950, t1: 96, t2: 134, b: 1420 },
  glassBg: "radial-gradient(ellipse 85% 60% at 50% 40%, #0e1116 0%, #07080b 55%, #020203 100%)",
  vignette:
    "linear-gradient(118deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.65) 100%)",
  cx: W / 2,
  cy: 420 + 333 * 0.76, // the record sits where the scope's beam was centred
  z: 0,
  tilt: 6,
  reach: 1450,
  steadyMask: false,
  shaft: { left: -400, top: -300, w: 900, h: 2600, rot: -28 },
  motesH: 1300,
  vig: { cx: "50%", cy: "40%", r: "78%" },
  labels: { x0: 92, x1: W - 140, y: 150 },
  title: { x: W / 2, y1: 1268, y2: 1378, rule: 1414, host: 1470, anchor: "middle", size: 96, len: 820, hostSize: 30 },
};
const WW = 1920;
const WH = 1080;
const LANDSCAPE: Layout = {
  w: WW,
  h: WH,
  CX: WW / 2,
  CY: WH / 2,
  SX0: WW / 2 - 7 * 105,
  SX1: WW / 2 + 7 * 105,
  LX: 560,
  LY: 300,
  grat: { x0: WW / 2 - 7 * 105, y0: WH / 2 - 4 * 105, div: 105, cols: 14, rows: 8 },
  ro: { l: 96, r: WW - 96, t1: 50, t2: 86, b: 1000 },
  glassBg: "radial-gradient(ellipse 70% 85% at 50% 48%, #0e1116 0%, #07080b 55%, #020203 100%)",
  vignette:
    "linear-gradient(112deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 90% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.65) 100%)",
  cx: 560,
  cy: 540,
  z: -360,
  tilt: 6,
  reach: 1750,
  steadyMask: true,
  shaft: { left: -300, top: -500, w: 1000, h: 2400, rot: -40 },
  motesH: WH,
  vig: { cx: "36%", cy: "50%", r: "75%" },
  labels: { x0: 96, x1: WW - 96, y: 92 },
  title: { x: 1100, y1: 486, y2: 596, rule: 632, host: 688, anchor: "start", size: 96, len: 724, hostSize: 28 },
};

// ---- rotation (degrees, clockwise) ----
const theta = (u: number) => {
  const x = Math.min(Math.max(u * THETA_SUB, 0), THETA.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  return THETA[i] + (THETA[Math.min(i + 1, THETA.length - 1)] - THETA[i]) * t;
};
const SHUTTER = 0.75;

// ---- camera: dead overhead (tilt 0) until the drop, so the beam (screen space) registers on the record ----
const camera = (f: number, lay: Layout) => {
  const tilt = interpolate(f, [T.lock, T.lock + 26], [0, lay.tilt], { ...clamp, easing: heavy }) + interpolate(f, [100, 140], [0, -4], clamp);
  const z = lay.z + interpolate(f, [T.brake - 1, 140], [0, 70], { ...clamp, easing: Easing.in(Easing.quad) });
  let dy = 0;
  for (const k of [...KICKS_BIG, ...KICKS]) {
    const t = f - k;
    if (t < 0 || t > 8) continue;
    const a = (KICKS_BIG.includes(k) ? 7 : 2.5) * Math.exp(-t / 2);
    dy += t === 0 ? a : a * Math.cos(t * 1.7) * 0.6;
  }
  return { tilt, cx: lay.cx, cy: lay.cy + dy, z };
};
/** record centre on screen and plane→screen scale (exact while tilt = 0) */
const plane = (f: number, lay: Layout) => {
  const cam = camera(f, lay);
  const s = PERSP / (PERSP - cam.z);
  return { pcx: lay.w / 2 + (cam.cx - lay.w / 2) * s, pcy: lay.h / 2 + (cam.cy - lay.h / 2) * s, s };
};

// ---- light ----
const light = (f: number) => interpolate(f, [LIGHT_IN[0], LIGHT_IN[1], T.brake, T.brake + 26], [0, 1, 1, 0.42], { ...clamp, easing: easeIO });
// the booth light sweeps in across the grooves, then settles where Platter's sits
const sheenAngle = (f: number) => interpolate(f, [LIGHT_IN[0], 64, 150], [74, -58, -66], { ...clamp, easing: easeIO });
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const lobe = (a: number, phi: number, w = 13) => {
  const d1 = wrap(a - phi);
  const d2 = wrap(a - phi - 180);
  return Math.max(Math.exp(-((d1 / w) ** 2)), Math.exp(-((d2 / w) ** 2)));
};

// =====================================================================
// the beam: Scope's opening, the glide to a circle, the spiral of grooves
// =====================================================================
const N = 960;
const SEG = 64;
const kickShape = (u: number) => {
  const t = (u - 0.07) * 0.34;
  if (t < 0) return 0;
  const ph = 2 * Math.PI * (48 * t + (165 - 48) * 0.035 * (1 - Math.exp(-t / 0.035)));
  return Math.sin(ph) * Math.exp(-t / 0.085);
};

/** the beam's head angle (rad, clockwise from up): it turns with the record */
const headAngle = (f: number) => (theta(f) * Math.PI) / 180;

type Curve = { pts: Pt[]; br: number[]; centre: Pt; R: number; k: number };
/** frames < SPIRAL[0]: the raw beam path. */
const curve = (L: Layout, f: number): Curve => {
  const { CX, CY, SX0, SX1, LX, LY } = L;
  const open = interpolate(f, LINE, [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const amp = 250 * Math.max(decay(f - 15, 6.5), decay(f - 30, 6.5) * 1.1);
  const fold = interpolate(f, FOLD, [0, 1], { ...clamp, easing: heavy });
  const k = interpolate(f, GLIDE, [0, 1], { ...clamp, easing: heavy });
  const e = interpolate(f, EXPAND, [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const lisAmp = 1 + 0.16 * decay(f - 45, 4) * (1 - k);
  const phi = (f - FOLD[0]) * 0.16;
  const { pcx, pcy, s } = plane(f, L);
  const centre: Pt = [lerp(CX, pcx, k), lerp(CY, pcy, k)];
  const R = lerp(LY, RS * s, e);
  const ax = lerp(LX * lisAmp, R, k);
  const ay = lerp(LY * lisAmp, R, k);
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    let p: Pt = [0, 0];
    if (fold < 1) {
      const hum = 5 * Math.sin(2 * Math.PI * u * 12 + f * 0.7) + (rand(i * 1.37 + f * 97.1) - 0.5) * 2.2;
      p = [CX + (SX0 + (SX1 - SX0) * u - CX) * open, CY - (amp * kickShape(u) + hum) * open];
    }
    if (fold > 0) {
      const th = u * 2 * Math.PI;
      // y is the same in both figures (the 110 Hz channel); only x glides from 3θ to the circle's cosine
      const nx = (1 - k) * Math.sin(3 * th + phi) + k * Math.sin(2 * th + Math.PI / 2);
      const ny = Math.sin(2 * th);
      let q: Pt = [centre[0] + ax * nx, centre[1] + ay * ny];
      const tw = 4 * fold * (1 - fold) * 0.7;
      if (tw > 0) {
        const [dx, dy] = [q[0] - centre[0], q[1] - centre[1]];
        q = [centre[0] + dx * Math.cos(tw) - dy * Math.sin(tw), centre[1] + dx * Math.sin(tw) + dy * Math.cos(tw)];
      }
      p = fold < 1 ? [lerp(p[0], q[0], fold), lerp(p[1], q[1], fold)] : q;
    }
    pts.push(p);
  }
  // the hot spot: once it's a circle, a comet turns round it with the platter
  const hd = headAngle(f);
  const br = pts.map(([x, y]) => {
    if (k <= 0) return 1;
    const a = Math.atan2(x - centre[0], -(y - centre[1]));
    const behind = (((hd - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return 1 - k + k * (0.22 + 0.78 * Math.exp(-behind / 1.25));
  });
  return { pts, br, centre, R, k };
};
const pathOf = (pts: Pt[]) => (pts.length ? "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") : "");
const segments = (c: Curve) => {
  const out: { d: string; a: number }[] = [];
  const n = Math.ceil(N / SEG);
  for (let s = 0; s < SEG; s++) {
    const a0 = s * n;
    const a1 = Math.min(N - 1, a0 + n);
    if (a0 >= N - 1) break;
    const seg = c.pts.slice(a0, a1 + 1);
    const b = c.br.slice(a0, a1 + 1);
    out.push({ d: pathOf(seg), a: b.reduce((p, q) => p + q, 0) / b.length });
  }
  return out;
};

const CurveLayer: React.FC<{ L: Layout; f: number; gain: number }> = ({ L, f, gain }) => {
  const now = curve(L, f);
  const segNow = segments(now);
  const trails = [1, 2, 3, 4].filter((k) => f - k >= LINE[0]).map((k) => ({ k, s: segments(curve(L, f - k)) }));
  const TRAIL_A = [0, 0.42, 0.22, 0.11, 0.05];
  const g = gain * (0.95 + rand(f * 2.3) * 0.05);
  const hd = headAngle(f);
  const head: Pt = [now.centre[0] + now.R * Math.sin(hd), now.centre[1] - now.R * Math.cos(hd)];
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id="ghalo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={20} />
        </filter>
        <filter id="gglow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={4.5} />
        </filter>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g filter="url(#ghalo)" stroke={HALO} strokeWidth={14} opacity={Math.min(1, 0.5 * g)}>
          {segNow.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
        {trails.map(({ k, s }) => (
          <g key={k} stroke={GLOW} strokeWidth={3} opacity={TRAIL_A[k] * Math.min(1, g)}>
            {s.map((p, i) => (
              <path key={i} d={p.d} strokeOpacity={p.a} />
            ))}
          </g>
        ))}
        <g filter="url(#gglow)" stroke={GLOW} strokeWidth={7} opacity={Math.min(1, 0.88 * g)}>
          {segNow.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
        <g stroke={CORE} strokeWidth={2.8} opacity={Math.min(1, g)}>
          {segNow.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
      </g>
      {now.k > 0.3 ? (
        <g opacity={interpolate(now.k, [0.3, 0.8], [0, 1], clamp)}>
          <circle cx={head[0]} cy={head[1]} r={18} fill={GLOW} opacity={0.55} filter="url(#gglow)" />
          <circle cx={head[0]} cy={head[1]} r={5.5} fill="#ffffff" />
        </g>
      ) : null}
    </svg>
  );
};

// spiral: the head's radius (plane px) and its inverse
const SPAN = SPIRAL[1] - SPIRAL[0];
const rHead = (f: number) => {
  const p = Math.min(1, Math.max(0, (f - SPIRAL[0]) / SPAN));
  return RS + (LR - RS) * (1 - (1 - p) ** 2);
};
const tAt = (r: number) => {
  const q = Math.min(1, Math.max(0, (RS - r) / (RS - LR)));
  return SPIRAL[0] + SPAN * (1 - Math.sqrt(1 - q));
};

const SpiralLayer: React.FC<{ L: Layout; f: number }> = ({ L, f }) => {
  const { pcx, pcy, s } = plane(f, L);
  const pitch = 16 / s; // 16 screen px between rings
  const field = interpolate(f, [56.5, 61], [1, 0], clamp);
  const edgeA = interpolate(f, [58.4, 59, 60, 64], [0, 1, 0.85, 0], clamp);
  const rh = rHead(f);
  const rings: { r: number; a: number; young: boolean }[] = [];
  // from the swollen circle (RS) inwards: the outermost ring is that circle, so nothing pops at the hand-over
  for (let r = RS; r > LR + pitch * 0.5; r -= pitch) {
    if (r < rh - 0.5) break;
    const age = f - tAt(r);
    rings.push({ r: r * s, a: (0.13 + 0.87 * Math.exp(-age / 2.0)) * field, young: age < 2.5 });
  }
  // this frame's stretch of the spiral, ending at the head (which turns with the record)
  const hd = headAngle(f);
  const dir = Math.sign(theta(f) - theta(f - 1)) || 1;
  const r0 = rHead(f - 1);
  const turns = Math.max(0.05, (r0 - rh) / pitch);
  const nPts = Math.max(24, Math.ceil(turns * 90));
  const sp: Pt[] = [];
  for (let i = 0; i <= nPts; i++) {
    const t = i / nPts;
    const r = lerp(r0, rh, t) * s;
    const a = hd - dir * (1 - t) * turns * 2 * Math.PI;
    sp.push([pcx + r * Math.sin(a), pcy - r * Math.cos(a)]);
  }
  // comet arc behind the head, longer the faster the platter turns
  const dth = Math.abs(theta(f) - theta(f - 1));
  const span = (Math.min(330, Math.max(70, dth * 1.6 + 60)) * Math.PI) / 180;
  const arcs: { d: string; a: number }[] = [];
  const AS = 18;
  for (let j = 0; j < AS; j++) {
    const a0 = hd - dir * span * (j / AS);
    const a1 = hd - dir * span * ((j + 1) / AS);
    const pts: Pt[] = [];
    for (let q = 0; q <= 6; q++) {
      const a = lerp(a0, a1, q / 6);
      pts.push([pcx + rh * s * Math.sin(a), pcy - rh * s * Math.cos(a)]);
    }
    arcs.push({ d: pathOf(pts), a: Math.exp(-j / 5.5) });
  }
  const head: Pt = [pcx + rh * s * Math.sin(hd), pcy - rh * s * Math.cos(hd)];
  const headA = interpolate(f, [58.5, 60.5], [1, 0], clamp);
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id="shalo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={18} />
        </filter>
        <filter id="sglow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={4} />
        </filter>
      </defs>
      <g fill="none">
        {/* the young rings bloom */}
        <g filter="url(#shalo)" stroke={HALO} strokeWidth={12} opacity={0.4 * field}>
          {rings.filter((q) => q.young).map((q, i) => (
            <circle key={i} cx={pcx} cy={pcy} r={q.r} strokeOpacity={q.a} />
          ))}
        </g>
        <g filter="url(#sglow)" stroke={GLOW} strokeWidth={3.5}>
          {rings.map((q, i) => (
            <circle key={i} cx={pcx} cy={pcy} r={q.r} strokeOpacity={q.a * 0.55} />
          ))}
        </g>
        <g stroke={CORE} strokeWidth={1.6}>
          {rings.map((q, i) => (
            <circle key={i} cx={pcx} cy={pcy} r={q.r} strokeOpacity={q.a} />
          ))}
        </g>
        {/* the last ring: the label's edge */}
        {edgeA > 0 ? (
          <g opacity={edgeA}>
            <circle cx={pcx} cy={pcy} r={LR * s} stroke={HALO} strokeWidth={16} filter="url(#shalo)" opacity={0.6} />
            <circle cx={pcx} cy={pcy} r={LR * s} stroke={GLOW} strokeWidth={6} filter="url(#sglow)" />
            <circle cx={pcx} cy={pcy} r={LR * s} stroke={CORE} strokeWidth={2.4} />
          </g>
        ) : null}
        {/* the beam now */}
        {headA > 0 ? (
          <g opacity={headA} strokeLinecap="round">
            <path d={pathOf(sp)} stroke={GLOW} strokeWidth={6} filter="url(#sglow)" opacity={0.8} />
            <path d={pathOf(sp)} stroke={CORE} strokeWidth={2.4} />
            {arcs.map((q, i) => (
              <path key={i} d={q.d} stroke={CORE} strokeWidth={3.2} strokeOpacity={q.a} />
            ))}
            {arcs.map((q, i) => (
              <path key={`g${i}`} d={q.d} stroke={GLOW} strokeWidth={9} strokeOpacity={q.a * 0.6} filter="url(#sglow)" />
            ))}
          </g>
        ) : null}
      </g>
      {headA > 0 ? (
        <g opacity={headA}>
          <circle cx={head[0]} cy={head[1]} r={20} fill={GLOW} opacity={0.6} filter="url(#sglow)" />
          <circle cx={head[0]} cy={head[1]} r={6} fill="#ffffff" />
        </g>
      ) : null}
    </svg>
  );
};

const Graticule: React.FC<{ L: Layout }> = ({ L }) => {
  const { CX, CY } = L;
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

// =====================================================================
// the record (Platter's), plus the label ink
// =====================================================================
const DUST = Array.from({ length: 46 }, (_, i) => ({
  r: LR + 30 + rand(i * 3.7) * (RR - LR - 50),
  a: rand(i * 9.1) * 360,
  s: 1.6 + rand(i * 2.3) ** 2 * 4.5,
}));
const SCRATCHES = Array.from({ length: 14 }, (_, i) => ({
  r: LR + 60 + rand(i * 5.3 + 1) * (RR - LR - 100),
  a: rand(i * 7.9 + 2) * 360,
  len: 14 + rand(i * 1.3 + 3) * 70,
  w: 0.9 + rand(i * 4.1) * 1.1,
}));
const CHORDS = Array.from({ length: 4 }, (_, i) => ({
  a: rand(i * 11.1 + 5) * 360,
  r: LR + 120 + rand(i * 6.6) * 600,
  len: 140 + rand(i * 3.3) * 260,
}));
const SPINDLE_MARKS = Array.from({ length: 11 }, (_, i) => ({
  a: rand(i * 2.9 + 7) * 360,
  len: 26 + rand(i * 8.3) * 44,
  bend: (rand(i * 1.7) - 0.5) * 14,
}));
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
          <textPath href="#grim" textLength={2 * Math.PI * 388 - 8} lengthAdjust="spacing">
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

const MaskFrame: React.FC<{ mask: string; weave: [number, number]; steady: boolean; children: React.ReactNode }> = ({ mask, weave, steady, children }) => {
  const tr = `translate(${weave[0]}px, ${weave[1]}px)`;
  if (!steady) return <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, transform: tr }}>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>
      <AbsoluteFill style={{ transform: tr }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const Record: React.FC<{ lay: Layout; f: number; L: number }> = ({ lay, f, L }) => {
  const cam = camera(f, lay);
  const phi = sheenAngle(f);
  const th = theta(f);
  const thA = theta(f - SHUTTER / 2);
  const thB = theta(f + SHUTTER / 2);
  const smear = Math.abs(thB - thA);
  const n = Math.max(1, Math.min(44, Math.ceil(smear / 1.5)));
  const copyA = n === 1 ? 1 : 1 - Math.pow(1 - 0.96, 1 / n);
  const copies = Array.from({ length: n }, (_, i) => (n === 1 ? th : theta(f - SHUTTER / 2 + (SHUTTER * (i + 0.5)) / n)));
  const textO = Math.min(1, Math.max(0, (4.2 - smear) / 3));
  const sheenStops = (alpha: number) => {
    const s: [number, number][] = [
      [0, 1], [3, 0.82], [7, 0.5], [13, 0.25], [22, 0.1], [36, 0.03], [60, 0],
    ];
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
  return (
    <AbsoluteFill style={{ perspective: `${PERSP}px`, perspectiveOrigin: `${lay.w / 2}px ${lay.h / 2}px` }}>
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
            background: `radial-gradient(ellipse 900px 700px at 30% 26%, rgba(220,216,208,${(0.07 * L).toFixed(3)}), transparent 70%)`,
          }}
        />
        <div style={{ position: "absolute", inset: 0, WebkitMaskImage: trackMask, maskImage: trackMask }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              WebkitMaskImage: grooveMask,
              maskImage: grooveMask,
              background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.95 * L)})`,
            }}
          />
          <div style={{ position: "absolute", inset: 0, background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.1 * L)})` }} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,${(0.022 * L).toFixed(3)}) 0px, rgba(255,255,255,0) 2px, rgba(255,255,255,0) 7px, rgba(255,255,255,${(0.022 * L).toFixed(3)}) 9px)`,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            WebkitMaskImage: gapMask,
            maskImage: gapMask,
            background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.25 * L)})`,
          }}
        />
        <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <path id="grim" d={`M ${PC - 388} ${PC} A 388 388 0 1 1 ${PC + 388} ${PC} A 388 388 0 1 1 ${PC - 388} ${PC}`} />
            <filter id="gpaper" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={3} seed={11} />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <filter id="gfibres" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves={3} seed={4} />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <filter id="gwear" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={21} />
              <feColorMatrix type="matrix" values={`0 0 0 0 0.84  0 0 0 0 0.81  0 0 0 0 0.77  14 0 0 0 -9.4`} />
            </filter>
            <clipPath id="glabelClip">
              <circle cx={PC} cy={PC} r={LR} />
            </clipPath>
            <radialGradient id="glabelLight" cx="30%" cy="24%" r="90%">
              <stop offset="0%" stopColor="#fffaf0" stopOpacity={0.12} />
              <stop offset="40%" stopColor="#000" stopOpacity={0} />
              <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
            </radialGradient>
          </defs>
          <g fill="none" strokeLinecap="round">
            {SCRATCHES.map((s, i) => {
              const mid = s.a + s.len / 2 + th;
              const op = (0.02 + 0.45 * lobe(mid, phi, 20)) * L;
              return <path key={i} d={arcPath(s.r, s.a + thA, s.a + s.len + thB)} stroke="#e8e4dc" strokeWidth={s.w} opacity={op} />;
            })}
            {CHORDS.map((c, i) => {
              const [x0, y0] = polar(c.r, c.a + th);
              const dir = ((c.a + th + 74) * Math.PI) / 180;
              const op = (0.05 + 0.2 * lobe(c.a + th, phi, 30)) * L;
              return <path key={`c${i}`} d={`M${x0} ${y0} l${Math.sin(dir) * c.len} ${-Math.cos(dir) * c.len}`} stroke="#e8e4dc" strokeWidth={1} opacity={op} />;
            })}
            {DUST.map((d, i) => {
              const op = (0.025 + 0.8 * lobe(d.a + th, phi, 14)) * L;
              return <path key={`d${i}`} d={arcPath(d.r, d.a + thA, d.a + thB)} stroke="#efebe3" strokeWidth={d.s} opacity={op} />;
            })}
          </g>
          <g clipPath="url(#glabelClip)">
            <circle cx={PC} cy={PC} r={LR} fill={PAPER} />
            <g transform={`rotate(${th} ${PC} ${PC})`}>
              <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#gpaper)" opacity={0.16} style={{ mixBlendMode: "multiply" }} />
              <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#gfibres)" opacity={0.1} style={{ mixBlendMode: "multiply" }} />
            </g>
            {copies.map((a, i) => (
              <g key={i} transform={`rotate(${a} ${PC} ${PC})`}>
                <Ink textO={textO} opacity={copyA} />
              </g>
            ))}
            <g transform={`rotate(${th} ${PC} ${PC})`}>
              <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#gwear)" />
              <g fill="none" stroke="#3b3833" strokeWidth={1.2} opacity={0.5}>
                {SPINDLE_MARKS.map((m, i) => {
                  const [x0, y0] = polar(SPINDLE + 3, m.a);
                  const [x1, y1] = polar(SPINDLE + 3 + m.len, m.a + m.bend);
                  const [qx, qy] = polar(SPINDLE + 3 + m.len * 0.5, m.a + m.bend * 1.6);
                  return <path key={i} d={`M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}`} />;
                })}
              </g>
            </g>
            <circle cx={PC} cy={PC} r={LR} fill="url(#glabelLight)" />
            {/* unlit, the label is near black: it's born as the booth light comes up */}
            <circle cx={PC} cy={PC} r={LR} fill="#000" opacity={1 - (0.06 + 0.94 * L)} />
          </g>
          <circle cx={PC} cy={PC} r={LR} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3} />
          <circle cx={PC} cy={PC} r={SPINDLE} fill="#060606" />
          <circle cx={PC} cy={PC} r={SPINDLE - 9} fill="#2a2a2a" />
          <circle cx={PC - 5} cy={PC - 6} r={6} fill="#8a8a86" opacity={0.35 * L} />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// =====================================================================
const GrooveView: React.FC<{ L: Layout }> = ({ L: lay }) => {
  const f = useCurrentFrame();
  const { w: Wd, h: Hd, CX, CY, ro } = lay;
  const audio = <Audio src={staticFile("ident/audio/groove/mix.wav")} volume={0.9} />;
  if (f >= T.clear) return <AbsoluteFill>{audio}</AbsoluteFill>;

  const Lt = light(f);
  const recO = interpolate(f, REC_IN, [0, 1], { ...clamp, easing: easeIO });
  const glassO = interpolate(f, [0, 14, 54, 60], [0, 1, 1, 0], clamp);
  const gratO = interpolate(f, [48, 56], [1, 0], clamp);
  const ui = (f >= 11 ? (f < 13 ? 0.45 : 1) : 0) * interpolate(f, [51, 56], [1, 0], clamp);
  const mode = f < FOLD[0] ? "Y–T   50ms/DIV" : f < GLIDE[0] + 1 ? "X–Y   3:2" : "X–Y   1:1";
  const trig = KICKS_SCOPE.some((k) => f - k >= 0 && f - k < 4);
  const gain = f < LINE[1] ? 1.25 : 1 + 0.25 * decay(f - 45, 4);

  // exit: grooves part into rings, centre out (Platter's)
  const { pcx, pcy } = plane(f, lay);
  let mask = "none";
  if (f >= T.rings) {
    const BW = 54;
    const DUR = 16;
    const stops: string[] = [];
    for (let k = 0; k * BW < lay.reach; k++) {
      const r0 = k * BW;
      const tk = T.rings + DUR * Math.pow(r0 / lay.reach, 1 / 1.6);
      const o = Easing.in(Easing.cubic)(Math.min(1, Math.max(0, (f - tk) / 6)));
      if (o <= 0) continue;
      const a = r0 + ((1 - o) * BW) / 2;
      const b = r0 + ((1 + o) * BW) / 2;
      stops.push(`#000 ${a.toFixed(1)}px`, `transparent ${(a + 0.8).toFixed(1)}px`, `transparent ${b.toFixed(1)}px`, `#000 ${(b + 0.8).toFixed(1)}px`);
    }
    if (stops.length) mask = `radial-gradient(circle at ${pcx.toFixed(1)}px ${pcy.toFixed(1)}px, #000 0px, ${stops.join(", ")})`;
  }
  // gate weave: arrives with the vinyl
  const wv = interpolate(f, REC_IN, [0, 1], clamp);
  const gx = (rand(f * 1.7) - 0.5) * 2 * wv;
  const gy = (rand(f * 2.9 + 4) - 0.5) * 2 * wv;
  const seed = Math.floor(f / 2) % 12;
  const labelsA = 0.85 * interpolate(f, [56, 64], [0, 1], clamp);

  return (
    <MaskFrame mask={mask} weave={[gx, gy]} steady={lay.steadyMask}>
      <div style={{ position: "absolute", left: -24, top: -24, width: Wd + 48, height: Hd + 48, backgroundColor: f < REC_IN[0] ? "#000" : "#050505" }} />

      {/* ---- the record world ---- */}
      {recO > 0 ? (
        <AbsoluteFill style={{ opacity: recO }}>
          <Record lay={lay} f={f} L={Lt} />
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
          <svg width={Wd} height={Hd} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <filter id={`ggrain${seed}`} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed * 5 + 3} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <radialGradient id="gvig" cx={lay.vig.cx} cy={lay.vig.cy} r={lay.vig.r}>
                <stop offset="50%" stopColor="#000" stopOpacity={0} />
                <stop offset="100%" stopColor="#000" stopOpacity={0.88} />
              </radialGradient>
            </defs>
            {Array.from({ length: 46 }, (_, i) => {
              const x = (rand(i * 3.1) * Wd + f * (0.3 + rand(i) * 0.5)) % Wd;
              const y = (rand(i * 5.7) * lay.motesH - f * (0.2 + rand(i * 2) * 0.5) + lay.motesH) % lay.motesH;
              return <rect key={i} x={x} y={y} width={2 + rand(i * 4) * 2} height={2 + rand(i * 4) * 2} fill={C.paper} opacity={Lt * 0.25 * rand(i * 6.3)} />;
            })}
            <rect width={Wd} height={Hd} fill="url(#gvig)" />
            <rect width={Wd} height={Hd} filter={`url(#ggrain${seed})`} opacity={0.075} style={{ mixBlendMode: "screen" }} />
            <rect width={Wd} height={Hd} filter={`url(#ggrain${seed})`} opacity={0.12} style={{ mixBlendMode: "multiply" }} />
          </svg>
        </AbsoluteFill>
      ) : null}

      {/* ---- the scope: glass, graticule, beam ---- */}
      {glassO > 0 ? (
        <>
          <AbsoluteFill style={{ opacity: glassO, background: lay.glassBg }} />
          <AbsoluteFill style={{ opacity: glassO * gratO }}>
            <Graticule L={lay} />
          </AbsoluteFill>
        </>
      ) : null}
      {f >= ON && f < LINE[0] + 2 ? (
        <svg width={Wd} height={Hd} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="gdotglow">
              <feGaussianBlur stdDeviation={10} />
            </filter>
          </defs>
          <circle cx={CX} cy={CY} r={interpolate(f, [ON, ON + 2], [10, 22], clamp)} fill={GLOW} opacity={0.8} filter="url(#gdotglow)" />
          <circle cx={CX} cy={CY} r={5} fill="#fff" />
        </svg>
      ) : null}
      {f >= LINE[0] && f < SPIRAL[0] ? <CurveLayer L={lay} f={f} gain={gain} /> : null}
      {f >= SPIRAL[0] && f < 64 ? <SpiralLayer L={lay} f={f} /> : null}

      {/* scope readouts give way to the sleeve labels */}
      {ui > 0 ? (
        <>
          <Readout L={lay} x={ro.l} y={ro.t1} o={ui}>
            {mode}
          </Readout>
          <Readout L={lay} x={ro.r} y={ro.t1} align="right" o={ui}>
            {"120 BPM"}
          </Readout>
          <Readout L={lay} x={ro.l} y={ro.t2} o={ui}>
            <span style={{ color: trig ? "rgba(240,245,255,0.95)" : "rgba(200,210,230,0.35)" }}>TRIG'D</span>
            {"   CH1·X  CH2·Y"}
          </Readout>
          <Readout L={lay} x={ro.l} y={ro.b} o={ui}>
            {"WATERHOUSE STUDIOS"}
          </Readout>
          <Readout L={lay} x={ro.r} y={ro.b} align="right" o={ui}>
            {"AMS"}
          </Readout>
        </>
      ) : null}
      {glassO > 0 ? (
        <>
          <AbsoluteFill
            style={{
              opacity: 0.5 * glassO,
              background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 3px)",
            }}
          />
          <Grain opacity={0.07 * glassO} blend="screen" />
          <AbsoluteFill style={{ opacity: glassO, background: lay.vignette }} />
        </>
      ) : null}

      {/* ---- type (Platter's) ---- */}
      <svg width={Wd} height={Hd} style={{ position: "absolute", inset: 0 }}>
        {labelsA > 0 ? (
          <g style={{ fontFamily: FONT_MONO }} fontWeight={500} fill={`rgba(150,148,142,${labelsA.toFixed(3)})`}>
            <text x={lay.labels.x0} y={lay.labels.y} fontSize={24} letterSpacing={6}>
              WATERHOUSE STUDIOS
            </text>
            <text x={lay.labels.x1} y={lay.labels.y} fontSize={24} letterSpacing={6} textAnchor="end">
              SIDE A · 33⅓
            </text>
          </g>
        ) : null}
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

      {audio}
    </MaskFrame>
  );
};

/** 1080×1920 (Shorts). */
export const Groove: React.FC = () => <GrooveView L={PORTRAIT} />;
/** 1920×1080 (stream / YouTube). Same timeline and soundtrack. */
export const GrooveWide: React.FC = () => <GrooveView L={LANDSCAPE} />;
