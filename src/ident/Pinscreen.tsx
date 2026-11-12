import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LogoPiece, W, rand } from "./brand";

/**
 * PINSCREEN — a kinetic pin-array installation, the whole frame a wall of machined pins.
 * One hard raking light from the left. A slow swell rolls through the array, the machine
 * steps out a mechanical staircase, then a giant crop of the mark (roof edge + slat) presses
 * out of the wall. Everything retracts, and the mark rises as a relief, the pins locking
 * with a dense clatter on the downbeat. Slats step out once more under the title. Exit:
 * the array empties, pins dropping out of the wall on a diagonal front, leaving holes to
 * the content.
 *
 * Own fake-3D projection into one SVG (no CSS 3D): per-pin prisms, painter-sorted, flat
 * per-face shading with a per-row cast-shadow march. 120 bpm → beat = 15 f.
 */
export const PINSCREEN_FRAMES = 138;

// ---- timeline (frames) ----
const T = {
  lightIn: 0,
  rippleStart: 2,
  step1: 30,
  step2: 38,
  crop: 45,
  flush: 60,
  rise: 63, // logo pins start rising (staggered), all locked by LOCK
  lock: 75,
  word1: 80,
  word2: 85,
  rule: 91,
  host: 93,
  slat: [96, 100, 104] as number[], // slatA, slatB, door step out further
  exit: 110, // title cut, array starts emptying
  clear: 128, // fully transparent from here
};

// ---- palette (near-black machined metal, paper type, one yellow rule) ----
const K = {
  gap: "#050505",
  paper: C.paper,
  grey: "#8a8a86",
  accent: C.yellow,
};

// ---- array geometry (world px, wall plane z = 0, z toward camera, origin at rotation centre) ----
const PITCH = 30;
const PIN = 26;
const COLS = 66;
const ROWS = 88;
const GX0 = -870; // grid extends further right: that side recedes as the camera swings
const GY0 = -940;
const CX = 540; // screen position of the world origin / perspective origin
const CY = 640;
const PERSPECTIVE = 1900;
const H_LOGO = 66;

