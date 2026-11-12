import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_VIEWBOX, LogoPiece, W, rand } from "./brand";
import { Grain } from "./common";

/**
 * MORPH — kinetic primitives.
 * One fat black square drops in and rubber-hoses; on the second bounce it snaps into
 * four coloured quarters that morph square → circle → triangle → logo piece on the
 * beat. The door is late: it ricochets off the roof and lands last, which is the
 * "lock": everything snaps black and the hard yellow shadows punch on. Letters drop
 * in as coloured squares and pop into glyphs. Exit: the whole frame breaks into a
 * halftone grid whose dots shrink to nothing in a wave from the mark.
 *
 * Beat grid: 120 bpm, beat = 15 f, half-beat = 7.5 f.
 */
export const MORPH_FRAMES = 132;
const FPS = 30;

// ---- timeline ----
const T = {
  land1: 8,
  split: 23,
  bonk: 42,
  doorLand: 52,
  lock: 53,
  word1: 60,
  word2: 69,
  tag: 84,
  halftone: 97,
  clear: 122, // nothing rendered from here
};

// ---- layout ----
const MW = 820;
const S = MW / LOGO_VIEWBOX.w; // logo units → px
const MH = LOGO_VIEWBOX.h * S;
const CX = 505;
const CY = 740;
const MX = CX - MW / 2; // mark origin
const MY = CY - MH / 2;
const GROUND = MY + 665.5 * S; // mark baseline
const SQ = 420; // the fat square
const N = 96; // points per shape

type Pt = [number, number];
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const sp = (frame: number, at: number, config: Parameters<typeof spring>[0]["config"] = {}) =>
  spring({ frame: frame - at, fps: FPS, config });

// ---------------------------------------------------------------------------
// geometry

