import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, W, rand } from "./brand";
import { THETA, THETA_SUB } from "./platter/motion";

/**
 * PLATTER: the DJ's world. A black record, very close, under one booth light; the mark is
 * printed on the label. Needle drop and crackle as the camera rises off the groove; the DJ
 * stops the record on the kick, spins it back (the mark smears into rings) and catches it dead
 * upright on the drop. Baby scratches, a transformed drag and chirps pull the mark back and
 * forth on the beat (smear, stutter, snap), then the record is held still while the title cuts
 * in. Release, the power-off brake drags the pitch down, and the grooves part into rings that
 * open, centre out, to the content.
 *
 * The rotation curve and the soundtrack come from one script (src/ident/platter/gen-audio.py), so the
 * scratch audio is the record being read at exactly the angle on screen.
 * Grid: 120 bpm, beat = 15 f.
 */
export const PLATTER_FRAMES = 140;

const T = {
  needle: 2,
  lightIn: 3,
  lightFull: 11,
  stop: 30,
  lock: 45,
  hold: 75,
  word2: 78,
  rule: 82,
  host: 86,
  release: 90,
  brake: 97,
  rings: 106,
  clear: 130, // fully transparent from here
};
const KICKS_BIG = [T.lock, T.hold];
const KICKS = [15, T.stop, 60, T.release];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);

// ---- record geometry (record-plane px) ----
const D = 2800; // plane size
const PC = D / 2; // plane centre
const RR = 1320; // record radius
const LR = 440; // label radius
const SPINDLE = 30;
const LOGO_S = 0.6; // logo on the label: 600 px wide, its gap (500,333) sits on the spindle
const PERSP = 1800;

// ---- layout: everything that depends on the frame shape ----
type Layout = {
  W: number;
  H: number;
  // camera rise: [start, settled] for each axis (plane centre on screen, push, tilt, yaw)
  cx: [number, number];
  cy: [number, number];
  z: [number, number];
  tilt: [number, number];
  yaw: [number, number];
  reach: number; // exit rings: radius they must reach to clear the frame
  steadyMask: boolean; // exit mask on a non-weaving outer box, so the sub-pixel gate weave never softens the frame edges
  shaft: { left: number; top: number; w: number; h: number; rot: number };
  motesH: number;
  vig: { cx: string; cy: string; r: string };
  labels: { x0: number; x1: number; y: number };
  title: { x: number; y1: number; y2: number; rule: number; host: number; anchor: "middle" | "start"; size: number; len: number; hostSize: number };
};
const PORTRAIT: Layout = {
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

// ---- palette ----
const VINYL = "#0b0b0b";
const PAPER = "#d6d0c4";
const INK = "#121110";

// ---- rotation (degrees, clockwise from above) ----
const theta = (u: number) => {
  const x = Math.min(Math.max(u * THETA_SUB, 0), THETA.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  return THETA[i] + (THETA[Math.min(i + 1, THETA.length - 1)] - THETA[i]) * t;
};
const SHUTTER = 0.75; // frames

// ---- light ----
const light = (f: number) =>
  interpolate(f, [T.lightIn, T.lightFull, T.brake, T.brake + 26], [0, 1, 1, 0.42], { ...clamp, easing: easeIO });

// sheen: the bowtie reflection of the booth light in the grooves, fixed to the light (plane angle, CSS conic convention)
const sheenAngle = (f: number) => interpolate(f, [0, 44, 140], [8, -58, -66], { ...clamp, easing: easeIO });
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const lobe = (a: number, phi: number, w = 13) => {
  const d1 = wrap(a - phi);
  const d2 = wrap(a - phi - 180);
  return Math.max(Math.exp(-((d1 / w) ** 2)), Math.exp(-((d2 / w) ** 2)));
};

// ---- camera ----
const camera = (f: number, lay: Layout) => {
  const e = interpolate(f, [0, 44], [0, 1], { ...clamp, easing: easeIO });
  const tilt = interpolate(e, [0, 1], lay.tilt) + interpolate(f, [45, 100, 130], [0, -3, -6], clamp);
  const cx = interpolate(e, [0, 1], lay.cx);
  const cy = interpolate(e, [0, 1], lay.cy);
  const z = interpolate(e, [0, 1], lay.z) + interpolate(f, [96, 130], [0, 70], { ...clamp, easing: Easing.in(Easing.quad) });
  const yaw = interpolate(e, [0, 1], lay.yaw);
  // weighty thump on the big kicks, a nudge on the small ones
  let dy = 0;
  for (const k of [...KICKS_BIG, ...KICKS]) {
    const t = f - k;
    if (t < 0 || t > 8) continue;
    const a = (KICKS_BIG.includes(k) ? 7 : 2.5) * Math.exp(-t / 2);
    dy += t === 0 ? a : a * Math.cos(t * 1.7) * 0.6;
  }
  return { tilt, cx, cy: cy + dy, z, yaw };
};

// ---- record surface detail (record coords: angle clockwise from up, radius) ----
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

// the printed ink on the label, in plane coords, unrotated
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
          <textPath href="#rim" textLength={2 * Math.PI * 388 - 8} lengthAdjust="spacing">
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
      // too fast to read: the print smears into grey bands
      <g fill="none" stroke={INK} opacity={1 - textO}>
        <circle cx={PC} cy={PC} r={395} strokeWidth={20} opacity={0.32} />
        <circle cx={PC} cy={PC} r={256} strokeWidth={14} opacity={0.1} />
        <circle cx={PC} cy={PC} r={290} strokeWidth={22} opacity={0.12} />
      </g>
    ) : null}
  </g>
);

