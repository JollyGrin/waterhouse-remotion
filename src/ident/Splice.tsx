import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LogoPiece, LOGO_ORDER, LOGO_PATHS, W, rand } from "./brand";
import { Grain } from "./common";
import { THETA, THETA_SUB } from "./splice/motion";

/**
 * SPLICE: the first half of SCOPE, hard-cut on the big kick into the second half of PLATTER.
 *
 * The oscilloscope beam powers on, rides the kicks, folds into a Lissajous and pulls the mark out
 * of it. On the kick where Scope's mark would lock, the picture cuts to the record, caught dead on
 * the drop, with the mark printed on the label in exactly the same place, scale and angle. The
 * beam's outline is traced on the label's projected print, so the eye reads one continuous mark that
 * changes material from phosphor to ink; the phosphor afterglow burns over the label for 4 frames.
 * Then Platter plays out: scratches on the beat, the title on the held record, release, the
 * power-off brake, and the grooves part into rings to the content.
 *
 * Timeline (30 fps, 120 bpm, beat = 15 f):
 *   f  0– 54  Scope, at Scope time s = sOf(f): power-on compressed into f 0–6, then s = f + 5
 *             (kicks f 10 / 25 / 40, fold f 28–42, the pieces pulled out f 40–54)
 *   f 55      CUT on the big kick (Scope s 60 = Platter p 45, the catch)
 *   f 55–149  Platter, at Platter time p = f − 10 (the catch holds dead f 55–62 under the afterglow,
 *             scratches f 62–85, title 85, release 100,
 *             brake 107, rings 116, clear from 140)
 * One soundtrack (src/ident/splice/gen-audio.py): the XY beam bed up to the cut, then the decks, with the
 * record read at exactly the angle on screen (src/ident/splice/motion.ts).
 */
export const SPLICE_FRAMES = 150;
const CUT = 55;
const P_OFF = 10;
const sOf = (f: number) => (f < 6 ? 1 + (f * 10) / 6 : f + 5);
const GLOW_FRAMES = [0.9, 0.5, 0.24, 0.1]; // phosphor afterglow over the label, frames after the cut

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
type Pt = [number, number];

// ================================================================================================
// PLATTER (second half), copied from src/ident/Platter.tsx
// ================================================================================================
const T = {
  lock: 45,
  hold: 75,
  word2: 78,
  rule: 82,
  host: 86,
  release: 90,
  brake: 97,
  rings: 106,
  clear: 130,
};
const KICKS_BIG = [T.lock, T.hold];
const KICKS = [60, T.release];
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);

const D = 2800;
const PC = D / 2;
const RR = 1320;
const LR = 440;
const SPINDLE = 30;
const LOGO_S = 0.6;
const PERSP = 1800;

type PLayout = {
  W: number;
  H: number;
  cx: [number, number];
  cy: [number, number];
  z: [number, number];
  tilt: [number, number];
  yaw: [number, number];
  reach: number;
  steadyMask: boolean;
  shaft: { left: number; top: number; w: number; h: number; rot: number };
  motesH: number;
  vig: { cx: string; cy: string; r: string };
  labels: { x0: number; x1: number; y: number };
  title: { x: number; y1: number; y2: number; rule: number; host: number; anchor: "middle" | "start"; size: number; len: number; hostSize: number };
};
const P_PORTRAIT: PLayout = {
  W,
  H,
  cx: [800, 540],
  cy: [770, 700],
  z: [260, 0],
  tilt: [64, 7],
  yaw: [-18, 0],
  reach: 1450,
  steadyMask: false,
  shaft: { left: -400, top: -300, w: 900, h: 2600, rot: -28 },
  motesH: 1300,
  vig: { cx: "50%", cy: "42%", r: "78%" },
  labels: { x0: 92, x1: W - 140, y: 150 },
  title: { x: W / 2, y1: 1268, y2: 1378, rule: 1414, host: 1470, anchor: "middle", size: 96, len: 820, hostSize: 30 },
};
const P_WIDE: PLayout = {
  W: 1920,
  H: 1080,
  cx: [1000, 560],
  cy: [520, 540],
  z: [160, -360],
  tilt: [64, 7],
  yaw: [-18, 0],
  reach: 1750,
  steadyMask: true,
  shaft: { left: -300, top: -500, w: 1000, h: 2400, rot: -40 },
  motesH: 1080,
  vig: { cx: "36%", cy: "50%", r: "75%" },
  labels: { x0: 96, x1: 1920 - 96, y: 92 },
  title: { x: 1100, y1: 486, y2: 596, rule: 632, host: 688, anchor: "start", size: 96, len: 724, hostSize: 28 },
};