const area = (p: Pt[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};
const centroid = (p: Pt[]): Pt => {
  // polygon centroid
  let cx = 0;
  let cy = 0;
  const a = area(p);
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
};

/** Corner-preserving resample: every vertex is kept, edges get points by length. */
const resample = (poly: Pt[], n: number): Pt[] => {
  const p = area(poly) < 0 ? [...poly].reverse() : poly; // clockwise on screen (y down) → positive area
  const lens = p.map((a, i) => Math.hypot(p[(i + 1) % p.length][0] - a[0], p[(i + 1) % p.length][1] - a[1]));
  const per = lens.reduce((s, l) => s + l, 0);
  const counts = lens.map((l) => Math.max(1, Math.round((n * l) / per)));
  let tot = counts.reduce((s, c) => s + c, 0);
  while (tot !== n) {
    // fix rounding on the longest edge per point
    let bi = 0;
    for (let i = 1; i < counts.length; i++) {
      if (tot > n ? lens[i] / counts[i] < lens[bi] / counts[bi] && counts[i] > 1 : lens[i] / counts[i] > lens[bi] / counts[bi]) bi = i;
    }
    counts[bi] += tot > n ? -1 : 1;
    tot += tot > n ? -1 : 1;
  }
  const out: Pt[] = [];
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length];
    for (let k = 0; k < counts[i]; k++) {
      const t = k / counts[i];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return out;
};

const center = (p: Pt[]): Pt[] => {
  const c = centroid(p);
  return p.map(([x, y]) => [x - c[0], y - c[1]]);
};

/** Rotate the point order of `b` so it lines up with `a` (least travel, no twisting). */
const align = (a: Pt[], b: Pt[]): Pt[] => {
  let best = 0;
  let bestD = Infinity;
  for (let o = 0; o < b.length; o++) {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      const q = b[(i + o) % b.length];
      d += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2;
    }
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return a.map((_, i) => b[(i + best) % b.length]);
};

const circle = (r: number): Pt[] =>
  Array.from({ length: N }, (_, i) => {
    const t = -Math.PI / 2 + (i / N) * Math.PI * 2;
    return [Math.cos(t) * r, Math.sin(t) * r];
  });
const square = (s: number): Pt[] =>
  resample(
    [
      [-s / 2, -s / 2],
      [s / 2, -s / 2],
      [s / 2, s / 2],
      [-s / 2, s / 2],
    ],
    N,
  );
const triangle = (side: number): Pt[] => {
  const h = (side * Math.sqrt(3)) / 2;
  return resample(
    [
      [0, (-2 * h) / 3],
      [side / 2, h / 3],
      [-side / 2, h / 3],
    ],
    N,
  );
};

// logo pieces as straight-edged polygons (house's tiny corner radii dropped), logo units
const LOGO_POLYS: Record<LogoPiece, Pt[]> = {
  house: [
    [347.9, 3.2],
    [347.9, 665.5],
    [0, 665.5],
    [0, 283],
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

const PIECES: LogoPiece[] = ["house", "slatA", "slatB", "door"];

// piece colour mid-morph
const COLOR: Record<LogoPiece, string> = {
  house: C.yellow,
  slatA: C.twitch,
  slatB: C.punch,
  door: C.mint,
};

// which quarter of the square each piece comes from (dx, dy in -1/1)
const QUAD: Record<LogoPiece, Pt> = {
  house: [-1, -1],
  slatA: [1, -1],
  slatB: [1, 1],
  door: [-1, 1],
};

type Chain = { shapes: Pt[][]; at: number[]; spin: number[] };

const GEO = (() => {
  const targetPx: Record<string, Pt[]> = {};
  const targetC: Record<string, Pt> = {};
  const chains: Record<string, Chain> = {};
  for (const p of PIECES) {
    const px = LOGO_POLYS[p].map(([x, y]) => [MX + x * S, MY + y * S] as Pt);
    targetC[p] = centroid(px);
    targetPx[p] = resample(px, N);
    const local = center(targetPx[p]);
    const A = Math.abs(area(local));
    const r = Math.max(70, Math.sqrt(A / Math.PI) * 0.95);
    const side = Math.max(130, Math.sqrt((4 * A) / Math.sqrt(3)) * 0.95);
    const q = square(SQ / 2);
    if (p === "door") {
      const c1 = align(q, circle(r * 1.05));
      const logo = align(c1, local);
      chains[p] = { shapes: [q, c1, logo], at: [T.split, T.split + 4, T.doorLand - 8], spin: [0, 180, 180] };
    } else {
      const c1 = align(q, circle(r));
      const tr = align(c1, triangle(side));
      const logo = align(tr, local);
      const stagger = PIECES.indexOf(p);
      const dir = p === "slatA" ? -1 : 1;
      chains[p] = {
        shapes: [q, c1, tr, logo],
        at: [T.split, T.split + 7 + stagger, T.split + 14 + stagger, T.split + 22 + stagger],
        spin: [0, 180 * dir, 120 * dir, 60 * dir],
      };
    }
  }
  return { targetC, chains };
})();

const MORPH_CFG = { damping: 9, stiffness: 230, mass: 0.55 };

/** Local shape (centred) at a frame: S0 + Σ p_k (S_k − S_{k−1}); p_k is a springy 0→1. */
const chainShape = (ch: Chain, frame: number): { pts: Pt[]; rot: number } => {
  // the lock is a hard snap: whatever is still wobbling clicks into the exact mark
  if (frame >= T.lock) return { pts: ch.shapes[ch.shapes.length - 1].map((q) => [q[0], q[1]] as Pt), rot: 0 };
  const pts = ch.shapes[0].map((q) => [q[0], q[1]] as Pt);
  let rot = 0;
  for (let k = 1; k < ch.shapes.length; k++) {
    const pk = sp(frame, ch.at[k], MORPH_CFG);
    if (pk === 0) continue;
    const a = ch.shapes[k - 1];
    const b = ch.shapes[k];
    for (let i = 0; i < N; i++) {
      pts[i][0] += (b[i][0] - a[i][0]) * pk;
      pts[i][1] += (b[i][1] - a[i][1]) * pk;
    }
    rot += ch.spin[k] * pk;
  }
  return { pts, rot };
};

// ---------------------------------------------------------------------------
// motion

const quarterStart = (p: LogoPiece): Pt => {
  const [dx, dy] = QUAD[p];
  const cyAtSplit = GROUND - (SQ / 2) * 0.78; // squashed at contact
  return [CX + dx * (SQ / 4 + 6), cyAtSplit + dy * (SQ / 4) * 0.78];
};

// door path keyframes (screen px)
const HOUSE_TIP: Pt = [MX + 347.9 * S, MY + 3 * S];
const DOOR_APEX: Pt = [CX - 120, MY - 330];
const doorR = () => Math.sqrt(Math.abs(area(GEO.chains.door.shapes[1])) / Math.PI);

const pieceCenter = (p: LogoPiece, f: number): Pt => {
  const s0 = quarterStart(p);
  const tc = GEO.targetC[p];
  if (f >= T.lock) return tc;
  if (p !== "door") {
    const k = sp(f, T.split, { damping: 13, stiffness: 150, mass: 0.7 });
    const hop = Math.sin(Math.PI * Math.min(1, Math.max(0, k))) * 190;
    // pop-apart shove right at the split
    const t = Math.max(0, f - T.split);
    const shove = 34 * Math.exp(-t / 2.5) * (f >= T.split ? 1 : 0);
    const [dx, dy] = QUAD[p];
    return [s0[0] + (tc[0] - s0[0]) * k + dx * shove, s0[1] + (tc[1] - s0[1]) * k - hop + dy * shove];
  }
  // the late one: up high, falls onto the roof tip, ricochets into place
  const r = doorR();
  const contact: Pt = [HOUSE_TIP[0] - r * 0.35, HOUSE_TIP[1] - r * 0.92];
  if (f <= 36) {
    const u = interpolate(f, [T.split, 36], [0, 1], clamp);
    const ex = 1 - (1 - u) ** 3; // fast out, hangs at the top
    const x = s0[0] + (DOOR_APEX[0] - s0[0]) * u;
    const y = s0[1] + (DOOR_APEX[1] - s0[1]) * ex;
    return [x, y];
  }
  if (f <= T.bonk) {
    const u = interpolate(f, [36, T.bonk], [0, 1], clamp);
    return [DOOR_APEX[0] + (contact[0] - DOOR_APEX[0]) * u, DOOR_APEX[1] + (contact[1] - DOOR_APEX[1]) * u * u];
  }
  const u = interpolate(f, [T.bonk, T.doorLand], [0, 1], clamp);
  const x = contact[0] + (tc[0] - contact[0]) * u;
  // ballistic: up off the roof, then down into the door slot
  const yLin = contact[1] + (tc[1] - contact[1]) * u;
  const y = yLin - Math.sin(Math.PI * u) * 260 * (1 - u * 0.3);
  if (f <= T.doorLand) return [x, y];
  // settle bounce after landing
  const t = f - T.doorLand;
  return [tc[0], tc[1] - Math.abs(Math.sin(t * 0.9)) * 22 * Math.exp(-t / 2.5)];
};

/** squash (sx, sy) about a pivot from impacts on this piece */
const pieceSquash = (p: LogoPiece, f: number): { sx: number; sy: number; pivotBottom: boolean } => {
  let sy = 1;
  if (p === "house" && f >= T.bonk) {
    const t = f - T.bonk;
    sy *= 1 - 0.11 * Math.exp(-t / 3) * Math.cos(t * 1.1);
  }
  if (p === "door") {
    for (const at of [T.bonk, T.doorLand]) {
      if (f >= at) {
        const t = f - at;
        sy *= 1 - 0.32 * Math.exp(-t / 2.2) * Math.cos(t * 1.0);
      }
    }
  }
  // non-door pieces land into place ~f31–33 with a little splat
  if (p !== "door") {
    const land = T.split + 8 + PIECES.indexOf(p);
    if (f >= land) {
      const t = f - land;
      sy *= 1 - 0.16 * Math.exp(-t / 2.4) * Math.cos(t * 1.05);
    }
  }
  return { sx: 1 / Math.sqrt(sy) / Math.sqrt(sy) /* volume */, sy, pivotBottom: true };
};

/** Screen-space points for a piece at frame f. */
const piecePts = (p: LogoPiece, f: number): Pt[] => {
  const ch = GEO.chains[p];
  const { pts, rot } = chainShape(ch, f);
  const c = pieceCenter(p, f);
  const sq = pieceSquash(p, f);
  // velocity stretch
  const c0 = pieceCenter(p, f - 1);
  const vx = c[0] - c0[0];
  const vy = c[1] - c0[1];
  const v = Math.hypot(vx, vy);
  const st = f > T.split && f < (p === "door" ? T.doorLand : T.lock) ? Math.min(0.42, v / 140) : 0;
  const ang = Math.atan2(vy, vx);
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const rr = (rot * Math.PI) / 180;
  const cr = Math.cos(rr);
  const sr = Math.sin(rr);
  // bottom of the piece in local coords (for squash pivot)
  let maxY = -Infinity;
  for (const q of pts) maxY = Math.max(maxY, q[1] * cr + q[0] * sr);
  return pts.map(([x0, y0]) => {
    // spin
    let x = x0 * cr - y0 * sr;
    let y = x0 * sr + y0 * cr;
    // squash about the piece bottom
    x *= sq.sx;
    y = maxY + (y - maxY) * sq.sy;
    // stretch along velocity (volume preserving)
    if (st > 0) {
      const a = x * ca + y * sa;
      const b = -x * sa + y * ca;
      const a2 = a * (1 + st);
      const b2 = b / (1 + st);
      x = a2 * ca - b2 * sa;
      y = a2 * sa + b2 * ca;
    }
    return [c[0] + x, c[1] + y];
  }).map(([x, y]) => {
    // lock press: the whole mark squashes as one unit about the baseline
    if (f < T.lock) return [x, y] as Pt;
    const t = f - T.lock;
    const sl = 1 - 0.1 * Math.exp(-t / 2.6) * Math.cos(t * 0.95);
    return [CX + (x - CX) / Math.sqrt(sl), GROUND + (y - GROUND) * sl] as Pt;
  });
};

// the fat square, f < split
const squareRect = (f: number): { cx: number; cy: number; w: number; h: number } => {
  const restY = GROUND - SQ / 2;
  if (f < T.land1) {
    const t = Math.max(0, f + 1) / (T.land1 + 1);
    const y = -SQ + (restY + SQ) * t * t;
    const sy = 1 + 0.28 * t;
    return { cx: CX, cy: y, w: SQ / sy, h: SQ * sy };
  }
  const sy = interpolate(f, [8, 9, 10, 11, 13, 16, 19, 21, 22, 23], [0.7, 0.66, 0.84, 1.2, 1.06, 0.98, 1.0, 1.12, 1.0, 0.78], clamp);
  const u = interpolate(f, [11, 22], [0, 1], clamp);
  const hop = 4 * 270 * u * (1 - u);
  const h = SQ * sy;
  return { cx: CX, cy: GROUND - h / 2 - hop, w: SQ / sy, h };
};

// decaying camera shake
const IMPACTS: { f: number; amp: number }[] = [
  { f: T.land1, amp: 14 },
  { f: T.split, amp: 10 },
  { f: T.split + 8, amp: 4 },
  { f: T.bonk, amp: 6 },
  { f: T.lock, amp: 17 },
  { f: T.word1 + 6, amp: 5 },
  { f: T.word2 + 6, amp: 6 },
  { f: T.tag, amp: 8 },
];
const shake = (frame: number) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const { f, amp } of IMPACTS) {
    const t = frame - f;
    if (t < 0 || t > 10) continue;
    const k = amp * Math.exp(-t / 2.4);
    x += (rand(f * 13 + t) - 0.5) * 2 * k;
    y += (rand(f * 29 + t + 7) - 0.5) * 2 * k;
    r += (rand(f * 41 + t + 3) - 0.5) * 0.22 * k;
  }
  return { x, y, r };
};

const ptsStr = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const shift = (p: Pt[], dx: number, dy: number): Pt[] => p.map(([x, y]) => [x + dx, y + dy]);

// ---------------------------------------------------------------------------
// type: letters drop in as coloured squares and pop into glyphs

const LETTER_COLORS = [C.yellow, C.twitch, C.punch, C.mint, C.amber];

const Word: React.FC<{ text: string; size: number; top: number; start: number; frame: number; seed: number }> = ({
  text,
  size,
  top,
  start,
  frame,
  seed,
}) => {
  const cw = size * 0.86; // Rubik Mono One is monospaced
  const total = cw * text.length;
  const left = CX - total / 2;
  return (
    <>
      {text.split("").map((ch, i) => {
        const fs = start + Math.round(i * 0.9);
        const land = fs + 5;
        const pop = land + 2;
        if (frame < fs) return null;
        const x = left + i * cw;
        const box = cw * 0.94;
        const col = LETTER_COLORS[(i + seed) % LETTER_COLORS.length];
        if (frame < pop) {
          // falling square, stretched, then splat
          const u = Math.min(1, (frame - fs + 1) / 6);
          const y = top - 90 + 90 * u * u;
          const syF = frame < land ? 1 + 0.35 * u : 0.62;
          const sxF = 1 / syF;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x + (cw - box * sxF) / 2,
                top: y + box * (1 - syF),
                width: box * sxF,
                height: box * syF,
                background: col,
                border: `6px solid ${C.ink}`,
                boxShadow: `6px 6px 0 0 ${C.ink}`,
                boxSizing: "border-box",
              }}
            />
          );
        }
        const k = sp(frame, pop, { damping: 8, stiffness: 320, mass: 0.45 });
        const flash = frame === pop; // one frame of the square's colour as the glyph's shadow
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: top - size * 0.04,
              width: cw,
              textAlign: "center",
              fontFamily: FONT_DISPLAY,
              fontSize: size,
              lineHeight: 1,
              color: C.ink,
              transform: `scale(${1.45 - 0.45 * k}) rotate(${(rand(i * 7 + seed) - 0.5) * 16 * (1 - k)}deg)`,
              transformOrigin: "50% 85%",
              textShadow: `${flash ? 0 : 5}px ${flash ? 0 : 5}px 0 ${col}`,
            }}
          >
            {ch}
          </div>
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------------------
// exit: halftone mask (dots shrink to nothing, wave from the mark)

const PITCH = 54;
const halftoneMask = (frame: number): string | undefined => {
  if (frame < T.halftone) return undefined;
  const cols = Math.ceil(W / PITCH) + 1;
  const rows = Math.ceil(H / PITCH) + 1;
  const ox = CX;
  const oy = CY;
  const maxD = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy));
  let circles = "";
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * PITCH + (j % 2 ? PITCH / 2 : 0);
      const y = j * PITCH;
      const d = Math.hypot(x - ox, y - oy) / maxD;
      const delay = d * 13 + rand(i * 31 + j * 17) * 2;
      const u = interpolate(frame - T.halftone - delay, [0, 8], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
      const r = PITCH * 0.74 * (1 - u);
      if (r > 0.4) circles += `<circle cx='${x}' cy='${y}' r='${r.toFixed(1)}'/>`;
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><g fill='white'>${circles}</g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};