// root: the exit mask plus the gate weave. Portrait keeps its original single box (mask moves with the weave).
const MaskFrame: React.FC<{ mask: string; weave: [number, number]; steady: boolean; children: React.ReactNode }> = ({ mask, weave, steady, children }) => {
  const tr = `translate(${weave[0]}px, ${weave[1]}px)`;
  if (!steady) return <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, transform: tr }}>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>
      <AbsoluteFill style={{ transform: tr }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const PlatterCore: React.FC<{ lay: Layout }> = ({ lay }) => {
  const { W, H } = lay;
  const f = useCurrentFrame();
  const cam = camera(f, lay);
  const L = light(f);
  const phi = sheenAngle(f); // plane-fixed light
  const th = theta(f);
  const thA = theta(f - SHUTTER / 2);
  const thB = theta(f + SHUTTER / 2);
  const smear = Math.abs(thB - thA);
  const n = Math.max(1, Math.min(44, Math.ceil(smear / 1.5)));
  const copyA = n === 1 ? 1 : 1 - Math.pow(1 - 0.96, 1 / n);
  const copies = Array.from({ length: n }, (_, i) => (n === 1 ? th : theta(f - SHUTTER / 2 + (SHUTTER * (i + 0.5)) / n)));
  // print legible only when nearly still; it crossfades into smeared bands as the record speeds up
  const textO = Math.min(1, Math.max(0, (4.2 - smear) / 3));
  const seed = Math.floor(f / 2) % 12;

  // exit: grooves part into rings, centre out
  const pcx = W / 2 + (cam.cx - W / 2) * (PERSP / (PERSP - cam.z));
  const pcy = H / 2 + (cam.cy - H / 2) * (PERSP / (PERSP - cam.z));
  let mask = "none";
  if (f >= T.rings) {
    const BW = 54;
    const REACH = lay.reach;
    const DUR = 18;
    const stops: string[] = [];
    for (let k = 0; k * BW < REACH; k++) {
      const r0 = k * BW;
      const tk = T.rings + DUR * Math.pow(r0 / REACH, 1 / 1.6);
      const o = Easing.in(Easing.cubic)(Math.min(1, Math.max(0, (f - tk) / 6)));
      if (o <= 0) continue;
      const a = r0 + ((1 - o) * BW) / 2;
      const b = r0 + ((1 + o) * BW) / 2;
      stops.push(`#000 ${a.toFixed(1)}px`, `transparent ${(a + 0.8).toFixed(1)}px`, `transparent ${b.toFixed(1)}px`, `#000 ${(b + 0.8).toFixed(1)}px`);
    }
    if (stops.length) mask = `radial-gradient(circle at ${pcx.toFixed(1)}px ${pcy.toFixed(1)}px, #000 0px, ${stops.join(", ")})`;
  }
  const audio = <Audio src={staticFile("ident/audio/platter/mix.wav")} volume={0.9} />;
  if (f >= T.clear) return <AbsoluteFill>{audio}</AbsoluteFill>;

  // gate weave
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

  // groove tracks: run-out 440–520, tracks with gaps, lead-in, rim
  const trackMask =
    `radial-gradient(circle at 50% 50%, transparent 0px, transparent 520px, #000 521px, #000 742px, transparent 743px, transparent 754px, ` +
    `#000 755px, #000 990px, transparent 991px, transparent 1000px, #000 1001px, #000 1262px, transparent 1263px)`;
  const grooveMask = `repeating-radial-gradient(circle at 50% 50%, #000 0px, #000 1.1px, rgba(0,0,0,0.3) 1.6px, rgba(0,0,0,0.3) 2.6px, #000 3.2px)`;

  const titleCol = C.paper;
  const labelsCol = `rgba(150,148,142,${(0.85 * interpolate(f, [8, 18], [0, 1], clamp)).toFixed(3)})`;

  return (
    <MaskFrame mask={mask} weave={[gx, gy]} steady={lay.steadyMask}>
      <div style={{ position: "absolute", left: -24, top: -24, width: W + 48, height: H + 48, backgroundColor: "#050505" }} />

      {/* ---- the record, in 3D ---- */}
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
          {/* vinyl */}
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
          {/* broad gloss: the lamp's soft reflection */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              clipPath: `circle(${RR}px at 50% 50%)`,
              background: `radial-gradient(ellipse 900px 700px at 30% 26%, rgba(220,216,208,${(0.07 * L).toFixed(3)}), transparent 70%)`,
            }}
          />
          {/* the grooves catching the light: bowtie sheen, masked to the tracks and the groove pitch */}
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
            {/* the soft body of the reflection between the groove lines */}
            <div style={{ position: "absolute", inset: 0, background: `conic-gradient(from ${phi}deg at 50% 50%, ${sheenStops(0.1 * L)})` }} />
            {/* faint ring structure everywhere, so the grooves read off-axis too */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,${(0.022 * L).toFixed(3)}) 0px, rgba(255,255,255,0) 2px, rgba(255,255,255,0) 7px, rgba(255,255,255,${(0.022 * L).toFixed(3)}) 9px)`,
              }}
            />
          </div>
          {/* gaps between tracks: a darker smooth ring, a glint on the lobe */}
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

          {/* rotating: surface wear and the label */}
          <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <defs>
              <path id="rim" d={`M ${PC - 388} ${PC} A 388 388 0 1 1 ${PC + 388} ${PC} A 388 388 0 1 1 ${PC - 388} ${PC}`} />
              <filter id="paper" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={3} seed={11} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <filter id="fibres" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves={3} seed={4} />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              {/* worn print: specks of paper showing through the ink */}
              <filter id="wear" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={21} />
                <feColorMatrix type="matrix" values={`0 0 0 0 0.84  0 0 0 0 0.81  0 0 0 0 0.77  14 0 0 0 -9.4`} />
              </filter>
              <clipPath id="labelClip">
                <circle cx={PC} cy={PC} r={LR} />
              </clipPath>
              <radialGradient id="labelLight" cx="30%" cy="24%" r="90%">
                <stop offset="0%" stopColor="#fffaf0" stopOpacity={0.12} />
                <stop offset="40%" stopColor="#000" stopOpacity={0} />
                <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
              </radialGradient>
            </defs>

            {/* hairline scratches and dust, smeared along the shutter */}
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

            {/* the label */}
            <g clipPath="url(#labelClip)">
              <circle cx={PC} cy={PC} r={LR} fill={PAPER} />
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#paper)" opacity={0.16} style={{ mixBlendMode: "multiply" }} />
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#fibres)" opacity={0.1} style={{ mixBlendMode: "multiply" }} />
              </g>
              {copies.map((a, i) => (
                <g key={i} transform={`rotate(${a} ${PC} ${PC})`}>
                  <Ink textO={textO} opacity={copyA} />
                </g>
              ))}
              <g transform={`rotate(${th} ${PC} ${PC})`}>
                <rect x={PC - LR} y={PC - LR} width={LR * 2} height={LR * 2} filter="url(#wear)" />
                {/* spindle wear */}
                <g fill="none" stroke="#3b3833" strokeWidth={1.2} opacity={0.5}>
                  {SPINDLE_MARKS.map((m, i) => {
                    const [x0, y0] = polar(SPINDLE + 3, m.a);
                    const [x1, y1] = polar(SPINDLE + 3 + m.len, m.a + m.bend);
                    const [qx, qy] = polar(SPINDLE + 3 + m.len * 0.5, m.a + m.bend * 1.6);
                    return <path key={i} d={`M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}`} />;
                  })}
                </g>
              </g>
              {/* the booth light on the label: fixed, not rotating */}
              <circle cx={PC} cy={PC} r={LR} fill="url(#labelLight)" />
              <circle cx={PC} cy={PC} r={LR} fill="#000" opacity={1 - (0.18 + 0.82 * L)} />
            </g>
            {/* label edge, spindle */}
            <circle cx={PC} cy={PC} r={LR} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3} />
            <circle cx={PC} cy={PC} r={SPINDLE} fill="#060606" />
            <circle cx={PC} cy={PC} r={SPINDLE - 9} fill="#2a2a2a" />
            <circle cx={PC - 5} cy={PC - 6} r={6} fill="#8a8a86" opacity={0.35 * L} />
          </svg>
        </div>
      </AbsoluteFill>

      {/* ---- the room: haze shaft from the booth light, motes ---- */}
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
          <filter id={`pgrain${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed * 5 + 3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <radialGradient id="pvig" cx={lay.vig.cx} cy={lay.vig.cy} r={lay.vig.r}>
            <stop offset="50%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.88} />
          </radialGradient>
        </defs>
        {Array.from({ length: 46 }, (_, i) => {
          const x = (rand(i * 3.1) * W + f * (0.3 + rand(i) * 0.5)) % W;
          const y = (rand(i * 5.7) * lay.motesH - f * (0.2 + rand(i * 2) * 0.5) + lay.motesH) % lay.motesH;
          return <rect key={i} x={x} y={y} width={2 + rand(i * 4) * 2} height={2 + rand(i * 4) * 2} fill={C.paper} opacity={L * 0.25 * rand(i * 6.3)} />;
        })}
        <rect width={W} height={H} fill="url(#pvig)" />
        <rect width={W} height={H} filter={`url(#pgrain${seed})`} opacity={0.075} style={{ mixBlendMode: "screen" }} />
        <rect width={W} height={H} filter={`url(#pgrain${seed})`} opacity={0.12} style={{ mixBlendMode: "multiply" }} />

        {/* ---- type ---- */}
        <g style={{ fontFamily: FONT_MONO }} fontWeight={500} fill={labelsCol}>
          <text x={lay.labels.x0} y={lay.labels.y} fontSize={24} letterSpacing={6}>
            WATERHOUSE STUDIOS
          </text>
          <text x={lay.labels.x1} y={lay.labels.y} fontSize={24} letterSpacing={6} textAnchor="end">
            SIDE A · 33⅓
          </text>
        </g>
        {f >= T.hold ? (
          <g fill={titleCol} style={{ fontFamily: FONT_DISPLAY }} fontSize={lay.title.size} textAnchor={lay.title.anchor}>
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

// ---- landscape (16:9): the record bleeds off the left, the title sets in the right column ----
const WW = 1920;
const WH = 1080;
const WIDE: Layout = {
  W: WW,
  H: WH,
  cx: [1000, 560],
  cy: [520, 540],
  z: [160, -360],
  tilt: [64, 7],
  yaw: [-18, 0],
  reach: 1750,
  steadyMask: true,
  shaft: { left: -300, top: -500, w: 1000, h: 2400, rot: -40 },
  motesH: WH,
  vig: { cx: "36%", cy: "50%", r: "75%" },
  labels: { x0: 96, x1: WW - 96, y: 92 },
  title: { x: 1100, y1: 486, y2: 596, rule: 632, host: 688, anchor: "start", size: 96, len: 724, hostSize: 28 },
};

export const Platter: React.FC = () => <PlatterCore lay={PORTRAIT} />;
export const PlatterWide: React.FC = () => <PlatterCore lay={WIDE} />;