const VINYL = "#0b0b0b";
const PAPER = "#d6d0c4";
const INK = "#121110";

// rotation, indexed by SPLICE frame
const theta = (f: number) => {
  const x = Math.min(Math.max(f * THETA_SUB, 0), THETA.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  return THETA[i] + (THETA[Math.min(i + 1, THETA.length - 1)] - THETA[i]) * t;
};
const SHUTTER = 0.75;

const light = (p: number) => interpolate(p, [T.brake, T.brake + 26], [1, 0.42], { ...clamp, easing: easeIO });
const sheenAngle = (p: number) => interpolate(p, [0, 44, 140], [8, -58, -66], { ...clamp, easing: easeIO });
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const lobe = (a: number, phi: number, w = 13) => {
  const d1 = wrap(a - phi);
  const d2 = wrap(a - phi - 180);
  return Math.max(Math.exp(-((d1 / w) ** 2)), Math.exp(-((d2 / w) ** 2)));
};

// the camera from the catch on (settled). The jolt of the catch kick lands one frame after the cut,
// so the cut frame itself is an exact match.
const camera = (p: number, lay: PLayout) => {
  const tilt = lay.tilt[1] + interpolate(p, [45, 100, 130], [0, -3, -6], clamp);
  const z = lay.z[1] + interpolate(p, [96, 130], [0, 70], { ...clamp, easing: Easing.in(Easing.quad) });
  let dy = 0;
  for (const k of [...KICKS_BIG, ...KICKS]) {
    const t = p - k - (k === T.lock ? 1 : 0);
    if (t < 0 || t > 8) continue;
    const a = (KICKS_BIG.includes(k) ? 7 : 2.5) * Math.exp(-t / 2);
    dy += t === 0 ? a : a * Math.cos(t * 1.7) * 0.6;
  }
  return { tilt, cx: lay.cx[1], cy: lay.cy[1] + dy, z, yaw: lay.yaw[1] };
};

/** Where a point on the record plane (relative to the spindle, unrotated) lands on screen at the cut. */
const project = (lay: PLayout, dx: number, dy: number): Pt => {
  const c = camera(T.lock, lay);
  const a = (c.tilt * Math.PI) / 180;
  const y1 = dy * Math.cos(a);
  const z1 = dy * Math.sin(a) + c.z;
  const s = PERSP / (PERSP - z1);
  return [lay.W / 2 + (c.cx + dx - lay.W / 2) * s, lay.H / 2 + (c.cy + y1 - lay.H / 2) * s];
};
/** A point of the mark (logo units, 1000 × 666) as printed on the label, on screen at the cut. */
const printToScreen = (lay: PLayout, [lx, ly]: Pt): Pt => project(lay, (lx - 500) * LOGO_S, (ly - 333) * LOGO_S);

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

const RIM_TEXT =
  "WATERHOUSE SESSIONS  ·  SIDE A  ·  33⅓ RPM  ·  STEREO  ·  WH-001  ·  AMSTERDAM  ·  WITH DENZO  ·  ";

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
          <textPath href="#sp-rim" textLength={2 * Math.PI * 388 - 8} lengthAdjust="spacing">
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

const PlatterPart: React.FC<{ lay: PLayout; f: number }> = ({ lay, f }) => {
  const { W, H } = lay;
  const p = f - P_OFF;
  const cam = camera(p, lay);
  const L = light(p);
  const phi = sheenAngle(p);
  const th = theta(f);
  const thA = theta(f - SHUTTER / 2);
  const thB = theta(f + SHUTTER / 2);
  const smear = Math.abs(thB - thA);
  const n = Math.max(1, Math.min(44, Math.ceil(smear / 1.5)));
  const copyA = n === 1 ? 1 : 1 - Math.pow(1 - 0.96, 1 / n);
  const copies = Array.from({ length: n }, (_, i) => (n === 1 ? th : theta(f - SHUTTER / 2 + (SHUTTER * (i + 0.5)) / n)));
  const textO = Math.min(1, Math.max(0, (4.2 - smear) / 3));
  const seed = Math.floor(f / 2) % 12;

  const pcx = W / 2 + (cam.cx - W / 2) * (PERSP / (PERSP - cam.z));
  const pcy = H / 2 + (cam.cy - H / 2) * (PERSP / (PERSP - cam.z));
  let mask = "none";
  if (p >= T.rings) {
    const BW = 54;
    const REACH = lay.reach;
    const DUR = 18;
    const stops: string[] = [];
    for (let k = 0; k * BW < REACH; k++) {
      const r0 = k * BW;
      const tk = T.rings + DUR * Math.pow(r0 / REACH, 1 / 1.6);
      const o = Easing.in(Easing.cubic)(Math.min(1, Math.max(0, (p - tk) / 6)));
      if (o <= 0) continue;
      const a = r0 + ((1 - o) * BW) / 2;
      const b = r0 + ((1 + o) * BW) / 2;
      stops.push(`#000 ${a.toFixed(1)}px`, `transparent ${(a + 0.8).toFixed(1)}px`, `transparent ${b.toFixed(1)}px`, `#000 ${(b + 0.8).toFixed(1)}px`);
    }
    if (stops.length) mask = `radial-gradient(circle at ${pcx.toFixed(1)}px ${pcy.toFixed(1)}px, #000 0px, ${stops.join(", ")})`;
  }
  if (p >= T.clear) return null;

  const gx = (rand(f * 1.7) - 0.5) * 2;
  const gy = (rand(f * 2.9 + 4) - 0.5) * 2;

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
  const labelsCol = "rgba(150,148,142,0.85)";

  return (
    <MaskFrame mask={mask} weave={[gx, gy]} steady={lay.steadyMask}>
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
            transform: `translateZ(${cam.z}px) rotateX(${cam.tilt}deg) rotateZ(${cam.yaw}deg)`,
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
              WebkitMaskImage:
                "radial-gradient(circle at 50% 50%, transparent 742px, #000 744px, #000 753px, transparent 755px, transparent 989px, #000 991px, #000 999px, transparent 1001px, transparent 1262px, #000 1265px, #000 1298px, transparent 1300px)",
              maskImage:
                "radial-gradient(circle at 50% 50%, transparent 742px, #000 744px, #000 753px, transparent 755px, transparent 989px, #000 991px, #000 999px, transparent 1001px, transparent 1262px, #000 1265px, #000 1298px, transparent 1300px)",
              background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.25 * L)})`,
            }}
          />

          <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <defs>
              <path id="sp-rim" d={`M ${PC - 388} ${PC} A 388 388 0 1 1 ${PC + 388} ${PC} A 388 388 0 1 1 ${PC - 388} ${PC}`} />
              <filter id="sp-paper" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={3} seed={11} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="sp-fibres" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves={3} seed={4} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="sp-wear" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={21} />
                <feColorMatrix type="matrix" values={`0 0 0 0 0.84  0 0 0 0 0.81  0 0 0 0 0.77  14 0 0 0 -9.4`} />
              </filter>
              <clipPath id="sp-labelClip">
                <circle cx={PC} cy={PC} r={LR} />
              </clipPath>
              <radialGradient id="sp-labelLight" cx="30%" cy="24%" r="90%">
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
                return (
                  <path key={`c${i}`} d={`M${x0} ${y0} l${Math.sin(dir) * c.len} ${-Math.cos(dir) * c.len}`} stroke="#e8e4dc" strokeWidth={1} opacity={op} />
                );
              })}
              {DUST.map((d, i) => {
                const op = (0.025 + 0.8 * lobe(d.a + th, phi, 14)) * L;
                return <path key={`d${i}`} d={arcPath(d.r, d.a + thA, d.a + thB)} stroke="#efebe3" strokeWidth={d.s} opacity={op} />;
              })}
            </g>

            <g clipPath="url(#sp-labelClip)">
              <circle cx={PC} cy={PC} r={LR} fill={PAPER} />
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#sp-paper)" opacity={0.16} style={{ mixBlendMode: "multiply" }} />
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#sp-fibres)" opacity={0.1} style={{ mixBlendMode: "multiply" }} />
              </g>
              {copies.map((a, i) => (
                <g key={i} transform={`rotate(${a} ${PC} ${PC})`}>
                  <Ink textO={textO} opacity={copyA} />
                </g>
              ))}
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#sp-wear)" />
                <g fill="none" stroke="#3b3833" strokeWidth={1.2} opacity={0.5}>
                  {SPINDLE_MARKS.map((m, i) => {
                    const [x0, y0] = polar(SPINDLE + 3, m.a);
                    const [x1, y1] = polar(SPINDLE + 3 + m.len, m.a + m.bend);
                    const [qx, qy] = polar(SPINDLE + 3 + m.len * 0.5, m.a + m.bend * 1.6);
                    return <path key={i} d={`M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}`} />;
                  })}
                </g>
              </g>
              <circle cx={PC} cy={PC} r={LR} fill="url(#sp-labelLight)" />
              <circle cx={PC} cy={PC} r={LR} fill="#000" opacity={1 - (0.18 + 0.82 * L)} />
            </g>
            <circle cx={PC} cy={PC} r={LR} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3} />
            <circle cx={PC} cy={PC} r={SPINDLE} fill="#060606" />
            <circle cx={PC} cy={PC} r={SPINDLE - 9} fill="#2a2a2a" />
            <circle cx={PC - 5} cy={PC - 6} r={6} fill="#8a8a86" opacity={0.35 * L} />
          </svg>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ mixBlendMode: "screen", opacity: L }}>
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
          <filter id={`sp-pgrain${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed * 5 + 3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <radialGradient id="sp-pvig" cx={lay.vig.cx} cy={lay.vig.cy} r={lay.vig.r}>
            <stop offset="50%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.88} />
          </radialGradient>
        </defs>
        {Array.from({ length: 46 }, (_, i) => {
          const x = (rand(i * 3.1) * W + f * (0.3 + rand(i) * 0.5)) % W;
          const y = (rand(i * 5.7) * lay.motesH - f * (0.2 + rand(i * 2) * 0.5) + lay.motesH) % lay.motesH;
          return <rect key={i} x={x} y={y} width={2 + rand(i * 4) * 2} height={2 + rand(i * 4) * 2} fill={C.paper} opacity={L * 0.25 * rand(i * 6.3)} />;
        })}
        <rect width={W} height={H} fill="url(#sp-pvig)" />
        <rect width={W} height={H} filter={`url(#sp-pgrain${seed})`} opacity={0.075} style={{ mixBlendMode: "screen" }} />
        <rect width={W} height={H} filter={`url(#sp-pgrain${seed})`} opacity={0.12} style={{ mixBlendMode: "multiply" }} />

        <g style={{ fontFamily: FONT_MONO }} fontWeight={500} fill={labelsCol}>
          <text x={lay.labels.x0} y={lay.labels.y} fontSize={24} letterSpacing={6}>
            WATERHOUSE STUDIOS
          </text>
          <text x={lay.labels.x1} y={lay.labels.y} fontSize={24} letterSpacing={6} textAnchor="end">
            SIDE A · 33⅓
          </text>
        </g>
        {p >= T.hold ? (
          <g fill={C.paper} style={{ fontFamily: FONT_DISPLAY }} fontSize={lay.title.size} textAnchor={lay.title.anchor}>
            <text x={lay.title.x} y={lay.title.y1} textLength={lay.title.len} lengthAdjust="spacing">
              WATERHOUSE
            </text>
            {p >= T.word2 ? (
              <text x={lay.title.x} y={lay.title.y2} textLength={lay.title.len} lengthAdjust="spacing">
                SESSIONS
              </text>
            ) : null}
          </g>
        ) : null}
        {p >= T.rule ? <rect x={lay.title.anchor === "middle" ? lay.title.x - 64 : lay.title.x} y={lay.title.rule} width={128} height={5} fill={C.yellow} /> : null}
        {p >= T.host ? (
          <text x={lay.title.x} y={lay.title.host} fontSize={lay.title.hostSize} letterSpacing={10} fill="#a3a19b" textAnchor={lay.title.anchor} style={{ fontFamily: FONT_MONO }} fontWeight={500}>
            WITH DENZO · TUESDAY
          </text>
        ) : null}
      </svg>
    </MaskFrame>
  );
};