// ---------------------------------------------------------------------------

export const Morph: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame >= T.clear) return <AbsoluteFill />;

  const sh = shake(frame);
  const driftX = Math.sin(frame / 23) * 3;
  const driftY = Math.sin(frame / 31 + 1) * 2.5;
  const roll = Math.sin(frame / 29) * 0.35;
  const exitPush = interpolate(frame, [T.halftone, T.clear], [1, 1.07], clamp);

  const locked = frame >= T.lock;
  const shadowK = sp(frame, T.lock, { damping: 7, stiffness: 300, mass: 0.5 });
  const lockShadow = 26 * shadowK;

  const mask = halftoneMask(frame);

  // ---- the shapes ----
  let shapes: React.ReactNode;
  if (frame < T.split) {
    const r = squareRect(frame);
    const fallShadow = frame < T.land1 ? 0 : 22;
    const pts: Pt[] = [
      [r.cx - r.w / 2, r.cy - r.h / 2],
      [r.cx + r.w / 2, r.cy - r.h / 2],
      [r.cx + r.w / 2, r.cy + r.h / 2],
      [r.cx - r.w / 2, r.cy + r.h / 2],
    ];
    const ghosts =
      frame < T.land1 && frame > 0
        ? [2, 1].map((g) => {
            const q = squareRect(frame - g);
            return (
              <rect key={g} x={q.cx - q.w / 2} y={q.cy - q.h / 2} width={q.w} height={q.h} fill={C.ink} opacity={0.18 * (3 - g)} />
            );
          })
        : null;
    shapes = (
      <>
        {ghosts}
        <polygon points={ptsStr(shift(pts, fallShadow, fallShadow))} fill={C.yellow} stroke={C.ink} strokeWidth={6} strokeLinejoin="miter" />
        <polygon points={ptsStr(pts)} fill={C.ink} stroke={C.ink} strokeWidth={10} strokeLinejoin="miter" />
      </>
    );
  } else {
    const order: LogoPiece[] = ["slatA", "slatB", "house", "door"];
    const all = order.map((p) => ({ p, pts: piecePts(p, frame) }));
    shapes = (
      <>
        {/* shadows first, so no shadow overlaps another piece */}
        {all.map(({ p, pts }) =>
          locked ? (
            <polygon key={`s-${p}`} points={ptsStr(shift(pts, lockShadow, lockShadow))} fill={C.yellow} />
          ) : (
            <polygon key={`s-${p}`} points={ptsStr(shift(pts, 12, 12))} fill={C.ink} />
          ),
        )}
        {/* motion smear: flat ghost copies on fast moves */}
        {!locked &&
          all.map(({ p }) => {
            const c1 = pieceCenter(p, frame);
            const c0 = pieceCenter(p, frame - 1);
            if (Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < 34) return null;
            return <polygon key={`g-${p}`} points={ptsStr(piecePts(p, frame - 1))} fill={COLOR[p]} opacity={0.3} />;
          })}
        {all.map(({ p, pts }) => (
          <polygon
            key={p}
            points={ptsStr(pts)}
            fill={locked ? C.ink : COLOR[p]}
            stroke={C.ink}
            strokeWidth={locked ? 2 : 8}
            strokeLinejoin="miter"
          />
        ))}
      </>
    );
  }

  // split flash: one frame of hard white cross where the square snaps apart
  const splitFlash = frame === T.split;

  const tagK = sp(frame, T.tag, { damping: 10, stiffness: 300, mass: 0.5 });
  const tagFlash = frame >= T.tag && frame < T.tag + 2;

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          isolation: "isolate",
          WebkitMaskImage: mask,
          maskImage: mask,
          WebkitMaskSize: `${W}px ${H}px`,
          maskSize: `${W}px ${H}px`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
      >
        <AbsoluteFill style={{ backgroundColor: C.paper }} />
        {/* faint print dot grid — foreshadows the halftone exit */}
        <AbsoluteFill style={{ transform: `translate(${driftX * 0.4 + sh.x * 0.3}px, ${driftY * 0.4 + sh.y * 0.3}px)` }}>
          <svg width={W + 200} height={H + 200} style={{ position: "absolute", left: -100, top: -100 }}>
            <defs>
              <pattern id="mdots" width={PITCH} height={PITCH * 2} patternUnits="userSpaceOnUse">
                <circle cx={0} cy={0} r={3} fill={C.ink} />
                <circle cx={PITCH} cy={0} r={3} fill={C.ink} />
                <circle cx={PITCH / 2} cy={PITCH} r={3} fill={C.ink} />
                <circle cx={0} cy={PITCH * 2} r={3} fill={C.ink} />
                <circle cx={PITCH} cy={PITCH * 2} r={3} fill={C.ink} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mdots)" opacity={0.1} />
          </svg>
        </AbsoluteFill>

        <AbsoluteFill
          style={{
            transform: `translate(${sh.x + driftX}px, ${sh.y + driftY}px) rotate(${sh.r + roll}deg) scale(${exitPush})`,
            transformOrigin: `${CX}px ${CY}px`,
          }}
        >
          <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            {shapes}
            {splitFlash && (
              <g>
                <rect x={CX - 8} y={GROUND - SQ * 0.8} width={16} height={SQ * 0.8} fill={C.paper} />
                <rect x={CX - SQ / 1.6} y={GROUND - SQ * 0.39 - 8} width={SQ * 1.25} height={16} fill={C.paper} />
              </g>
            )}
          </svg>

          {/* type */}
          <Word text="WATERHOUSE" size={88} top={1112} start={T.word1} frame={frame} seed={0} />
          <Word text="SESSIONS" size={110} top={1228} start={T.word2} frame={frame} seed={2} />
          {frame >= T.tag && (
            <div style={{ position: "absolute", left: 0, width: W, top: 1388, display: "flex", justifyContent: "center", transform: `translateX(${CX - W / 2}px)` }}>
              <div
                style={{
                  transform: `scale(${1.7 - 0.7 * tagK}) rotate(${-6 + 4 * tagK}deg)`,
                  background: tagFlash ? C.yellow : C.ink,
                  color: tagFlash ? C.ink : C.yellow,
                  fontFamily: FONT_MONO,
                  fontWeight: 800,
                  fontSize: 38,
                  letterSpacing: "0.22em",
                  padding: "14px 22px 14px 30px",
                  boxShadow: `${8 * tagK}px ${8 * tagK}px 0 0 ${C.twitch}`,
                }}
              >
                WITH DENZO · TUESDAY
              </div>
            </div>
          )}
        </AbsoluteFill>

        <Grain opacity={0.09} />
      </AbsoluteFill>

      {/* ---- sound ---- */}
      <Sequence layout="none">
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.25} playbackRate={1.6} />
      </Sequence>
      <Sequence from={T.land1} layout="none">
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={1} playbackRate={0.85} />
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={12} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.25} playbackRate={1.3} />
      </Sequence>
      <Sequence from={T.split} layout="none">
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.8} playbackRate={1.15} />
        <Audio src={staticFile("audio/recap/pop.wav")} volume={0.9} />
        <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.5} />
      </Sequence>
      {/* pitched pop per morph step, rising */}
      {[
        { f: T.split + 4, n: 4 },
        { f: T.split + 7, n: 3 },
        { f: T.split + 9, n: 2 },
        { f: T.split + 14, n: 2 },
        { f: T.split + 16, n: 1 },
        { f: T.split + 22, n: 1 },
        { f: T.split + 24, n: 0 },
      ].map(({ f, n }, i) => (
        <Sequence key={`pop-${i}`} from={f} layout="none">
          <Audio src={staticFile(`audio/pullup/pop-friend-${n}.wav`)} volume={0.75} playbackRate={1 + i * 0.03} />
        </Sequence>
      ))}
      <Sequence from={T.bonk} layout="none">
        <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.9} playbackRate={1.3} />
        <Audio src={staticFile("audio/pullup/pop-you.wav")} volume={0.7} playbackRate={1.4} />
      </Sequence>
      <Sequence from={T.doorLand - 8} layout="none">
        <Audio src={staticFile("audio/pullup/pop-friend-0.wav")} volume={0.7} playbackRate={1.25} />
      </Sequence>
      <Sequence from={T.lock} layout="none">
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.85} />
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={0.9} />
      </Sequence>
      {/* letters: a tick per landing, a pop per glyph */}
      {[...Array(10).keys()].map((i) => (
        <Sequence key={`w1-${i}`} from={T.word1 + Math.round(i * 0.9) + 5} layout="none">
          <Audio src={staticFile("audio/recap/tick.wav")} volume={0.45} playbackRate={1 + (i % 3) * 0.08} />
        </Sequence>
      ))}
      {[...Array(8).keys()].map((i) => (
        <Sequence key={`w2-${i}`} from={T.word2 + Math.round(i * 0.9) + 5} layout="none">
          <Audio src={staticFile("audio/recap/tick.wav")} volume={0.5} playbackRate={0.9 + (i % 3) * 0.08} />
        </Sequence>
      ))}
      <Sequence from={T.word1 + 7} layout="none">
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.5} playbackRate={1.1} />
      </Sequence>
      <Sequence from={T.word2 + 7} layout="none">
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.6} playbackRate={0.9} />
      </Sequence>
      <Sequence from={T.tag} layout="none">
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.5} playbackRate={1.1} />
      </Sequence>
      <Sequence from={T.halftone - 2} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.55} playbackRate={0.75} />
      </Sequence>
      {[0, 3, 6, 9, 12, 15].map((d, i) => (
        <Sequence key={`ht-${i}`} from={T.halftone + d} layout="none">
          <Audio src={staticFile(`audio/pullup/pop-friend-${5 - i}.wav`)} volume={0.35} playbackRate={1.3 + i * 0.1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
