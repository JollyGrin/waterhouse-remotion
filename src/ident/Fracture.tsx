import React from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LogoPiece, W, rand } from "./brand";

/**
 * FRACTURE: the mark carved out of a block.
 * A slab of board-formed concrete under one hard work light. Chisel hits on a 120 bpm grid
 * crack it along planes that extend the mark's own edges (the roof line, the slat lines,
 * the door), then angular chunks break away with weight, outside in, until only the mark
 * stands, cut from the slab with its thickness showing. The title sets under it. Exit: the
 * mark breaks loose and drops, and the wall behind it shatters along the same planes,
 * falling past the lens to the content.
 *
 * Grid: 120 bpm, beat = 15 f.
 */
export const FRACTURE_FRAMES = 142;

// ---- timeline (frames) ----
const LIGHT_ON = 3;
const HITS: { f: number; p: Pt }[] = [
  { f: 15, p: [-60, -180] }, // 1: first strike, top left: cracks only
  { f: 30, p: [1090, 60] }, // 2: right: the outer chunks go
  { f: 45, p: [140, 880] }, // 3: bottom: the middle band goes
  { f: 60, p: [540, 340] }, // 4: centre: the last pieces between the slats and the door go
];
const LABELS = 68;
const WORD1 = 76;
const WORD2 = 81;
const RULE = 87;
const HOST = 89;
const TENSION = 101; // hairlines start running across the wall
const LOGO_BREAK = 105; // the mark breaks loose
const PLATE_BREAK = 112; // the wall goes
const CLEAR = 132; // fully transparent from here

// ---- layout (logo units -> screen) ----
const S = 0.82;
const MX0 = 130;
const MY0 = 360;
const BX0 = -110;
const BX1 = 1110;
const BY0 = -260;
const BY1 = 900;
const sx = (x: number) => MX0 + x * S;
const sy = (y: number) => MY0 + y * S;
const BLOCK = { x: sx(BX0), y: sy(BY0), w: (BX1 - BX0) * S, h: (BY1 - BY0) * S };
const DEPTH: Pt = [16, 22]; // slab thickness, oblique, screen px
const SHADOW_OFF: Pt = [46, 62];
const CAM_O: Pt = [540, BLOCK.y + BLOCK.h / 2];
const PERSPECTIVE = 1800;
const TEX = staticFile("ident/fracture/concrete.png");

const K = {
  wall: "#0f0f0e",
  band: "#24221f",
  bandPen: "#1a1917",
  groove: "#050505",
  lip: "rgba(226,220,206,0.55)",
  grey: "#8a8a86",
  tick: "#3a3a3a",
  paper: C.paper,
  accent: C.yellow,
};

type Pt = [number, number];
type Poly = Pt[];
type V3 = [number, number, number];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
const deg = Math.PI / 180;

// Straight-edged outlines of the four pieces (viewBox units).
const POLY: Record<LogoPiece, Poly> = {
  house: [
    [347.9, 2.5],
    [347.9, 665.5],
    [0, 665.5],
    [0, 282.6],
  ],
  slatA: [
    [379.63, 48.67],
    [685.18, 149.0],
    [685.18, 287.52],
    [379.63, 204.41],
  ],
  slatB: [
    [722.22, 160.98],
    [1000, 252.33],
    [1000, 372.88],
    [722.22, 297.63],
  ],
  door: [
    [596.56, 397.96],
    [775.13, 438.77],
    [775.13, 665.87],
    [596.56, 665.87],
  ],
};

// ---------------------------------------------------------------------------
// geometry
const centroid = (p: Poly): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const areaOf = (p: Poly) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    const r = p[(i + 1) % p.length];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return Math.abs(a) / 2;
};
/** Split a convex polygon by the line through `a` with direction `u`: [left, right]. */
const split = (p: Poly, a: Pt, u: Pt): [Poly, Poly] => {
  const side = (q: Pt) => u[0] * (q[1] - a[1]) - u[1] * (q[0] - a[0]);
  const L: Poly = [];
  const R: Poly = [];
  for (let i = 0; i < p.length; i++) {
    const P = p[i];
    const Q = p[(i + 1) % p.length];
    const sp = side(P);
    const sq = side(Q);
    if (sp >= 0) L.push(P);
    if (sp <= 0) R.push(P);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq);
      const X: Pt = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
      L.push(X);
      R.push(X);
    }
  }
  return [L, R];
};
const ok = (p: Poly, min = 1) => p.length >= 3 && areaOf(p) > min;
/** Convex Q minus convex P = convex pieces outside P. */
const subtract = (q: Poly, P: Poly): Poly[] => {
  const out: Poly[] = [];
  const c = centroid(P);
  let rest = q;
  for (let i = 0; i < P.length && ok(rest); i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const u: Pt = [b[0] - a[0], b[1] - a[1]];
    const [l, r] = split(rest, a, u);
    const cInLeft = u[0] * (c[1] - a[1]) - u[1] * (c[0] - a[0]) > 0;
    const [inside, outside] = cInLeft ? [l, r] : [r, l];
    if (ok(outside)) out.push(outside);
    rest = inside;
  }
  return out;
};
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
};
const boundaryDist = (p: Pt, poly: Poly) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
};
const logoDist = (p: Pt) => Math.min(...LOGO_ORDER.map((k) => boundaryDist(p, POLY[k])));
const outwardNormals = (p: Poly) => {
  const c = centroid(p);
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let n: Pt = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (n[0] * (m[0] - c[0]) + n[1] * (m[1] - c[1]) < 0) n = [-n[0], -n[1]];
    return n;
  });
};

