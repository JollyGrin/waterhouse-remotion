import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO } from "./brand";
import { Grain } from "./common";
import {
  CY_AMP,
  CY_BIG,
  CY_CLEAR,
  CY_FRAMES,
  CY_HIT,
  CY_KICKS,
  CY_LEAP,
  CY_LIGHT,
  CY_LOCK,
  CY_LOGO,
  CY_PATTERNS,
} from "./cymatics/timeline";

/**
 * CYMATICS: sound made visible. Fine white sand on a black plate driven by a speaker.
 * One work light rakes across the plate from the upper left; the grains catch it and cast tiny shadows.
 *   the light comes up on scattered sand
 *   a tone comes in: the sand jitters and runs to the plate's nodal lines (a Chladni figure)
 *   the tone steps up on the kicks; the sand re-forms into denser and denser figures
 *   the impossible frequency: the sand migrates into the mark, which locks on the big kick; title cuts in
 *   a kick: the grains leap, the mark blurs, and lands sharper
 *   a massive sub: the sand is thrown at the lens, the plate falls away to the content
 *
 * The tone and the picture are one signal: src/ident/cymatics/gen-audio.py owns the timeline, the tone
 * frequencies and the per-frame drive amplitude (tone level = how hard the sand jitters).
 * Grid: 120 bpm, beat = 15 f.
 */
export const CYMATICS_FRAMES = CY_FRAMES;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const heavy = Easing.bezier(0.65, 0, 0.25, 1);

// ---- layout ----
// Every size and position below derives from one Layout, so the portrait stays byte-for-byte what it was
// and the 16:9 cut re-composes rather than crops.
type Layout = {
  wide: boolean;
  W: number;
  H: number;
  P: number; // plate size
  PX0: number;
  PY0: number;
  MW: number; // mark width on the plate
};
const PORTRAIT: Layout = { wide: false, W: 1080, H: 1920, P: 960, PX0: (1080 - 960) / 2, PY0: 240, MW: 760 };
const LANDSCAPE: Layout = { wide: true, W: 1920, H: 1080, P: 880, PX0: 120, PY0: 100, MW: 696 };
const N = 16000;

// ---- deterministic randomness ----
const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hash = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const gauss = (u1: number, u2: number): [number, number] => {
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-9, u1)));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
};