// ================================================================================================
// SCOPE (first half), copied from src/ident/Scope.tsx; the mark is traced on the label's projected print
// ================================================================================================
const ON = 2;
const LINE = [5, 10];
const S_KICKS = [15, 30, 45];
const FOLD = [33, 47];
// the pieces lock a beat-fraction earlier than in Scope, so the last frame before the cut is the clean mark
const MORPH: Record<LogoPiece, [number, number]> = {
  house: [45, 53],
  slatA: [47, 55],
  slatB: [49, 57],
  door: [51, 58],
};
const S_LOCK = 60; // = the cut
const heavy = Easing.bezier(0.65, 0, 0.25, 1);

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

type SLayout = {
  w: number;
  h: number;
  OX: number; // beam origin: the dot, the line, the waveform's centre
  OY: number;
  LCX: number; // Lissajous centre = the mark's centre (the record's spindle)
  LCY: number;
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
};

const makeScope = (wide: boolean, plat: PLayout): SLayout => {
  const w = plat.W;
  const h = plat.H;
  const [mx, my] = printToScreen(plat, [500, 333]);
  const LOGO_PTS: Pt[] = LOGO_ORDER.flatMap((p, i) => sampleLoop(POLY[p], COUNTS[i]).map((q) => printToScreen(plat, q)));
  const CORNERS = LOGO_ORDER.flatMap((piece) => POLY[piece].map((q) => ({ p: printToScreen(plat, q), piece })));
  const grat = wide
    ? { x0: w / 2 - 7 * 105, y0: h / 2 - 4 * 105, div: 105, cols: 14, rows: 8 }
    : { x0: 60, y0: 220, div: 120, cols: 8, rows: 10 };
  return {
    w,
    h,
    OX: wide ? w / 2 : mx,
    OY: my,
    LCX: mx,
    LCY: my,
    SX0: grat.x0,
    SX1: grat.x0 + grat.cols * grat.div,
    LX: wide ? 400 : 380,
    LY: wide ? 300 : 290,
    grat,
    LOGO_PTS,
    CORNERS,
    ro: wide ? { l: 96, r: w - 96, t1: 50, t2: 86, b: 1000 } : { l: 60, r: 950, t1: 96, t2: 134, b: 1420 },
    glassBg: wide
      ? "radial-gradient(ellipse 70% 85% at 50% 48%, #0e1116 0%, #07080b 55%, #020203 100%)"
      : "radial-gradient(ellipse 85% 60% at 50% 38%, #0e1116 0%, #07080b 55%, #020203 100%)",
    vignette: wide
      ? "linear-gradient(112deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 90% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.65) 100%)"
      : "linear-gradient(118deg, transparent 18%, rgba(255,255,255,0.025) 30%, transparent 44%), radial-gradient(ellipse 120% 90% at 50% 40%, transparent 55%, rgba(0,0,0,0.65) 100%)",
  };
};
const S_PORTRAIT = makeScope(false, P_PORTRAIT);
const S_WIDE = makeScope(true, P_WIDE);