/** Partition a rect: global design cuts, then seeded irregular cuts until each cell is small enough. */
const shatter = (rect: Poly, lines: [Pt, Pt][], amax: (c: Poly) => number, seed: number): Poly[] => {
  let cells: Poly[] = [rect];
  for (const [a, b] of lines) {
    cells = cells.flatMap((c) => split(c, a, [b[0] - a[0], b[1] - a[1]]).filter((p) => ok(p)));
  }
  const out: Poly[] = [];
  let k = seed;
  const R = () => rand(k++ * 1.731 + 0.37);
  const queue = [...cells];
  while (queue.length) {
    const c = queue.shift()!;
    if (areaOf(c) <= amax(c) || out.length + queue.length > 400) {
      out.push(c);
      continue;
    }
    const [cx, cy] = centroid(c);
    const xs = c.map((q) => q[0]);
    const ys = c.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    // cut across the long axis, at an irregular angle
    const base = w > h ? Math.PI / 2 : 0;
    const ang = base + (R() - 0.5) * 1.5;
    const a: Pt = [cx + (R() - 0.5) * w * 0.3, cy + (R() - 0.5) * h * 0.3];
    const [l, r] = split(c, a, [Math.cos(ang), Math.sin(ang)]);
    if (ok(l) && ok(r)) queue.push(l, r);
    else out.push(c);
  }
  return out;
};

const line = (a: Pt, b: Pt): [Pt, Pt] => [a, b];
// cuts that extend the mark's own edges across the slab
const DESIGN_CUTS: [Pt, Pt][] = [
  line([347.9, 2.5], [0, 282.6]), // roof
  line([379.63, 48.67], [1000, 252.33]), // slat tops (collinear)
  line([379.63, 204.41], [1000, 372.88]), // slat bottoms (collinear)
  line([596.56, 397.96], [775.13, 438.77]), // door top
  line([347.9, 0], [347.9, 1]), // house right
  line([775.13, 0], [775.13, 1]), // door right
  line([0, 665.5], [1, 665.5]), // base
];

type Shard = {
  poly: Poly; // logo units
  c: Pt;
  area: number;
  wave: number; // index into HITS of the hit that releases it
  release: number;
  crackAt: number;
  edges: { a: Pt; b: Pt }[]; // crack edges (not on the block boundary or the mark)
  v: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
};

const onBlockEdge = (a: Pt, b: Pt) => {
  const e = 0.5;
  return (
    (Math.abs(a[0] - BX0) < e && Math.abs(b[0] - BX0) < e) ||
    (Math.abs(a[0] - BX1) < e && Math.abs(b[0] - BX1) < e) ||
    (Math.abs(a[1] - BY0) < e && Math.abs(b[1] - BY0) < e) ||
    (Math.abs(a[1] - BY1) < e && Math.abs(b[1] - BY1) < e)
  );
};

const SHARDS: Shard[] = (() => {
  const rect: Poly = [
    [BX0, BY0],
    [BX1, BY0],
    [BX1, BY1],
    [BX0, BY1],
  ];
  const cells = shatter(
    rect,
    DESIGN_CUTS,
    (c) => {
      const d = logoDist(centroid(c));
      return d < 70 ? 13000 : d < 170 ? 30000 : 62000;
    },
    5,
  );
  let pieces: Poly[] = cells;
  for (const k of LOGO_ORDER) pieces = pieces.flatMap((p) => subtract(p, POLY[k]));
  pieces = pieces.filter((p) => ok(p, 300));
  return pieces.map((poly, i) => {
    const c = centroid(poly);
    const d = logoDist(c);
    const wave = d > 150 ? 1 : d > 58 ? 2 : 3;
    const hp = HITS[wave].p;
    const delay = Math.min(9, (Math.hypot(c[0] - hp[0], c[1] - hp[1]) / 1300) * 9) + rand(i * 7.3) * 2;
    const release = HITS[wave].f + delay;
    const crackAt = HITS[wave - 1].f + delay * 0.45;
    const edges: { a: Pt; b: Pt }[] = [];
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j];
      const b = poly[(j + 1) % poly.length];
      if (onBlockEdge(a, b)) continue;
      if (logoDist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) < 0.8) continue;
      // draw from the end nearer the strike that cracks it
      const ch = HITS[wave - 1].p;
      const near = Math.hypot(a[0] - ch[0], a[1] - ch[1]) <= Math.hypot(b[0] - ch[0], b[1] - ch[1]);
      edges.push(near ? { a, b } : { a: b, b: a });
    }
    // away from the strike, a little toward camera, tipping forward as it drops
    const away = Math.sign(c[0] - hp[0]) || 1;
    const r = (s: number) => rand(i * 13.1 + s);
    return {
      poly,
      c,
      area: areaOf(poly),
      wave,
      release,
      crackAt,
      edges,
      v: {
        x: away * (20 + 60 * r(1)),
        y: 10 + 40 * r(2),
        z: -20 + 80 * r(3),
        rx: -(12 + 40 * r(4)),
        ry: (r(5) - 0.5) * 50,
        rz: away * (8 + 30 * r(6)),
      },
    };
  });
})();