// ---- the mark as polygons (logo units) ----
type Pt = [number, number];
const POLY: Pt[][] = [
  [[348, 3], [0, 283], [0, 665], [348, 665]],
  [[379.6, 48.7], [685.2, 149], [685.2, 287.5], [379.6, 204.4]],
  [[722.2, 161], [1000, 252.3], [1000, 372.9], [722.2, 297.6]],
  [[596.6, 398], [775.1, 438.8], [775.1, 665.9], [596.6, 665.9]],
];
const inPoly = (poly: Pt[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const edgeDist = (poly: Pt[], x: number, y: number) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
};

// ---- Hilbert order: matching layouts by curve rank keeps each grain's journey local ----
const hilbert = (x: number, y: number) => {
  const n = 1024;
  let d = 0;
  for (let s = n / 2; s > 0; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
};

const build = (L: Layout): React.FC => {
  const { W, H, P, PX0, PY0, MW, wide } = L;
  const CX = PX0 + P / 2;
  const CY = PY0 + P / 2; // the drive bolt, sits in the empty gap of the mark
  const K = MW / 1000;
  const LX0 = CX - 500 * K;
  const LY0 = CY - 333 * K;
  const S = P / 960; // 1 in portrait

  const sortHilbert = (pts: Float32Array) => {
    const idx = Array.from({ length: N }, (_, i) => i);
    const key = idx.map((i) =>
      hilbert(
        Math.max(0, Math.min(1023, Math.floor(((pts[2 * i] - PX0) / P) * 1024))),
        Math.max(0, Math.min(1023, Math.floor(((pts[2 * i + 1] - PY0) / P) * 1024))),
      ),
    );
    idx.sort((a, b) => key[a] - key[b]);
    const out = new Float32Array(2 * N);
    idx.forEach((s, r) => {
      out[2 * r] = pts[2 * s];
      out[2 * r + 1] = pts[2 * s + 1];
    });
    return out;
  };

  // ---- target layouts ----
  const INSET = 14;
  const plateRand = (r: () => number): Pt => [PX0 + INSET + r() * (P - 2 * INSET), PY0 + INSET + r() * (P - 2 * INSET)];
  const nearBolt = (x: number, y: number) => Math.hypot(x - CX, y - CY) < 26;

  const scatterLayout = () => {
    const r = mulberry(101);
    const out = new Float32Array(2 * N);
    const clumps: Pt[] = Array.from({ length: 6 }, () => plateRand(r));
    for (let i = 0; i < N; i++) {
      let x: number;
      let y: number;
      do {
        if (r() < 0.62) [x, y] = plateRand(r);
        else {
          const c = clumps[Math.floor(r() * clumps.length)];
          const [gx, gy] = gauss(r(), r());
          x = c[0] + gx * 70;
          y = c[1] + gy * 70;
        }
      } while (x < PX0 + INSET || x > PX0 + P - INSET || y < PY0 + INSET || y > PY0 + P - INSET || nearBolt(x, y));
      out[2 * i] = x;
      out[2 * i + 1] = y;
    }
    return sortHilbert(out);
  };

  const chladniLayout = (n: number, m: number, s: number, w: number, seed: number) => {
    const r = mulberry(seed);
    const out = new Float32Array(2 * N);
    const pi = Math.PI;
    let i = 0;
    while (i < N) {
      const [x, y] = plateRand(r);
      if (nearBolt(x, y)) continue;
      if (r() < 0.028) {
        out[2 * i] = x;
        out[2 * i + 1] = y;
        i++;
        continue;
      }
      const u = (x - PX0) / P;
      const v = (y - PY0) / P;
      const cnu = Math.cos(n * pi * u);
      const cmv = Math.cos(m * pi * v);
      const cmu = Math.cos(m * pi * u);
      const cnv = Math.cos(n * pi * v);
      const f = cnu * cmv + s * cmu * cnv;
      const fx = -n * pi * Math.sin(n * pi * u) * cmv - s * m * pi * Math.sin(m * pi * u) * cnv;
      const fy = -m * pi * cnu * Math.sin(m * pi * v) - s * n * pi * cmu * Math.sin(n * pi * v);
      const d = (Math.abs(f) / (Math.hypot(fx, fy) + 1e-3)) * P; // distance to the nodal line, px
      if (r() < Math.exp(-(d / w) * (d / w))) {
        out[2 * i] = x;
        out[2 * i + 1] = y;
        i++;
      }
    }
    return sortHilbert(out);
  };

  const logoLayouts = () => {
    const r = mulberry(707);
    const L4 = new Float32Array(2 * N);
    const dust: boolean[] = [];
    const insideLogo = (): Pt => {
      for (;;) {
        const lx = r() * 1000;
        const ly = r() * 666;
        const k = POLY.findIndex((p) => inPoly(p, lx, ly));
        if (k < 0) continue;
        const e = edgeDist(POLY[k], lx, ly);
        // the sand banks up against the edges: crisp silhouette, slightly thinner fill
        const lump = 0.5 + 0.18 * Math.sin(lx * 0.031 + 1.3) * Math.sin(ly * 0.027 + 0.4) + 0.12 * Math.sin(lx * 0.083 + ly * 0.061);
        if (e > 6 && r() > lump) continue;
        return [LX0 + lx * K, LY0 + ly * K];
      }
    };
    for (let i = 0; i < N; i++) {
      let p: Pt;
      if (r() < 0.085) {
        dust.push(true);
        do {
          const [gx, gy] = gauss(r(), r());
          p = r() < 0.5 ? [CX + gx * 300 * S, CY + gy * 230 * S] : plateRand(r);
        } while (p[0] < PX0 + INSET || p[0] > PX0 + P - INSET || p[1] < PY0 + INSET || p[1] > PY0 + P - INSET);
      } else {
        dust.push(false);
        p = insideLogo();
      }
      L4[2 * i] = p[0];
      L4[2 * i + 1] = p[1];
    }
    const sorted = sortHilbert(L4);
    // which sorted ranks are dust: recompute membership by position
    const L5 = new Float32Array(sorted);
    for (let i = 0; i < N; i++) {
      const lx = (sorted[2 * i] - LX0) / K;
      const ly = (sorted[2 * i + 1] - LY0) / K;
      const inside = POLY.some((p) => inPoly(p, lx, ly));
      if (!inside && r() < 0.85) {
        // the leap gathers most of the stray sand into the mark
        const [x, y] = insideLogo();
        L5[2 * i] = x;
        L5[2 * i + 1] = y;
      }
    }
    return [sorted, L5];
  };

  type Data = {
    layouts: Float32Array[];
    delay: Float32Array;
    size: Float32Array;
    bright: Float32Array;
    curve: Float32Array;
    hop: Float32Array;
  };
  let DATA: Data | null = null;
  const data = (): Data => {
    if (DATA) return DATA;
    const [L4, L5] = logoLayouts();
    const layouts = [
      scatterLayout(),
      ...CY_PATTERNS.map((p, k) => chladniLayout(p.n, p.m, p.s, p.w, 211 + k * 97)),
      L4,
      L5,
    ];
    const r = mulberry(9001);
    const delay = new Float32Array(N);
    const size = new Float32Array(N);
    const bright = new Float32Array(N);
    const curve = new Float32Array(N);
    const hop = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      delay[i] = r();
      const q = r();
      size[i] = q < 0.55 ? 1.5 : q < 0.9 ? 2.0 : 2.7;
      bright[i] = 0.42 + 0.58 * Math.pow(r(), 0.7);
      curve[i] = (r() - 0.5) * 2;
      hop[i] = r();
    }
    DATA = { layouts, delay, size, bright, curve, hop };
    return DATA;
  };

  // ---- transitions: k-th transition moves the sand from layout k-1 to layout k ----
  const TR = [
    ...CY_PATTERNS.map((p) => ({ start: p.start, dur: p.dur, swirl: 0.12 })),
    { start: CY_LOGO.start, dur: CY_LOGO.dur, swirl: 0.32 },
    { start: CY_LEAP, dur: 11, swirl: 0 },
  ];
  const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
  const prog = (d: Data, i: number, f: number, k: number) => {
    const tr = TR[k - 1];
    const spread = k === TR.length ? 0.2 : 0.45; // the logo migration staggers more
    const x = (f - tr.start - d.delay[i] * tr.dur * spread) / (tr.dur * (1 - spread));
    return easeOut(Math.max(0, Math.min(1, x)));
  };
  // position of grain i at frame f, considering transitions up to k
  const posAt = (d: Data, i: number, f: number, k: number, out: number[]): number => {
    if (k === 0) {
      out[0] = d.layouts[0][2 * i];
      out[1] = d.layouts[0][2 * i + 1];
      return 1;
    }
    const tr = TR[k - 1];
    if (f <= tr.start) return posAt(d, i, f, k - 1, out);
    posAt(d, i, tr.start, k - 1, out);
    const ax = out[0];
    const ay = out[1];
    const bx = d.layouts[k][2 * i];
    const by = d.layouts[k][2 * i + 1];
    const p = prog(d, i, f, k);
    // a curved run, not a straight line: sand slides sideways off the antinodes
    const sw = Math.sin(Math.PI * p) * tr.swirl * d.curve[i];
    out[0] = ax + (bx - ax) * p - (by - ay) * sw;
    out[1] = ay + (by - ay) * p + (bx - ax) * sw;
    return p;
  };
  const activeK = (f: number) => {
    let k = 0;
    for (let j = 0; j < TR.length; j++) if (f > TR[j].start) k = j + 1;
    return k;
  };

  const KICK_DECAY = [1, 0.55, 0.28, 0.12, 0.05];
  const kickEnv = (f: number, list: number[]) => {
    let v = 0;
    for (const k of list) {
      const t = Math.floor(f) - k;
      if (t >= 0 && t < KICK_DECAY.length) v = Math.max(v, KICK_DECAY[t]);
    }
    return v;
  };
  const ampAt = (f: number) => CY_AMP[Math.max(0, Math.min(CY_AMP.length - 1, Math.floor(f)))];

  // the work light: upper left, raking
  const LIGHT_X = PX0 - 120;
  const LIGHT_Y = PY0 - 160;
  const lightAt = (x: number, y: number) => {
    const dd = Math.hypot(x - LIGHT_X, y - LIGHT_Y) / 1500;
    return Math.max(0.2, Math.min(1, 1.3 - dd * 1.25));
  };

  const BUCKETS = 8;
  type Grains = { x: Float32Array; y: Float32Array; s: Float32Array; b: Float32Array; h: Float32Array; tx: Float32Array; ty: Float32Array };
  const G: Grains = {
    x: new Float32Array(N),
    y: new Float32Array(N),
    s: new Float32Array(N),
    b: new Float32Array(N),
    h: new Float32Array(N),
    tx: new Float32Array(N), // motion trail vector (exit only)
    ty: new Float32Array(N),
  };

  const computeGrains = (f: number) => {
    const d = data();
    const amp = ampAt(f);
    const kick = kickEnv(f, CY_KICKS);
    const out = [0, 0];
    const out2 = [0, 0];
    const exit = f >= CY_HIT;
    const tH = f - CY_HIT;
    for (let i = 0; i < N; i++) {
      let x: number;
      let y: number;
      let h = 0;
      let s = d.size[i];
      let b = d.bright[i];
      G.tx[i] = 0;
      G.ty[i] = 0;
      if (!exit) {
        const k = activeK(f);
        const p = posAt(d, i, f, k, out);
        x = out[0];
        y = out[1];
        // the drive: grains off the nodal lines dance, settled ones barely shimmer
        const [jx, jy] = gauss(hash(i, Math.floor(f) * 7 + 1), hash(i, Math.floor(f) * 7 + 2));
        const settle = k === 0 ? 1 : 1 - p;
        const j = amp * (0.3 + 2.4 * settle) * 2.2 + kick * 1.6 * (0.4 + d.hop[i]);
        x += jx * j;
        y += jy * j;
        // the kick hops the sand off the plate a little
        h = kick * 3 * d.hop[i] + amp * settle * 2.5 * hash(i, Math.floor(f) * 7 + 3);
        // the leap: every grain goes up, scatters, and lands sharper
        const lt = f - CY_LEAP - d.hop[i] * 2.2;
        if (lt > 0 && lt < 8) {
          const arc = Math.sin((Math.PI * lt) / 8);
          h += arc * (8 + 30 * d.hop[i]);
          const [sx, sy] = gauss(hash(i, 991), hash(i, 992));
          x += sx * 11 * arc;
          y += sy * 11 * arc;
        }
      } else {
        // THE HIT: thrown at the lens. base = where the grain sat
        posAt(d, i, CY_HIT, TR.length, out);
        const r1 = hash(i, 501);
        const r2 = hash(i, 502);
        const r3 = hash(i, 503);
        const throwAt = (t: number, o: number[]) => {
          const tt = Math.max(0, t - r3 * 1.5);
          const z = (0.3 + 1.2 * r1) * (1 - Math.exp(-tt / 5)); // toward the lens
          const dx = out[0] - CX + (r2 - 0.5) * 120;
          const dy = out[1] - CY + (hash(i, 504) - 0.5) * 120;
          const dl = Math.hypot(dx, dy) + 1;
          const v = (2 + 18 * r2 * r2) * tt;
          o[0] = CX + (out[0] - CX) * (1 + z) + (dx / dl) * v;
          o[1] = CY + (out[1] - CY) * (1 + z) + (dy / dl) * v + 0.32 * tt * tt * (1 + z);
          return z;
        };
        const z = throwAt(tH, out2);
        x = out2[0];
        y = out2[1];
        const prev = [0, 0];
        throwAt(tH - 0.9, prev);
        G.tx[i] = x - prev[0];
        G.ty[i] = y - prev[1];
        s = d.size[i] * (1 + 1.3 * z);
        h = 60 * z;
        b = d.bright[i] * Math.max(0, Math.min(1, 1 - (tH - 1) / (wide ? 6 + 5 * r1 : 8 + 6 * r1)));
      }
      G.x[i] = x;
      G.y[i] = y;
      G.s[i] = s;
      G.h[i] = h;
      G.b[i] = b * (exit ? 1 : lightAt(x, y));
    }
  };

  const drawGrains = (ctx: CanvasRenderingContext2D, f: number) => {
    ctx.clearRect(0, 0, W, H);
    computeGrains(f);
    const exit = f >= CY_HIT;
    // shadows first: the light is upper left, so they fall down-right and separate as the grain lifts
    ctx.fillStyle = exit ? "rgba(0,0,0,0.32)" : "rgba(0,0,0,0.6)";
    if (wide && exit) ctx.globalAlpha = Math.max(0, 1 - (f - CY_HIT) / 7);
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (G.b[i] <= 0.01) continue;
      const h = G.h[i];
      const s = G.s[i] * (1 + h * 0.01);
      ctx.rect(G.x[i] + 1.3 + h * 0.55, G.y[i] + 1.6 + h * 0.7, s, s);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    // grains, bucketed by brightness
    for (let bk = BUCKETS - 1; bk >= 0; bk--) {
      const lvl = (bk + 0.5) / BUCKETS;
      const c = Math.round(150 + 105 * lvl);
      ctx.fillStyle = `rgb(${c},${Math.round(c * 0.985)},${Math.round(c * 0.95)})`;
      ctx.globalAlpha = Math.min(1, 0.35 + lvl);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const b = G.b[i];
        if (b <= 0.01) continue;
        if (Math.min(BUCKETS - 1, Math.floor(b * BUCKETS)) !== bk) continue;
        const s = G.s[i];
        // lifted grains sit a touch up-left of their shadow and catch more light
        const x = G.x[i] - G.h[i] * 0.15;
        const y = G.y[i] - G.h[i] * 0.2;
        ctx.rect(x, y, s, s);
        if (exit) {
          // a short motion trail: two ghosts back along the throw
          ctx.rect(x - G.tx[i] * 0.33, y - G.ty[i] * 0.33, s * 0.92, s * 0.92);
          ctx.rect(x - G.tx[i] * 0.66, y - G.ty[i] * 0.66, s * 0.8, s * 0.8);
        }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // glints: a few facets catch the work light each frame (on twos, so they live without strobing)
    if (!exit) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      const g2 = Math.floor(f / 2);
      for (let i = 0; i < N; i += 1) {
        if (hash(i, g2 * 13 + 5) < 0.9965) continue;
        if (G.b[i] < 0.62) continue;
        const s = G.s[i] * 1.5;
        ctx.rect(G.x[i] - s * 0.25, G.y[i] - s * 0.25, s, s);
      }
      ctx.fill();
    }
  };

  const SandLayer: React.FC<{ f: number }> = ({ f }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    const bloomRef = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
      const cv = ref.current;
      const bl = bloomRef.current;
      if (!cv || !bl) return;
      const ctx = cv.getContext("2d");
      const bctx = bl.getContext("2d");
      if (!ctx || !bctx) return;
      drawGrains(ctx, f);
      bctx.clearRect(0, 0, W, H);
      bctx.filter = "blur(7px)";
      bctx.drawImage(cv, 0, 0);
      bctx.filter = "none";
    }, [f]);
    return (
      <>
        <canvas ref={ref} width={W} height={H} style={{ position: "absolute", inset: 0 }} />
        <canvas ref={bloomRef} width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.7, mixBlendMode: "screen" }} />
      </>
    );
  };

  // ---- readouts ----
  const Readout: React.FC<{ x: number; y: number; align?: "left" | "right"; o: number; children: React.ReactNode }> = ({
    x,
    y,
    align = "left",
    o,
    children,
  }) => (
    <div
      style={{
        position: "absolute",
        top: y,
        ...(align === "left" ? { left: x } : { right: W - x }),
        fontFamily: FONT_MONO,
        fontWeight: 500,
        fontSize: 24,
        letterSpacing: "0.22em",
        color: "rgba(226,222,212,0.62)",
        whiteSpace: "pre",
        opacity: o,
      }}
    >
      {children}
    </div>
  );

  const ToneTrace: React.FC<{ f: number; hz: number; amp: number; x: number; y: number }> = ({ f, hz, amp, x, y }) => {
    const w = 190;
    const hh = 26;
    const cycles = hz / 30;
    let d = "";
    for (let j = 0; j <= 120; j++) {
      const u = j / 120;
      const yy = hh / 2 - Math.sin(u * cycles * 2 * Math.PI + f * 0.9) * (hh / 2) * Math.min(1, amp * 1.1);
      d += `${j ? "L" : "M"}${(u * w).toFixed(1)},${yy.toFixed(1)}`;
    }
    return (
      <svg width={w} height={hh} style={{ position: "absolute", left: x - w, top: y }}>
        <path d={d} stroke="rgba(236,232,222,0.7)" strokeWidth={2} fill="none" />
      </svg>
    );
  };


  // ---- the 16:9 overlay: a right-hand column beside the plate ----
  // readouts across its top (aligned to the plate's top edge), the title block on the plate's centre line,
  // a quiet credit on the plate's bottom edge. Title-safe: 96 px (5%) from the right edge.
  const COL = PX0 + P + 112; // 1112
  const RIGHT = W - 96; // 1824
  const WideOverlay: React.FC<{
    f: number;
    ui: number;
    hzTxt: string;
    mode: string;
    hzVal: number;
    amp: number;
    searching: boolean;
    t1: number;
    t2: number;
    ruleW: number;
    sub: string;
  }> = ({ f, ui, hzTxt, mode, hzVal, amp, searching, t1, t2, ruleW, sub }) => {
    const ty = CY - 120; // top of WATERHOUSE
    return (
      <>
        <Readout x={COL} y={PY0 + 4} o={ui}>
          {"SIG GEN  "}
          <span style={{ color: searching ? "rgba(240,236,226,0.9)" : "rgba(236,232,222,0.82)" }}>{hzTxt}</span>
        </Readout>
        <Readout x={COL} y={PY0 + 44} o={ui}>
          {mode}
        </Readout>
        <Readout x={RIGHT} y={PY0 + 4} align="right" o={ui}>
          {"120 BPM"}
        </Readout>
        {hzVal > 0 ? <ToneTrace f={f} hz={hzVal} amp={amp} x={RIGHT} y={PY0 + 46} /> : null}
        <div style={{ position: "absolute", left: COL, top: PY0 + 96, width: RIGHT - COL, height: 1, background: "rgba(226,222,212,0.14)", opacity: ui }} />

        <div
          style={{
            position: "absolute",
            left: COL - 4,
            top: ty,
            fontFamily: FONT_DISPLAY,
            fontSize: 78,
            lineHeight: 1,
            letterSpacing: "0.04em",
            color: "#ece8de",
            opacity: t1,
          }}
        >
          WATERHOUSE
        </div>
        <div
          style={{
            position: "absolute",
            left: COL,
            top: ty + 104,
            fontFamily: FONT_MONO,
            fontWeight: 800,
            fontSize: 42,
            lineHeight: 1,
            letterSpacing: "0.62em",
            color: "#a9a59b",
            opacity: t2,
          }}
        >
          SESSIONS
        </div>
        <div style={{ position: "absolute", left: COL, top: ty + 176, width: ruleW, height: 5, backgroundColor: C.yellow }} />
        <div
          style={{
            position: "absolute",
            left: COL,
            top: ty + 206,
            fontFamily: FONT_MONO,
            fontWeight: 700,
            fontSize: 28,
            lineHeight: 1,
            letterSpacing: "0.3em",
            color: "rgba(226,222,212,0.7)",
            whiteSpace: "pre",
          }}
        >
          {sub}
        </div>

        <div style={{ position: "absolute", left: COL, top: PY0 + P - 97, width: RIGHT - COL, height: 1, background: "rgba(226,222,212,0.14)", opacity: ui }} />
        <Readout x={COL} y={PY0 + P - 72} o={ui}>
          {"WATERHOUSE STUDIOS"}
        </Readout>
        <Readout x={RIGHT} y={PY0 + P - 72} align="right" o={ui}>
          {"AMS"}
        </Readout>
      </>
    );
  };

  const Main: React.FC = () => {
    const f = useCurrentFrame();
    const audio = <Audio src={staticFile("ident/audio/cymatics/bed.wav")} volume={0.9} />;
    if (f >= CY_CLEAR) return <AbsoluteFill>{audio}</AbsoluteFill>;

    const exit = f >= CY_HIT;
    // the work light comes up (one small catch on the way, well under a flash)
    const light = interpolate(f, [CY_LIGHT[0], 3, 4, CY_LIGHT[1]], [0, 0.42, 0.3, 1], { ...clamp, easing: Easing.out(Easing.quad) });
    // the room and the plate fall away after the hit
    // (the wide cut lifts the veil faster: ~8 frames instead of 15)
    const room = wide
      ? interpolate(f, [CY_HIT, CY_HIT + 2, CY_HIT + 8], [1, 0.8, 0], { ...clamp, easing: Easing.in(Easing.quad) })
      : interpolate(f, [CY_HIT, CY_HIT + 3, CY_HIT + 15], [1, 0.82, 0], { ...clamp, easing: Easing.in(Easing.quad) });
    const plateDrop = interpolate(f, [CY_HIT, CY_HIT + (wide ? 9 : 16)], [1, 0.9], { ...clamp, easing: Easing.in(Easing.cubic) });

    // camera: a slow, heavy push and a settle in rotation; kicks thump it
    const push = interpolate(f, [0, CY_HIT], [1.0, 1.055], { ...clamp, easing: heavy });
    const rot = interpolate(f, [0, CY_LOCK], [-2.6, 0], { ...clamp, easing: heavy });
    const thump = kickEnv(f, CY_KICKS) * 3 + kickEnv(f, CY_BIG) * 5 + kickEnv(f, [CY_HIT]) * 12;
    const shx = (hash(Math.floor(f), 1) - 0.5) * 2 * thump;
    const shy = (hash(Math.floor(f), 2) - 0.5) * 2 * thump;
    const hitPush = interpolate(f, [CY_HIT, CY_HIT + 2, CY_HIT + 10], [0, 0.035, 0.05], clamp);

    // readouts: the drive tone, its mode, and a live trace of it
    const pat = [...CY_PATTERNS].reverse().find((p) => f >= p.start);
    const searching = f >= CY_LOGO.start && f < CY_LOCK;
    const locked = f >= CY_LOCK;
    let hzTxt = "---.- Hz";
    let mode = "MODE  —";
    let hzVal = 0;
    if (locked) {
      hzTxt = "220.0 Hz";
      mode = "MODE  LOCK";
      hzVal = 220;
    } else if (searching) {
      const a = Math.floor(hash(Math.floor(f), 7) * 900 + 100);
      const b = Math.floor(hash(Math.floor(f), 8) * 10);
      hzTxt = `${a}.${b} Hz`;
      mode = `MODE  (${Math.floor(hash(Math.floor(f), 9) * 9 + 1)},${Math.floor(hash(Math.floor(f), 10) * 9 + 1)})`;
      hzVal = 277 + (f - CY_LOGO.start) * 1.1;
    } else if (pat) {
      hzTxt = `${pat.hz.toFixed(1).padStart(5, " ")} Hz`;
      mode = `MODE  (${pat.n},${pat.m})`;
      hzVal = pat.hz;
    }
    const amp = ampAt(f);
    const ui = f >= 6 ? (f < 8 ? 0.5 : 1) : 0;

    // title
    const t1 = f >= CY_LOCK ? (f < CY_LOCK + 1 ? 0.55 : 1) : 0;
    const t2 = f >= CY_LOCK + 3 ? (f < CY_LOCK + 4 ? 0.55 : 1) : 0;
    const ruleW = interpolate(f, [CY_LOCK + 7, CY_LOCK + 13], [0, 120], { ...clamp, easing: Easing.out(Easing.cubic) });
    const SUBTXT = "WITH DENZO · TUESDAY";
    const subChars = Math.floor(interpolate(f, [CY_LOCK + 11, CY_LOCK + 23], [0, SUBTXT.length], clamp));
    const leapBlur = interpolate(f, [CY_LEAP, CY_LEAP + 2, CY_LEAP + 8], [0, 1, 0], clamp);

    return (
      <AbsoluteFill>
        {audio}
        {/* the room */}
        <AbsoluteFill style={{ opacity: room }}>
          <AbsoluteFill style={{ backgroundColor: "#040404" }} />
          <AbsoluteFill
            style={{
              opacity: light,
              background: wide
                ? "radial-gradient(ellipse 62% 95% at 9% 8%, #1d1c1a 0%, #0b0b0a 50%, #040404 100%)"
                : "radial-gradient(ellipse 95% 60% at 18% 12%, #1d1c1a 0%, #0b0b0a 48%, #040404 100%)",
            }}
          />
        </AbsoluteFill>

        {/* camera */}
        <AbsoluteFill
          style={{
            transform: `translate(${shx}px, ${shy}px) scale(${push + hitPush}) rotate(${rot}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
          }}
        >
          {/* the plate */}
          <div
            style={{
              position: "absolute",
              left: PX0,
              top: PY0,
              width: P,
              height: P,
              opacity: room * light,
              transform: `scale(${plateDrop})`,
              background: "radial-gradient(ellipse 120% 110% at 8% 4%, #1b1b1a 0%, #111110 38%, #0a0a0a 70%, #070707 100%)",
              boxShadow:
                "inset 1.5px 1.5px 0 rgba(255,255,255,0.10), inset -1.5px -1.5px 0 rgba(0,0,0,0.9), 0 30px 80px rgba(0,0,0,0.85), 0 6px 18px rgba(0,0,0,0.9)",
            }}
          >
            {/* the drive bolt */}
            <div
              style={{
                position: "absolute",
                left: P / 2 - 15,
                top: P / 2 - 15,
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "radial-gradient(circle at 35% 30%, #3a3936 0%, #161615 45%, #050505 100%)",
                boxShadow: "0 0 0 2px #0a0a0a, 3px 4px 8px rgba(0,0,0,0.9)",
              }}
            />
          </div>
          <AbsoluteFill style={{ opacity: exit ? 1 : light, filter: leapBlur > 0 ? `blur(${leapBlur * 1.6}px)` : undefined }}>
            <SandLayer f={f} />
          </AbsoluteFill>
        </AbsoluteFill>

        {!exit && wide ? (
          <WideOverlay
            f={f}
            ui={ui}
            hzTxt={hzTxt}
            mode={mode}
            hzVal={hzVal}
            amp={amp}
            searching={searching}
            t1={t1}
            t2={t2}
            ruleW={ruleW}
            sub={SUBTXT.slice(0, subChars).padEnd(SUBTXT.length, " ")}
          />
        ) : null}
        {!exit && !wide ? (
          <>
            {/* readouts */}
            <Readout x={60} y={96} o={ui}>
              {"SIG GEN  "}
              <span style={{ color: searching ? "rgba(240,236,226,0.9)" : "rgba(236,232,222,0.82)" }}>{hzTxt}</span>
            </Readout>
            <Readout x={950} y={96} align="right" o={ui}>
              {"120 BPM"}
            </Readout>
            <Readout x={60} y={136} o={ui}>
              {mode}
            </Readout>
            {hzVal > 0 ? <ToneTrace f={f} hz={hzVal} amp={amp} x={950} y={138} /> : null}

            {/* title */}
            <div
              style={{
                position: "absolute",
                top: 1262,
                width: W,
                textAlign: "center",
                fontFamily: FONT_DISPLAY,
                fontSize: 82,
                letterSpacing: "0.04em",
                color: "#ece8de",
                opacity: t1,
              }}
            >
              WATERHOUSE
            </div>
            <div
              style={{
                position: "absolute",
                top: 1366,
                width: W,
                paddingLeft: "0.62em",
                boxSizing: "border-box",
                textAlign: "center",
                fontFamily: FONT_MONO,
                fontWeight: 800,
                fontSize: 38,
                letterSpacing: "0.62em",
                color: "#a9a59b",
                opacity: t2,
              }}
            >
              SESSIONS
            </div>
            <div style={{ position: "absolute", left: CX - 60, top: 1428, width: ruleW, height: 5, backgroundColor: C.yellow }} />
            <div
              style={{
                position: "absolute",
                top: 1448,
                width: W,
                textAlign: "center",
                fontFamily: FONT_MONO,
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: "0.3em",
                color: "rgba(226,222,212,0.7)",
                whiteSpace: "pre",
              }}
            >
              {SUBTXT.slice(0, subChars).padEnd(SUBTXT.length, " ")}
            </div>
          </>
        ) : null}

        {/* grain and vignette over the room (fade with it so the content stays clean) */}
        <AbsoluteFill style={{ opacity: room * light }}>
          <Grain opacity={0.08} blend="screen" />
          <AbsoluteFill
            style={{
              background: wide
                ? "radial-gradient(ellipse 85% 105% at 40% 46%, transparent 50%, rgba(0,0,0,0.6) 100%)"
                : "radial-gradient(ellipse 110% 80% at 45% 40%, transparent 50%, rgba(0,0,0,0.6) 100%)",
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  };

  return Main;
};

export const Cymatics: React.FC = build(PORTRAIT);
/** 16:9 cut: same timeline and audio, plate left, title and readouts in the right column. */
export const CymaticsWide: React.FC = build(LANDSCAPE);