const decay = (t: number, tau: number) => (t < 0 ? 0 : Math.exp(-t / tau));
const kickShape = (u: number) => {
  const t = (u - 0.07) * 0.34;
  if (t < 0) return 0;
  const ph = 2 * Math.PI * (48 * t + (165 - 48) * 0.035 * (1 - Math.exp(-t / 0.035)));
  return Math.sin(ph) * Math.exp(-t / 0.085);
};
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

const trace = (L: SLayout, s: number): { pts: Pt[]; w: Record<LogoPiece, number> } => {
  const { OX, OY, LCX, LCY, SX0, SX1, LX, LY, LOGO_PTS } = L;
  const open = interpolate(s, LINE, [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const amp = 250 * Math.max(decay(s - 15, 6.5), decay(s - 30, 6.5) * 1.1);
  const fold = interpolate(s, FOLD, [0, 1], { ...clamp, easing: heavy });
  const lisAmp = 1 + 0.16 * decay(s - 45, 4);
  const phi = (s - FOLD[0]) * 0.16;
  const w = Object.fromEntries(
    LOGO_ORDER.map((p) => [p, interpolate(s, MORPH[p], [0, 1], { ...clamp, easing: heavy })]),
  ) as Record<LogoPiece, number>;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    let p: Pt;
    if (fold < 1) {
      const hum = 5 * Math.sin(2 * Math.PI * u * 12 + s * 0.7) + (rand(i * 1.37 + s * 97.1) - 0.5) * 2.2;
      p = [OX + (SX0 + (SX1 - SX0) * u - OX) * open, OY - (amp * kickShape(u) + hum) * open];
    } else p = [0, 0];
    if (fold > 0) {
      const th = u * 2 * Math.PI;
      const lis: Pt = [LCX + LX * lisAmp * Math.sin(3 * th + phi), LCY + LY * lisAmp * Math.sin(2 * th)];
      p = fold < 1 ? lerp(p, lis, fold) : lis;
      const tw = 4 * fold * (1 - fold) * 0.7;
      if (tw > 0) {
        const [dx, dy] = [p[0] - LCX, p[1] - LCY];
        p = [LCX + dx * Math.cos(tw) - dy * Math.sin(tw), LCY + dx * Math.sin(tw) + dy * Math.cos(tw)];
      }
    }
    const wk = w[PIECE_OF[i]];
    if (wk > 0) {
      p = lerp(p, LOGO_PTS[i], wk);
      const sm = 4 * wk * (1 - wk);
      p = [p[0] + sm * 34 * Math.sin(u * 2 * Math.PI * 23 + s * 0.9), p[1] + sm * 34 * Math.cos(u * 2 * Math.PI * 17 - s * 0.7)];
    }
    pts.push(p);
  }
  return { pts, w };
};

const pathOf = (pts: Pt[]) => (pts.length ? "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") : "");