type Pt = [number, number];
const POLY: Record<LogoPiece, Pt[]> = {
  house: [
    [347.9, 2.5],
    [0, 282.6],
    [0, 665.5],
    [347.9, 665.5],
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
const pip = (p: Pt[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

type Pin = {
  c: number;
  r: number;
  x: number; // centre
  y: number;
  logo: number; // 0/1
  piece: number; // index into LOGO_ORDER, -1 none
  crop: number; // 0/1
  rest: number;
  alb: number;
  jit: number;
  drop: number; // exit time
};

/** Rasterise a logo transform onto the pin grid: 4×4 subsamples per pin, ≥ 50% coverage. */
const raster = (cx: number, cy: number, s: number, ox: number, oy: number) => {
  const hits: Record<string, number> = {};
  let n = 0;
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++) {
      const u = (cx - PITCH / 2 + ((a + 0.5) * PITCH) / 4 - ox) / s;
      const v = (cy - PITCH / 2 + ((b + 0.5) * PITCH) / 4 - oy) / s;
      for (const k of LOGO_ORDER)
        if (pip(POLY[k], u, v)) {
          n++;
          hits[k] = (hits[k] || 0) + 1;
        }
    }
  let best = -1;
  let bn = 0;
  LOGO_ORDER.forEach((k, i) => {
    if ((hits[k] || 0) > bn) {
      bn = hits[k];
      best = i;
    }
  });
  return { on: n / 16 > 0.5 ? 1 : 0, piece: best };
};

const LW = 840; // logo width on the wall (world px); offset (8, 20) lands the gaps on pin rows/cols
const LS = LW / 1000;
const CROP_S = 3.3; // giant crop of the mark
const PINS: Pin[] = (() => {
  const out: Pin[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const x = GX0 + (c + 0.5) * PITCH;
      const y = GY0 + (r + 0.5) * PITCH;
      const lg = raster(x, y, LS, -LW / 2 + 8, (-666 * LS) / 2 + 20);
      // crop: house apex at (330, -560), the roof edge running across, slat A's edge on the right
      const cr = raster(x, y, CROP_S, 330 - 347.9 * CROP_S, -560 - 2.5 * CROP_S);
      const i = r * COLS + c;
      // exit: diagonal front from top-left to bottom-right with per-pin jitter
      const d = (c / COLS) * 0.45 + (r / ROWS) * 0.8;
      out.push({
        c,
        r,
        x,
        y,
        logo: lg.on,
        piece: lg.on ? lg.piece : -1,
        crop: cr.on,
        rest: 1 + 3.5 * rand(i * 1.37 + 3),
        alb: 0.86 + 0.14 * rand(i * 2.91 + 7),
        jit: rand(i * 5.13 + 11),
        drop: T.exit + d * 9.6 + (rand(i * 7.7 + 1) - 0.5) * 5,
      });
    }
  return out;
})();

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
const mech = Easing.bezier(0.7, 0, 0.3, 1); // machine step: firm start and stop
const lockE = Easing.in(Easing.cubic); // accelerate into a hard stop
const ss = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const deg = Math.PI / 180;

// light: from the left, low; slope = height lost per px of travel
const LX = -0.91;
const LZ = 0.41;
const SLOPE = LZ / -LX;

// ---- height field ----
const heightAt = (p: Pin, f: number) => {
  // P0: rest + slow swell rolling diagonally up through the array
  const dAlong = p.x * 0.55 - p.y * 0.83; // toward upper right
  const front = interpolate(f, [T.rippleStart, T.step1 + 6], [-1500, 1200], clamp);
  const ripA = interpolate(f, [T.rippleStart, T.rippleStart + 10], [0, 1], clamp);
  const band = Math.exp(-Math.pow((dAlong - front) / 170, 2));
  const band2 = Math.exp(-Math.pow((dAlong - front + 480) / 130, 2)) * 0.5;
  let h = p.rest + ripA * 96 * (band + band2);

  // P1/P2: mechanical staircase marching one step
  const stair = (shift: number) => {
    const k = Math.floor((p.c + p.r * 0.5) / 3) + shift;
    return p.rest + 13 * (((k % 4) + 4) % 4);
  };
  const mix = (target: number, s: number, d: number, e = mech) => {
    const t = interpolate(f, [s, s + d], [0, 1], { ...clamp, easing: e });
    if (t > 0) h = h + (target - h) * t;
  };
  mix(stair(0), T.step1, 4);
  mix(stair(1), T.step2, 4);
  // P3: giant crop of the mark presses out, a sweep across the wall
  mix(p.rest + p.crop * 58, T.crop + (p.c / COLS) * 7, 5);
  // P4: everything retracts flush
  mix(p.rest, T.flush, 4);
  // P5: the mark rises, pins staggered bottom-up with jitter, accelerating into the lock
  if (p.logo) {
    const s = T.rise + (1 - (p.y + 300) / 600) * 3.5 + p.jit * 3.5;
    mix(H_LOGO, s, T.lock - s, lockE);
    // slats/door step out further, in sequence, under the title
    const si = p.piece - 1; // slatA=0, slatB=1, door=2
    if (si >= 0) mix(H_LOGO + 26, T.slat[si], 4);
  }
  return h;
};

// ---- film texture (inside the SVG so the exit mask also cuts it) ----
const grainDefs = (seed: number) => (
  <>
    <filter id={`pg-${seed}`} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves={2} seed={seed} stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.9" intercept="-0.55" />
        <feFuncG type="linear" slope="1.9" intercept="-0.55" />
        <feFuncB type="linear" slope="1.9" intercept="-0.55" />
      </feComponentTransfer>
    </filter>
    <filter id={`pd-${seed}`} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves={1} seed={seed + 40} stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
  </>
);

const typed = (text: string, frame: number, at: number, cps = 1.5) =>
  text.slice(0, Math.max(0, Math.min(text.length, Math.floor((frame - at) * cps))));

const g = (v: number) => {
  const c = Math.round(Math.max(0, Math.min(255, v)));
  return `rgb(${c},${c},${Math.max(0, c - 3)})`;
};
const f1 = (n: number) => n.toFixed(1);

// ---------------------------------------------------------------------------

export const Pinscreen: React.FC = () => {
  const frame = useCurrentFrame();
  const clear = frame >= T.clear;

  // ---- camera: near-frontal, swinging slowly to a low 3/4 from the left; no overshoot ----
  const orbit = interpolate(frame, [0, T.lock + 4], [0, 1], { ...clamp, easing: easeIO });
  const ry = 9 + 19 * orbit + 0.04 * frame;
  const rx = 5 + 9 * orbit + 0.015 * frame;
  const rz = -1.2 * orbit;
  const dolly = 0.97 + 0.07 * orbit + 0.0007 * frame;

  // rotation matrix columns (CSS rotateX·rotateY·rotateZ, as in Monolith)
  const rot = (v: [number, number, number]): [number, number, number] => {
    let [x, y, z] = v;
    const cz = Math.cos(rz * deg);
    const sz = Math.sin(rz * deg);
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    const cyy = Math.cos(ry * deg);
    const syy = Math.sin(ry * deg);
    [x, z] = [x * cyy + z * syy, -x * syy + z * cyy];
    const cxx = Math.cos(rx * deg);
    const sxx = Math.sin(rx * deg);
    [y, z] = [y * cxx - z * sxx, y * sxx + z * cxx];
    return [x * dolly, y * dolly, z * dolly];
  };
  const c0 = rot([1, 0, 0]);
  const c1 = rot([0, 1, 0]);
  const c2 = rot([0, 0, 1]);
  const pj = (x: number, y: number, z: number): Pt => {
    const X = x * c0[0] + y * c1[0] + z * c2[0];
    const Y = x * c0[1] + y * c1[1] + z * c2[1];
    const Z = x * c0[2] + y * c1[2] + z * c2[2];
    const k = PERSPECTIVE / (PERSPECTIVE - Z);
    return [CX + X * k, CY + Y * k];
  };
  // eye in world space (transpose of the rotation; columns are scaled by dolly)
  const e = PERSPECTIVE / (dolly * dolly);
  const eye = [e * c0[2], e * c1[2], e * c2[2]];

  // ---- light ----
  const lightAmt = interpolate(frame, [T.lightIn, 4, 16], [0, 0.25, 1], { ...clamp, easing: easeIO });
  // a pool of light that travels from the left edge onto the mark
  const poolX = interpolate(frame, [0, 40, T.lock], [-520, -120, -60], { ...clamp, easing: easeIO });
  const poolY = interpolate(frame, [0, T.lock], [-120, 20], { ...clamp, easing: easeIO });
  const pool = (x: number, y: number) => 0.12 + 0.88 * Math.exp(-(((x - poolX) / 700) ** 2) - ((y - poolY) / 820) ** 2);

  // ---- heights ----
  const hs = new Float32Array(PINS.length);
  for (let i = 0; i < PINS.length; i++) hs[i] = heightAt(PINS[i], frame);

  // ---- per-row shadow march: shadow fraction on each top (from its left edge) and on its left flank ----
  const topSh = new Float32Array(PINS.length);
  const flankSh = new Float32Array(PINS.length);
  for (let r = 0; r < ROWS; r++) {
    let edgeH = -1e9;
    let edgeX = -1e9;
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const p = PINS[i];
      const h = hs[i];
      const xL = p.x - PIN / 2;
      const sh = edgeH - (xL - edgeX) * SLOPE; // shadow ray height at this pin's left edge
      topSh[i] = Math.max(0, Math.min(1, (sh - h) / SLOPE / PIN));
      flankSh[i] = h > 0.5 ? Math.max(0, Math.min(1, sh / h)) : 1;
      edgeH = Math.max(h, sh - PIN * SLOPE);
      edgeX = p.x + PIN / 2;
    }
  }

  // ---- exit state ----
  const dropT = (p: Pin) => (frame - p.drop) / 3; // 0..1 retracting into darkness, >1 gone
  const exiting = frame >= T.exit - 1;

  // ---- build geometry ----
  const AMB = 0.07;
  const flushPaths = new Map<number, string[]>(); // quantised grey → subpaths (drawn first, unsorted)
  const raised: { d2: number; els: React.ReactNode[] }[] = [];
  const sockets: string[] = [];
  const quad = (a: Pt, b: Pt, c: Pt, d: Pt) => `M${f1(a[0])},${f1(a[1])}L${f1(b[0])},${f1(b[1])}L${f1(c[0])},${f1(c[1])}L${f1(d[0])},${f1(d[1])}Z`;

  for (let i = 0; i < PINS.length; i++) {
    const p = PINS[i];
    let h = hs[i];
    let dark = 1;
    if (exiting) {
      const t = dropT(p);
      if (t >= 1) continue;
      if (t > 0) {
        h *= 1 - t;
        dark = 1 - t;
      }
      // socket for the exit mask (slightly oversized so neighbours overlap: no seams)
      const hp = PITCH / 2 + 0.9;
      const sa = pj(p.x - hp, p.y - hp, 0);
      const sb = pj(p.x + hp, p.y - hp, 0);
      const sc = pj(p.x + hp, p.y + hp, 0);
      const sd = pj(p.x - hp, p.y + hp, 0);
      sockets.push(quad(sa, sb, sc, sd));
    }
    const xL = p.x - PIN / 2;
    const xR = p.x + PIN / 2;
    const yT = p.y - PIN / 2;
    const yB = p.y + PIN / 2;
    const A = pj(xL, yT, h);
    const B = pj(xR, yT, h);
    const Cc = pj(xR, yB, h);
    const D = pj(xL, yB, h);
    // cull off-screen
    const minX = Math.min(A[0], D[0]);
    const maxX = Math.max(B[0], Cc[0]);
    const minY = Math.min(A[1], B[1]);
    const maxY = Math.max(Cc[1], D[1]);
    if (maxX < -60 || minX > W + 60 || maxY < -60 || minY > H + 60) continue;

    const pl = pool(p.x, p.y) * lightAmt;
    // tops: raking light + the "rises into the light" boost (flush field sits low in the sheet)
    const boost = 0.24 + 0.9 * ss(0, H_LOGO, h);
    const topLit = 255 * p.alb * (AMB + LZ * boost * pl * 1.0) * dark;
    const topDark = 255 * p.alb * AMB * dark;
    const fs = topSh[i];

    if (h < 4.5) {
      // flush: batch by grey; split top at the shadow line
      const push = (v: number, d: string) => {
        const q = Math.round(v / 3) * 3;
        const arr = flushPaths.get(q);
        if (arr) arr.push(d);
        else flushPaths.set(q, [d]);
      };
      if (fs <= 0.02) push(topLit, quad(A, B, Cc, D));
      else if (fs >= 0.98) push(topDark, quad(A, B, Cc, D));
      else {
        const xs = xL + PIN * fs;
        const M1 = pj(xs, yT, h);
        const M2 = pj(xs, yB, h);
        push(topDark, quad(A, M1, M2, D));
        push(topLit, quad(M1, B, Cc, M2));
      }
      continue;
    }

    const els: React.ReactNode[] = [];
    const A0 = pj(xL, yT, 0);
    const B0 = pj(xR, yT, 0);
    const C0 = pj(xR, yB, 0);
    const D0 = pj(xL, yB, 0);
    // side faces facing the eye
    if (eye[0] < xL) {
      // left flank: faces the light; lower part may sit in a neighbour's shadow
      const fl = flankSh[i];
      const lit = 255 * p.alb * (AMB + -LX * pl * 0.92) * dark;
      const shd = 255 * p.alb * (AMB + 0.02) * dark;
      if (fl <= 0.02) els.push(<path key="l" d={quad(A, D, D0, A0)} fill={g(lit)} />);
      else if (fl >= 0.98) els.push(<path key="l" d={quad(A, D, D0, A0)} fill={g(shd)} />);
      else {
        const zc = h * fl;
        const P1 = pj(xL, yT, zc);
        const P2 = pj(xL, yB, zc);
        els.push(<path key="l0" d={quad(P1, P2, D0, A0)} fill={g(shd)} />);
        els.push(<path key="l1" d={quad(A, D, P2, P1)} fill={g(lit)} />);
      }
    }
    if (eye[0] > xR) els.push(<path key="r" d={quad(B, Cc, C0, B0)} fill={g(255 * p.alb * AMB * 0.7 * dark)} />);
    if (eye[1] > yB) els.push(<path key="b" d={quad(D, Cc, C0, D0)} fill={g(255 * p.alb * (AMB * 0.75) * dark)} />);
    if (eye[1] < yT) els.push(<path key="t" d={quad(A, B, B0, A0)} fill={g(255 * p.alb * (AMB + 0.05) * dark)} />);
    // top
    if (fs <= 0.02) els.push(<path key="tp" d={quad(A, B, Cc, D)} fill={g(topLit)} />);
    else if (fs >= 0.98) els.push(<path key="tp" d={quad(A, B, Cc, D)} fill={g(topDark)} />);
    else {
      const xs = xL + PIN * fs;
      const M1 = pj(xs, yT, h);
      const M2 = pj(xs, yB, h);
      els.push(<path key="tp0" d={quad(A, M1, M2, D)} fill={g(topDark)} />);
      els.push(<path key="tp1" d={quad(M1, B, Cc, M2)} fill={g(topLit)} />);
    }
    // machined edge catching the light: a hairline on the top's left edge
    if (fs <= 0.02 && pl > 0.2 && h > 12)
      els.push(
        <line key="e" x1={f1(A[0])} y1={f1(A[1])} x2={f1(D[0])} y2={f1(D[1])} stroke={g(255 * p.alb * 0.95 * pl * dark)} strokeWidth={1.6} />,
      );
    const dx = p.x - eye[0];
    const dy = p.y - eye[1];
    raised.push({ d2: dx * dx + dy * dy, els });
  }
  raised.sort((a, b) => b.d2 - a.d2);

  // ---- camera life: gate weave + one low shake on the lock ----
  const gw = Math.floor(frame / 2);
  const weaveX = (rand(gw * 3.1) - 0.5) * 2;
  const weaveY = (rand(gw * 7.7 + 2) - 0.5) * 1.5;
  const sk = frame - T.lock;
  const shakeAmp = sk >= 0 && sk < 10 ? 4 * Math.exp(-sk / 2.8) : 0;
  const shY = shakeAmp * Math.sin(sk * 1.9);
  const shX = shakeAmp * 0.35 * Math.sin(sk * 1.3 + 1);

  // ---- type ----
  const titleOn = frame < T.exit;
  const w1 = interpolate(frame, [T.word1, T.word1 + 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const w2 = interpolate(frame, [T.word2, T.word2 + 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const ruleW = interpolate(frame, [T.rule, T.rule + 8], [0, 132], { ...clamp, easing: Easing.out(Easing.cubic) });
  const label: React.CSSProperties = {
    position: "absolute",
    fontFamily: FONT_MONO,
    fontWeight: 500,
    fontSize: 24,
    letterSpacing: "0.22em",
    color: K.grey,
    whiteSpace: "pre",
  };
  const seed = frame % 24;
  // readout: the array's max extension, ticking with the machine
  let maxH = 0;
  for (let i = 0; i < hs.length; i++) if (hs[i] > maxH) maxH = hs[i];
  const readout = `Z+${String(Math.round(maxH)).padStart(3, "0")}`;

  return (
    <AbsoluteFill>
      {!clear && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
          <defs>
            {grainDefs(seed)}
            <radialGradient id="pvig" cx="50%" cy="40%" r="75%">
              <stop offset="45%" stopColor="#000" stopOpacity={0} />
              <stop offset="100%" stopColor="#000" stopOpacity={0.62} />
            </radialGradient>
            {exiting && (
              <mask id="pmask" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
                <g transform={`translate(${f1(weaveX + shX)} ${f1(weaveY + shY)})`}>
                  <path d={sockets.join("")} fill="#fff" />
                </g>
              </mask>
            )}
          </defs>
          <g mask={exiting ? "url(#pmask)" : undefined} style={{ isolation: "isolate" }}>
            {!exiting && <rect width={W} height={H} fill={K.gap} />}
            <g transform={`translate(${f1(weaveX + shX)} ${f1(weaveY + shY)})`}>
              {exiting && <path d={sockets.join("")} fill={K.gap} />}
              {[...flushPaths.entries()].map(([v, ds]) => (
                <path key={v} d={ds.join("")} fill={g(v)} />
              ))}
              {raised.map((r, i) => (
                <g key={i}>{r.els}</g>
              ))}
            </g>
            <rect width={W} height={H} fill="url(#pvig)" />
            <rect width={W} height={H} filter={`url(#pg-${seed})`} style={{ mixBlendMode: "screen" }} opacity={0.15} />
            <rect width={W} height={H} filter={`url(#pd-${seed})`} style={{ mixBlendMode: "multiply" }} opacity={0.32} />
          </g>
        </svg>
      )}

      {titleOn && (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              width: W,
              top: 1150,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 58,
                lineHeight: 1,
                letterSpacing: "0.16em",
                paddingLeft: "0.16em",
                color: K.paper,
                textShadow: "0 0 10px rgba(250,246,246,0.16)",
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
            <div style={{ marginTop: 34, height: 4, width: ruleW, backgroundColor: K.accent }} />
            <div style={{ ...label, position: "relative", marginTop: 26, fontSize: 28, color: K.paper, opacity: 0.86, minHeight: 34 }}>
              {typed("WITH DENZO — TUESDAY", frame, T.host, 2)}
            </div>
          </div>
          <div style={{ ...label, left: 64, top: 112 }}>{typed("WATERHOUSE STUDIOS", frame, 8)}</div>
          <div style={{ ...label, right: 1080 - 950, top: 112, textAlign: "right" }}>{frame >= 8 ? readout : ""}</div>
        </>
      )}

      {/* ---- sound: machine, low and dry ---- */}
      <Sequence durationInFrames={T.clear} layout="none">
        <Audio
          src={staticFile("ident/audio/pinscreen/drone.wav")}
          volume={(f) => interpolate(f, [0, 12, T.exit, T.clear], [0, 0.7, 0.7, 0], clamp)}
        />
      </Sequence>
      <Sequence layout="none">
        <Audio src={staticFile("audio/bumper/hum.wav")} volume={0.18} playbackRate={0.6} />
      </Sequence>
      <Sequence from={T.rippleStart} layout="none">
        <Audio src={staticFile("ident/audio/pinscreen/servo.wav")} volume={0.55} />
      </Sequence>
      {[T.step1, T.step2].map((s, i) => (
        <Sequence key={s} from={s} layout="none">
          <Audio src={staticFile("ident/audio/pinscreen/step.wav")} volume={0.7} playbackRate={1 - i * 0.06} />
        </Sequence>
      ))}
      <Sequence from={T.crop} layout="none">
        <Audio src={staticFile("ident/audio/pinscreen/servo.wav")} volume={0.35} playbackRate={0.8} />
        <Audio src={staticFile("ident/audio/pinscreen/step.wav")} volume={0.6} playbackRate={0.85} />
        <Audio src={staticFile("ident/audio/pinscreen/boom.wav")} volume={0.45} playbackRate={1.1} />
      </Sequence>
      <Sequence from={T.flush} layout="none">
        <Audio src={staticFile("ident/audio/pinscreen/retract.wav")} volume={0.75} />
      </Sequence>
      {/* clatter's hard lock sits 0.50 s in: start it so the lock lands on T.lock */}
      <Sequence from={T.lock - 15} layout="none">
        <Audio src={staticFile("ident/audio/pinscreen/clatter.wav")} volume={0.8} />
      </Sequence>
      <Sequence from={T.lock} layout="none">
        <Audio src={staticFile("ident/audio/pinscreen/boom.wav")} volume={1} />
      </Sequence>
      {T.slat.map((s, i) => (
        <Sequence key={s} from={s} layout="none">
          <Audio src={staticFile("ident/audio/pinscreen/step.wav")} volume={0.32} playbackRate={1.1 + i * 0.05} />
        </Sequence>
      ))}
      {[0, 6].map((d) => (
        <Sequence key={d} from={8 + d} layout="none">
          <Audio src={staticFile("audio/bumper/led-click.wav")} volume={0.08} playbackRate={0.7} />
        </Sequence>
      ))}
      <Sequence from={T.exit} layout="none">
        <Audio src={staticFile("ident/audio/pinscreen/drop.wav")} volume={0.85} />
        <Audio src={staticFile("ident/audio/pinscreen/retract.wav")} volume={0.4} playbackRate={1.2} />
        <Audio src={staticFile("ident/audio/pinscreen/boom.wav")} volume={0.7} playbackRate={0.85} />
      </Sequence>
    </AbsoluteFill>
  );
};