// The wall behind: shattered along the same planes, in screen px.
type PlateShard = { poly: Poly; c: Pt; release: number; v: Shard["v"]; edges: { a: Pt; b: Pt; at: number }[] };
const PLATE_O: Pt = [540, 600];
const toS = (p: Pt): Pt => [sx(p[0]), sy(p[1])];
const PLATE: PlateShard[] = (() => {
  const m = 30;
  const rect: Poly = [
    [-m, -m],
    [W + m, -m],
    [W + m, H + m],
    [-m, H + m],
  ];
  const cuts = [DESIGN_CUTS[0], DESIGN_CUTS[1], DESIGN_CUTS[2], DESIGN_CUTS[4]].map(([a, b]) => [toS(a), toS(b)] as [Pt, Pt]);
  const cells = shatter(rect, cuts, () => 135000, 41).filter((p) => ok(p, 400));
  return cells.map((poly, i) => {
    const c = centroid(poly);
    const d = Math.hypot(c[0] - PLATE_O[0], c[1] - PLATE_O[1]);
    const r = (s: number) => rand(i * 29.7 + s);
    const away = Math.sign(c[0] - PLATE_O[0]) || 1;
    const edges: { a: Pt; b: Pt; at: number }[] = [];
    for (let j = 0; j < poly.length; j++) {
      let a = poly[j];
      let b = poly[(j + 1) % poly.length];
      const da = Math.hypot(a[0] - PLATE_O[0], a[1] - PLATE_O[1]);
      const db = Math.hypot(b[0] - PLATE_O[0], b[1] - PLATE_O[1]);
      if (db < da) [a, b] = [b, a];
      edges.push({ a, b, at: TENSION + (Math.min(da, db) / 1300) * 9 });
    }
    return {
      poly,
      c,
      release: PLATE_BREAK + Math.min(6, (d / 1200) * 6) + r(1) * 1.5,
      edges,
      v: {
        x: away * (80 + 260 * r(2)) * (Math.abs(c[0] - PLATE_O[0]) / 540),
        y: 200 + 250 * r(3),
        z: 500 + 700 * r(4),
        rx: -(70 + 110 * r(5)),
        ry: (r(6) - 0.5) * 70,
        rz: away * (10 + 50 * r(7)),
      },
    };
  });
})();