const beam = (L: SLayout, s: number) => {
  const { pts, w } = trace(L, s);
  const paths: { d: string; a: number }[] = [];
  LOGO_ORDER.forEach((piece, k) => {
    const seg = pts.slice(STARTS[k], STARTS[k] + COUNTS[k]);
    paths.push({ d: pathOf(seg), a: 1 });
    if (k < LOGO_ORDER.length - 1) {
      const nxt = pts[STARTS[k + 1]];
      const lock = Math.min(w[piece], w[LOGO_ORDER[k + 1]]);
      paths.push({ d: pathOf([seg[seg.length - 1], nxt]), a: 1 - lock * 0.94 });
    }
  });
  const corners = L.CORNERS.map(({ p, piece }) => ({ p, a: w[piece] }));
  return { paths, corners };
};

const Graticule: React.FC<{ L: SLayout }> = ({ L }) => {
  const { OX, OY } = L;
  const { x0, y0, div, cols, rows } = L.grat;
  const x1 = x0 + cols * div;
  const lines: React.ReactNode[] = [];
  for (let i = 0; i <= cols; i++) lines.push(<line key={`v${i}`} x1={x0 + i * div} y1={y0} x2={x0 + i * div} y2={y0 + rows * div} />);
  for (let j = 0; j <= rows; j++) lines.push(<line key={`h${j}`} x1={x0} y1={y0 + j * div} x2={x1} y2={y0 + j * div} />);
  const tick = div / 5;
  for (let t = 0; t <= cols * 5; t++) {
    const x = x0 + t * tick;
    lines.push(<line key={`tx${t}`} x1={x} y1={OY - 7} x2={x} y2={OY + 7} />);
  }
  for (let t = 0; t <= rows * 5; t++) {
    const y = y0 + t * tick;
    lines.push(<line key={`ty${t}`} x1={OX - 7} y1={y} x2={OX + 7} y2={y} />);
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

type Beam = ReturnType<typeof beam>;
/** The beam drawn as light: halo, persistence trails, glow, core, hot corners. */
const BeamSvg: React.FC<{ L: SLayout; now: Beam; trails: { k: number; b: Beam }[]; g: number; id: string }> = ({ L, now, trails, g, id }) => {
  const TRAIL_A = [0, 0.42, 0.22, 0.11, 0.05];
  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <filter id={`${id}-halo`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={20} />
        </filter>
        <filter id={`${id}-glow`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={4.5} />
        </filter>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g filter={`url(#${id}-halo)`} stroke={HALO} strokeWidth={14} opacity={Math.min(1, 0.5 * g)}>
          {now.paths.map((p, i) => (
            <path key={i} d={p.d} strokeOpacity={p.a} />
          ))}
        </g>
        {trails.map(({ k, b }) => (
          <g key={k} stroke={GLOW} strokeWidth={3} opacity={TRAIL_A[k] * Math.min(1, g)}>
            {b.paths.map((p, i) => (
              <path key={i} d={p.d} strokeOpacity={p.a} />
            ))}
          </g>
        ))}
        <g filter={`url(#${id}-glow)`} stroke={GLOW} strokeWidth={7} opacity={Math.min(1, 0.88 * g)}>
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
        {now.corners.map((c, i) =>
          c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={4.2} opacity={c.a * 0.9 * Math.min(1, g)} /> : null,
        )}
      </g>
      <g fill={GLOW} filter={`url(#${id}-glow)`}>
        {now.corners.map((c, i) =>
          c.a > 0.02 ? <circle key={i} cx={c.p[0]} cy={c.p[1]} r={9} opacity={c.a * 0.55 * Math.min(1, g)} /> : null,
        )}
      </g>
    </svg>
  );
};

const Readout: React.FC<{ L: SLayout; x: number; y: number; align?: "left" | "right"; children: React.ReactNode; o?: number }> = ({
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

const ScopePart: React.FC<{ L: SLayout; f: number }> = ({ L, f }) => {
  const s = sOf(f);
  const { OX, OY, ro } = L;
  const glass = interpolate(s, [0, 14], [0, 1], clamp);
  const ui = s >= 11 ? (s < 13 ? 0.45 : 1) : 0;
  const mode = s < FOLD[0] ? "Y–T   50ms/DIV" : s < S_LOCK - 6 ? "X–Y   3:2" : "X–Y   SYNC";
  const trig = S_KICKS.some((k) => s - k >= 0 && s - k < 4);
  // the beam heats up into the lock, so the cut lands on its brightest frame
  const gain = s < LINE[1] ? 1.25 : 1 + 0.3 * interpolate(s, [52, 59], [0, 1], clamp);
  const now = beam(L, s);
  const trails = [1, 2, 3, 4].filter((k) => s - k >= LINE[0]).map((k) => ({ k, b: beam(L, s - k) }));
  const flick = 0.95 + rand(f * 2.3) * 0.05;

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#000" }} />
      <AbsoluteFill style={{ opacity: glass, background: L.glassBg }} />
      <AbsoluteFill style={{ opacity: glass }}>
        <Graticule L={L} />
      </AbsoluteFill>
      {s >= ON && s < LINE[0] + 2 ? (
        <svg width={L.w} height={L.h} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="sp-dotglow">
              <feGaussianBlur stdDeviation={10} />
            </filter>
          </defs>
          <circle cx={OX} cy={OY} r={interpolate(s, [ON, ON + 2], [10, 22], clamp)} fill={GLOW} opacity={0.8} filter="url(#sp-dotglow)" />
          <circle cx={OX} cy={OY} r={5} fill="#fff" />
        </svg>
      ) : null}
      {s >= LINE[0] ? <BeamSvg L={L} now={now} trails={trails} g={gain * flick} id="sp-b" /> : null}

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

/** The locked phosphor mark burning over the label for a few frames after the cut. */
const Afterglow: React.FC<{ L: SLayout; k: number }> = ({ L, k }) => {
  const a = GLOW_FRAMES[k] ?? 0;
  if (a <= 0) return null;
  const now = beam(L, S_LOCK);
  // the burn-in shrinks to the lines as it cools: no retrace, no halo after the first frame
  const lines = { ...now, paths: now.paths.filter((p) => p.a > 0.5) };
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity: a }}>
      <BeamSvg L={L} now={lines} trails={[]} g={k === 0 ? 1.4 : 1} id={`sp-ag${k}`} />
    </AbsoluteFill>
  );
};

const SpliceView: React.FC<{ wide: boolean }> = ({ wide }) => {
  const f = useCurrentFrame();
  const S = wide ? S_WIDE : S_PORTRAIT;
  const P = wide ? P_WIDE : P_PORTRAIT;
  return (
    <AbsoluteFill>
      <Audio src={staticFile("ident/audio/splice/mix.wav")} volume={0.9} />
      {f < CUT ? <ScopePart L={S} f={f} /> : <PlatterPart lay={P} f={f} />}
      {f >= CUT && f < CUT + GLOW_FRAMES.length && f - P_OFF < T.clear ? <Afterglow L={S} k={f - CUT} /> : null}
    </AbsoluteFill>
  );
};

/** 1080×1920 (Shorts). */
export const Splice: React.FC = () => <SpliceView wide={false} />;
/** 1920×1080 (stream / YouTube). Same timeline and soundtrack. */
export const SpliceWide: React.FC = () => <SpliceView wide />;