// ---------------------------------------------------------------------------
// shading
const rot = (v: V3, rx: number, ry: number, rz: number): V3 => {
  let [x, y, z] = v;
  const cz = Math.cos(rz * deg);
  const sz = Math.sin(rz * deg);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cy = Math.cos(ry * deg);
  const sy2 = Math.sin(ry * deg);
  [x, z] = [x * cy + z * sy2, -x * sy2 + z * cy];
  const cx = Math.cos(rx * deg);
  const sx2 = Math.sin(rx * deg);
  [y, z] = [y * cx - z * sx2, y * sx2 + z * cx];
  return [x, y, z];
};
const LIGHT: V3 = (() => {
  const v: V3 = [-0.62, -0.42, 0.66];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
/** brightness of a face after rotation, 1 = as lit at rest */
const faceLight = (rx: number, ry: number, rz: number) => {
  let n = rot([0, 0, 1], rx, ry, rz);
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  return Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / LIGHT[2];
};
const sideFill = (n: Pt) => {
  const v = Math.round(22 + 22 * Math.max(0, n[0]) + 4 * Math.max(0, n[1]));
  return `rgb(${v},${v - 1},${v - 3})`;
};

type Motion = { dx: number; dy: number; dz: number; rx: number; ry: number; rz: number };
const REST: Motion = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 };
/** weighty fall: a short loosening creep, then gravity. */
const fall = (frame: number, release: number, v: Shard["v"], g: number, creep = 5): Motion | null => {
  const tt = frame - release;
  if (tt < -creep) return null;
  if (tt < 0) {
    const k = (tt + creep) / creep;
    return { dx: 0, dy: 2.5 * k * k, dz: 0, rx: 0, ry: 0, rz: Math.sign(v.rz) * 0.5 * k };
  }
  const t = tt / 30;
  return {
    dx: v.x * t,
    dy: 2.5 + v.y * t + 0.5 * g * t * t,
    dz: v.z * t,
    rx: v.rx * t,
    ry: v.ry * t,
    rz: Math.sign(v.rz) * 0.5 + v.rz * t,
  };
};

// ---------------------------------------------------------------------------
// pieces

const bboxOf = (p: Poly) => {
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** A slab piece (shard or mark piece): oblique thickness + textured face, at its rest place, optionally moving in 3D. */
const Slab: React.FC<{
  poly: Poly; // logo units
  m: Motion | null;
  dark?: number; // 0..1 extra darkness (falling out of the light)
  part?: "both" | "sides" | "face";
  rim?: boolean; // lit lip on edges facing the light
}> = ({ poly, m, dark = 0, part = "both", rim = false }) => {
  const sp = poly.map(toS);
  const bb = bboxOf(sp);
  const pad = 4;
  const X = bb.x - pad;
  const Y = bb.y - pad;
  const bw = bb.w + DEPTH[0] + pad * 2;
  const bh = bb.h + DEPTH[1] + pad * 2;
  const loc = sp.map(([x, y]) => [x - X, y - Y] as Pt);
  const ns = outwardNormals(loc);
  const c = centroid(loc);
  const lit = m ? faceLight(m.rx, m.ry, m.rz) : 1;
  const shade = Math.min(0.94, Math.max(0, 1 - Math.min(1, lit) * (1 - dark)));
  const transform = m
    ? `translate3d(${m.dx}px, ${m.dy}px, ${m.dz}px) rotateX(${m.rx}deg) rotateY(${m.ry}deg) rotateZ(${m.rz}deg)`
    : undefined;
  const dn = Math.hypot(DEPTH[0], DEPTH[1]);
  return (
    <div
      style={{
        position: "absolute",
        left: X,
        top: Y,
        width: bw,
        height: bh,
        transformOrigin: `${c[0]}px ${c[1]}px`,
        transform,
      }}
    >
      {part !== "face" && (
        <svg width={bw} height={bh} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {loc.map((a, i) => {
            const n = ns[i];
            if (n[0] * DEPTH[0] + n[1] * DEPTH[1] <= 0.05 * dn) return null;
            const b = loc[(i + 1) % loc.length];
            const pts = [a, b, [b[0] + DEPTH[0], b[1] + DEPTH[1]], [a[0] + DEPTH[0], a[1] + DEPTH[1]]];
            return (
              <polygon
                key={i}
                points={pts.map((q) => q.join(",")).join(" ")}
                fill={sideFill(n)}
                stroke={sideFill(n)}
                strokeWidth={0.8}
                opacity={1 - shade * 0.6}
              />
            );
          })}
        </svg>
      )}
      {part !== "sides" && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: bw,
            height: bh,
            clipPath: `polygon(${loc.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(", ")})`,
          }}
        >
          <Img
            src={TEX}
            style={{ position: "absolute", left: BLOCK.x - X, top: BLOCK.y - Y, width: BLOCK.w, height: BLOCK.h, maxWidth: "none" }}
          />
          {shade > 0.004 && <div style={{ position: "absolute", inset: 0, backgroundColor: `rgba(0,0,0,${shade})` }} />}
          {rim && (
            <svg width={bw} height={bh} style={{ position: "absolute", left: 0, top: 0 }}>
              {loc.map((a, i) => {
                const n = ns[i];
                const f = -(n[0] * 0.8 + n[1] * 0.6);
                if (f < 0.25) return null;
                const b = loc[(i + 1) % loc.length];
                return (
                  <line
                    key={i}
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke={`rgba(232,226,212,${(0.25 + 0.45 * f) * (1 - shade)})`}
                    strokeWidth={3.5}
                  />
                );
              })}
            </svg>
          )}
        </div>
      )}
    </div>
  );
};

// ---- film texture (as Monolith) ----
const FilmGrain: React.FC<{ frame: number }> = ({ frame }) => {
  const seed = frame % 24;
  return (
    <>
      <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.16, pointerEvents: "none" }}>
        <svg width="100%" height="100%">
          <filter id={`frg-${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves={2} seed={seed} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="linear" slope="1.9" intercept="-0.55" />
              <feFuncG type="linear" slope="1.9" intercept="-0.55" />
              <feFuncB type="linear" slope="1.9" intercept="-0.55" />
            </feComponentTransfer>
          </filter>
          <rect width="100%" height="100%" filter={`url(#frg-${seed})`} />
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{ mixBlendMode: "multiply", opacity: 0.35, pointerEvents: "none" }}>
        <svg width="100%" height="100%">
          <filter id={`frd-${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves={1} seed={seed + 40} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#frd-${seed})`} />
        </svg>
      </AbsoluteFill>
    </>
  );
};

const typed = (text: string, frame: number, at: number, cps = 1.5) =>
  text.slice(0, Math.max(0, Math.min(text.length, Math.floor((frame - at) * cps))));

// debris chips and dust, seeded per shard
type Chip = { at: number; p: Pt; v: Pt; s: number; spin: number; tone: number };
const CHIPS: Chip[] = SHARDS.flatMap((s, i) => {
  const n = s.area > 6000 ? 4 : 2;
  return Array.from({ length: n }, (_, j) => {
    const r = (k: number) => rand(i * 31.7 + j * 5.3 + k);
    const e = s.poly[Math.floor(r(1) * s.poly.length)];
    const p: Pt = [e[0] * 0.7 + s.c[0] * 0.3, e[1] * 0.7 + s.c[1] * 0.3];
    return {
      at: s.release - 1 + r(2) * 3,
      p: toS(p),
      v: [(r(3) - 0.5) * 380, -60 - 160 * r(4)] as Pt,
      s: 3 + 9 * r(5) * r(5),
      spin: (r(6) - 0.5) * 900,
      tone: 120 + 70 * r(7),
    };
  });
});
// a few chips on the first strike too (nothing falls yet)
const STRIKE_CHIPS: Chip[] = HITS.flatMap((h, hi) =>
  Array.from({ length: 10 }, (_, j) => {
    const r = (k: number) => rand(hi * 91.1 + j * 3.7 + k);
    const p: Pt = [Math.max(BX0 + 10, Math.min(BX1 - 10, h.p[0])), Math.max(BY0 + 10, Math.min(BY1 - 10, h.p[1]))];
    return {
      at: h.f + r(1),
      p: toS(p),
      v: [(r(2) - 0.5) * 700, -120 - 300 * r(3)] as Pt,
      s: 2 + 6 * r(4),
      spin: (r(5) - 0.5) * 1200,
      tone: 130 + 70 * r(6),
    };
  }),
);
// dust motes hanging in the light after the carve
const MOTES = Array.from({ length: 46 }, (_, i) => ({
  x: 60 + rand(i * 3.3) * 760,
  y: 140 + rand(i * 5.9) * 1100,
  s: 1.5 + rand(i * 8.1) * 2.5,
  vx: 6 + rand(i * 2.2) * 14,
  vy: -4 + rand(i * 4.4) * 14,
  a: 0.15 + rand(i * 6.6) * 0.35,
}));

// ---------------------------------------------------------------------------

export const Fracture: React.FC = () => {
  const frame = useCurrentFrame();
  const plateBroken = frame >= PLATE_BREAK - 0.001;
  const clear = frame >= CLEAR;

  // ---- light ----
  // the work light swings onto the slab: a hard diagonal edge raking left to right
  const dim = frame < LIGHT_ON ? 1 : 0.9;
  const sweepX = interpolate(frame, [LIGHT_ON, LIGHT_ON + 13], [-500, 1700], { ...clamp, easing: Easing.bezier(0.3, 0, 0.25, 1) });
  const sweepOn = frame < LIGHT_ON + 14;
  const sweepClip = (g: number) =>
    `polygon(${sweepX + g}px -60px, 1200px -60px, 1200px 1990px, ${sweepX + g - 700}px 1990px)`;

  // ---- camera: slow pull back while it's struck, then a slow push ----
  const cam =
    frame < 70
      ? interpolate(frame, [0, 70], [1.14, 1.0], { ...clamp, easing: easeIO })
      : interpolate(frame, [70, PLATE_BREAK], [1.0, 1.035], clamp);
  let shY = 0;
  let shX = 0;
  [...HITS.map((h, i) => ({ f: h.f, a: [3, 4, 5, 8][i] })), { f: LOGO_BREAK, a: 7 }, { f: PLATE_BREAK, a: 10 }].forEach(({ f, a }) => {
    const t = frame - f;
    if (t >= 0 && t < 12) {
      const amp = a * Math.exp(-t / 2.6);
      shY += amp * Math.sin(t * 2.1);
      shX += amp * 0.35 * Math.sin(t * 1.3 + 1);
    }
  });
  const gw = Math.floor(frame / 2);
  const weaveX = (rand(gw * 3.1) - 0.5) * 2.0;
  const weaveY = (rand(gw * 7.7 + 2) - 0.5) * 1.5;
  const camT = `translate(${weaveX + shX}px, ${weaveY + shY}px) scale(${cam})`;
  const camO = `${CAM_O[0]}px ${CAM_O[1]}px`;

  // ---- states ----
  const shardMotion = SHARDS.map((s) => fall(frame, s.release, s.v, 4300));
  const logoRelease: Record<LogoPiece, number> = {
    door: LOGO_BREAK,
    slatB: LOGO_BREAK + 1.5,
    slatA: LOGO_BREAK + 2.5,
    house: LOGO_BREAK + 3.5,
  };
  const logoV: Record<LogoPiece, Shard["v"]> = {
    house: { x: -60, y: 260, z: 260, rx: -55, ry: -14, rz: -16 },
    slatA: { x: -20, y: 300, z: 340, rx: -80, ry: 20, rz: 10 },
    slatB: { x: 40, y: 320, z: 300, rx: -70, ry: 26, rz: 22 },
    door: { x: 20, y: 340, z: 380, rx: -90, ry: -10, rz: 8 },
  };
  const logoMotion = (k: LogoPiece) => fall(frame, logoRelease[k], logoV[k], 6200, 3);

  // ---- type ----
  const w1 = interpolate(frame, [WORD1, WORD1 + 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const w2 = interpolate(frame, [WORD2, WORD2 + 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const ruleW = interpolate(frame, [RULE, RULE + 9], [0, 120], { ...clamp, easing: Easing.out(Easing.cubic) });
  const label: React.CSSProperties = {
    position: "absolute",
    fontFamily: FONT_MONO,
    fontWeight: 500,
    fontSize: 24,
    letterSpacing: "0.22em",
    color: K.grey,
    whiteSpace: "pre",
  };

  // ---- the wall, the shadow, the type: everything that shatters at the exit ----
  const shadowPolys: Poly[] = [
    ...SHARDS.filter((_, i) => !shardMotion[i] || frame < SHARDS[i].release).map((s) => s.poly),
    ...LOGO_ORDER.filter((k) => frame < logoRelease[k]).map((k) => POLY[k]),
  ];
  const plateContent = (
    <>
      <AbsoluteFill style={{ backgroundColor: K.wall }} />
      {/* the work light's hard spill on the wall */}
      <AbsoluteFill style={{ backgroundColor: K.bandPen, clipPath: "polygon(-60px -60px, 1130px -60px, 520px 1990px, -60px 1990px)" }} />
      <AbsoluteFill style={{ backgroundColor: K.band, clipPath: "polygon(-60px -60px, 1060px -60px, 470px 1990px, -60px 1990px)" }} />
      {/* the slab's cast shadow */}
      <AbsoluteFill style={{ transform: camT, transformOrigin: camO }}>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          <g opacity={0.78} transform={`translate(${SHADOW_OFF[0]} ${SHADOW_OFF[1]})`}>
            {shadowPolys.map((p, i) => (
              <polygon key={i} points={p.map((q) => toS(q).join(",")).join(" ")} fill="#000" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        </svg>
      </AbsoluteFill>
      {/* title */}
      <div style={{ position: "absolute", left: 0, width: W, top: 1196, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 58,
            lineHeight: 1,
            letterSpacing: "0.16em",
            paddingLeft: "0.16em",
            color: K.paper,
            textShadow: "0 0 10px rgba(250,246,246,0.14)",
            clipPath: `inset(-20px ${(1 - w1) * 100}% -20px 0)`,
          }}
        >
          WATERHOUSE
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: FONT_DISPLAY,
            fontSize: 58,
            lineHeight: 1,
            letterSpacing: "0.16em",
            paddingLeft: "0.16em",
            color: K.grey,
            clipPath: `inset(-20px ${(1 - w2) * 100}% -20px 0)`,
          }}
        >
          SESSIONS
        </div>
        <div style={{ marginTop: 32, height: 4, width: ruleW, backgroundColor: K.accent }} />
        <div style={{ ...label, position: "relative", marginTop: 24, fontSize: 28, color: K.paper, opacity: 0.86, minHeight: 34 }}>
          {typed("WITH DENZO — TUESDAY", frame, HOST, 2)}
        </div>
      </div>
      {/* slate annotations */}
      <div style={{ ...label, left: 64, top: 84 }}>{typed("WATERHOUSE STUDIOS", frame, LABELS)}</div>
      <div style={{ ...label, right: W - 950, top: 84, textAlign: "right" }}>{typed("AMSTERDAM", frame, LABELS + 4)}</div>
      <div style={{ ...label, left: 64, top: 1452 }}>{typed("SESSIONS / EP.—", frame, LABELS + 8)}</div>
      <div style={{ ...label, right: W - 950, top: 1452, textAlign: "right" }}>{typed("C30/37 · CAST IN SITU", frame, LABELS + 12)}</div>
      {frame >= LABELS &&
        [
          [64, 56, 1, 1],
          [950, 56, -1, 1],
          [64, 1500, 1, -1],
          [950, 1500, -1, -1],
        ].map(([x, y, kx, ky], i) => (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: 0, height: 0 }}>
            <div style={{ position: "absolute", left: kx > 0 ? 0 : -22, top: 0, width: 22, height: 2, backgroundColor: K.tick }} />
            <div style={{ position: "absolute", left: 0, top: ky > 0 ? 0 : -22, width: 2, height: 22, backgroundColor: K.tick }} />
          </div>
        ))}
      {/* hairlines running out across the wall before it goes */}
      {frame >= TENSION && (
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          {PLATE.flatMap((p, i) =>
            p.edges.map((e, j) => {
              const k = interpolate(frame, [e.at, e.at + 4], [0, 1], clamp);
              if (k <= 0) return null;
              const x2 = e.a[0] + (e.b[0] - e.a[0]) * k;
              const y2 = e.a[1] + (e.b[1] - e.a[1]) * k;
              return (
                <g key={`${i}-${j}`}>
                  <line x1={e.a[0]} y1={e.a[1]} x2={x2} y2={y2} stroke="#000" strokeWidth={4} />
                  <line x1={e.a[0] + 1.5} y1={e.a[1] + 1.5} x2={x2 + 1.5} y2={y2 + 1.5} stroke="rgba(200,194,182,0.5)" strokeWidth={1.5} />
                </g>
              );
            }),
          )}
        </svg>
      )}
    </>
  );

  const vignette = (
    <AbsoluteFill
      style={{ background: "radial-gradient(ellipse 78% 62% at 45% 38%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.62) 100%)", pointerEvents: "none" }}
    />
  );

  // ---- cracks (on the intact slab) ----
  const crackLines: React.ReactNode[] = [];
  const pushCrack = (key: string, a: Pt, b: Pt, k: number, wGroove: number) => {
    const A = toS(a);
    const B0 = toS(b);
    const B: Pt = [A[0] + (B0[0] - A[0]) * k, A[1] + (B0[1] - A[1]) * k];
    crackLines.push(
      <g key={key}>
        <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={K.groove} strokeWidth={wGroove} strokeLinecap="round" />
        <line x1={A[0] + 1.6} y1={A[1] + 1.8} x2={B[0] + 1.6} y2={B[1] + 1.8} stroke={K.lip} strokeWidth={wGroove > 4 ? 2.2 : 1.4} strokeLinecap="round" />
      </g>,
    );
  };
  SHARDS.forEach((s, i) => {
    if (shardMotion[i]) return;
    s.edges.forEach((e, j) => {
      const k = interpolate(frame, [s.crackAt, s.crackAt + 5], [0, 1], clamp);
      if (k > 0) pushCrack(`s${i}-${j}`, e.a, e.b, k, 2.6);
    });
  });
  // the mark's own outline, cut as a groove first: house on the first strike, slats on the second, door after
  const grooveAt: Record<LogoPiece, number> = { house: HITS[0].f, slatA: HITS[1].f - 1, slatB: HITS[1].f + 1, door: HITS[1].f + 4 };
  const grooveOff = HITS[3].f + 12;
  const GROOVE_W = 5;
  if (frame < grooveOff)
    LOGO_ORDER.forEach((k) => {
      const P = POLY[k];
      const hp = HITS[k === "house" ? 0 : 1].p;
      P.forEach((a, j) => {
        const b = P[(j + 1) % P.length];
        const near = Math.hypot(a[0] - hp[0], a[1] - hp[1]) <= Math.hypot(b[0] - hp[0], b[1] - hp[1]);
        const kk = interpolate(frame, [grooveAt[k] + j * 0.6, grooveAt[k] + j * 0.6 + 5], [0, 1], clamp);
        if (kk > 0) pushCrack(`g${k}-${j}`, near ? a : b, near ? b : a, kk, GROOVE_W);
      });
    });

  // ---- debris ----
  const chipEls = [...STRIKE_CHIPS, ...CHIPS].map((ch, i) => {
    const t = (frame - ch.at) / 30;
    if (t < 0 || t > 1.3) return null;
    const x = ch.p[0] + ch.v[0] * t;
    const y = ch.p[1] + ch.v[1] * t + 0.5 * 3400 * t * t;
    if (y > H + 20) return null;
    const fade = Math.exp(-Math.max(0, y - ch.p[1]) / 700);
    const v = Math.round(ch.tone * fade);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: ch.s,
          height: ch.s * 0.7,
          backgroundColor: `rgb(${v},${v - 2},${v - 6})`,
          transform: `rotate(${ch.spin * t}deg)`,
          clipPath: "polygon(0 20%, 70% 0, 100% 60%, 30% 100%)",
        }}
      />
    );
  });
  const dustEls = SHARDS.map((s, i) => {
    const t = frame - s.release;
    if (t < 0 || t > 30 || s.area < 3000) return null;
    const [x, y] = toS(s.c);
    const k = t / 30;
    const r = 40 + 130 * Math.sqrt(k) * Math.min(1.6, Math.sqrt(s.area / 20000));
    const a = 0.15 * (1 - k) * Math.min(1, t / 3);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x - r,
          top: y - r + 40 * k,
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(178,172,160,${a}) 0%, rgba(178,172,160,${a * 0.45}) 40%, rgba(178,172,160,0) 70%)`,
        }}
      />
    );
  });
  const motes =
    frame >= HITS[2].f &&
    MOTES.map((m, i) => {
      const t = (frame - HITS[2].f) / 30;
      const a = m.a * Math.min(1, t * 1.5) * (0.7 + 0.3 * Math.sin(frame * 0.3 + i));
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: m.x + m.vx * t,
            top: m.y + m.vy * t,
            width: m.s,
            height: m.s,
            borderRadius: "50%",
            backgroundColor: `rgba(220,214,200,${a})`,
          }}
        />
      );
    });

  return (
    <AbsoluteFill>
      {!clear && (
        <AbsoluteFill style={{ isolation: "isolate" }}>
          {/* ---- wall plate ---- */}
          {!plateBroken ? (
            plateContent
          ) : (
            <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: "540px 760px" }}>
              {PLATE.map((p, i) => {
                const m = fall(frame, p.release, p.v, 6400, 0) ?? REST;
                if (m.dz > PERSPECTIVE * 0.8) return null;
                const bb = bboxOf(p.poly);
                if (bb.y + m.dy > H + 200 && m.dz < 400) return null;
                const lit = faceLight(m.rx, m.ry, m.rz);
                const loc = p.poly.map(([x, y]) => `${(x - bb.x).toFixed(1)}px ${(y - bb.y).toFixed(1)}px`).join(", ");
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: bb.x,
                      top: bb.y,
                      width: bb.w,
                      height: bb.h,
                      overflow: "hidden",
                      clipPath: `polygon(${loc})`,
                      transformOrigin: `${p.c[0] - bb.x}px ${p.c[1] - bb.y}px`,
                      transform: `translate3d(${m.dx}px, ${m.dy}px, ${m.dz}px) rotateX(${m.rx}deg) rotateY(${m.ry}deg) rotateZ(${m.rz}deg)`,
                    }}
                  >
                    <div style={{ position: "absolute", left: -bb.x, top: -bb.y, width: W, height: H }}>
                      {plateContent}
                      {vignette}
                      <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${Math.min(0.7, 0.65 * (1 - Math.min(1, lit)))})` }} />
                    </div>
                  </div>
                );
              })}
            </AbsoluteFill>
          )}

          {/* ---- the slab ---- */}
          <AbsoluteFill style={{ transform: camT, transformOrigin: camO }}>
            {/* thickness of what's still in place (behind every face) */}
            {SHARDS.map((s, i) => (!shardMotion[i] ? <Slab key={i} poly={s.poly} m={null} part="sides" /> : null))}
            {LOGO_ORDER.map((k) => (frame < logoRelease[k] - 3 ? <Slab key={k} poly={POLY[k]} m={null} part="sides" /> : null))}
            {LOGO_ORDER.map((k) =>
              frame < logoRelease[k] - 3 ? <Slab key={k} poly={POLY[k]} m={null} part="face" rim={frame >= HITS[3].f + 4} /> : null,
            )}
            {SHARDS.map((s, i) => (!shardMotion[i] ? <Slab key={i} poly={s.poly} m={null} part="face" /> : null))}
            {/* block's outer lit lips (top + left) */}
            {frame < HITS[1].f + 14 && (
              <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
                <polyline
                  points={`${BLOCK.x},${BLOCK.y + BLOCK.h} ${BLOCK.x},${BLOCK.y} ${BLOCK.x + BLOCK.w},${BLOCK.y}`}
                  fill="none"
                  stroke="rgba(232,226,212,0.35)"
                  strokeWidth={2}
                />
              </svg>
            )}
            <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
              {crackLines}
            </svg>

            {/* falling: chunks, then the mark */}
            <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: "540px 700px" }}>
              {SHARDS.map((s, i) => {
                const m = shardMotion[i];
                if (!m || m.dy > 1500) return null;
                // it leaves the lit plane as soon as it lets go
                const off = 0.22 * interpolate(frame - s.release, [0, 4], [0, 1], clamp);
                return <Slab key={i} poly={s.poly} m={m} dark={off + (1 - off) * (1 - Math.exp(-m.dy / 420))} rim />;
              })}
              {LOGO_ORDER.map((k) => {
                const m = logoMotion(k);
                if (!m || m.dy > 1700 || m.dz > PERSPECTIVE * 0.8) return null;
                return <Slab key={k} poly={POLY[k]} m={m} dark={1 - Math.exp(-m.dy / 900)} rim />;
              })}
            </AbsoluteFill>
            {dustEls}
            {chipEls}
            {motes}
          </AbsoluteFill>

          {!plateBroken && vignette}
          {!plateBroken && <FilmGrain frame={frame} />}
          {frame < LIGHT_ON && <AbsoluteFill style={{ backgroundColor: "#000" }} />}
          {sweepOn && (
            <>
              <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim * 0.55})`, clipPath: sweepClip(-40) }} />
              <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim * 0.75})`, clipPath: sweepClip(0) }} />
            </>
          )}
        </AbsoluteFill>
      )}

      {/* ---- sound ---- */}
      <Sequence durationInFrames={PLATE_BREAK + 6} layout="none">
        <Audio
          src={staticFile("ident/audio/fracture/drone.wav")}
          volume={(f) => interpolate(f, [0, 12, PLATE_BREAK - 2, PLATE_BREAK + 5], [0, 0.75, 0.85, 0], clamp)}
        />
      </Sequence>
      <Sequence from={LIGHT_ON} layout="none">
        <Audio src={staticFile("ident/audio/fracture/light.wav")} volume={0.8} />
      </Sequence>
      {HITS.map((h, i) => (
        <Sequence key={i} from={h.f} layout="none">
          <Audio src={staticFile("ident/audio/fracture/impact.wav")} volume={() => [0.85, 0.8, 0.85, 0.9][i]} playbackRate={[1, 1.04, 0.96, 0.9][i]} />
          <Audio src={staticFile("ident/audio/fracture/crack.wav")} volume={() => [0.7, 0.6, 0.65, 0.7][i]} playbackRate={[1, 0.92, 1.08, 0.85][i]} />
          {i > 0 && <Audio src={staticFile("ident/audio/fracture/rubble.wav")} volume={() => [0, 0.55, 0.75, 0.85][i]} playbackRate={[1, 1.05, 0.95, 0.9][i]} />}
          {i === 3 && <Audio src={staticFile("ident/audio/fracture/boom.wav")} volume={0.9} />}
        </Sequence>
      ))}
      {[0, 4, 8, 12].map((d) => (
        <Sequence key={d} from={LABELS + d} layout="none">
          <Audio src={staticFile("audio/bumper/led-click.wav")} volume={0.08} playbackRate={0.7} />
        </Sequence>
      ))}
      <Sequence from={TENSION - 2} layout="none">
        <Audio src={staticFile("ident/audio/fracture/tension.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={LOGO_BREAK} layout="none">
        <Audio src={staticFile("ident/audio/fracture/impact.wav")} volume={0.8} playbackRate={0.8} />
        <Audio src={staticFile("ident/audio/fracture/crack.wav")} volume={0.7} playbackRate={0.8} />
      </Sequence>
      <Sequence from={PLATE_BREAK - 8} layout="none">
        <Audio src={staticFile("ident/audio/fracture/air.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={PLATE_BREAK} layout="none">
        <Audio src={staticFile("ident/audio/fracture/break.wav")} volume={1} />
      </Sequence>
    </AbsoluteFill>
  );
};
