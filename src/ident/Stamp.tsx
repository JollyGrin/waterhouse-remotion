import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, W, rand } from "./brand";
import { Grain } from "./common";

/**
 * STAMP — a risograph / screen-print press.
 * Three ink passes (yellow, purple, black key) are pulled across the sheet by a
 * squeegee, each one landing badly misregistered; overprints multiply into riso
 * browns. A beat of shame, a wind-up, then everything SNAPS into register: the key
 * goes crisp black and the yellow pass becomes the logo's hard offset shadow, the
 * purple pass the title's. A rubber stamp thunks "WITH DENZO · TUESDAY" on, then the
 * sheet is peeled off the press from the corner to reveal the content.
 *
 * Beat grid: 120 bpm, beat = 15 f.
 */
export const STAMP_FRAMES = 114;
const FPS = 30;

type Pt = [number, number];
type Xf = { x: number; y: number; r: number };

const sp = (frame: number, at: number, config: Parameters<typeof spring>[0]["config"] = {}) =>
  frame < at ? 0 : spring({ frame: frame - at, fps: FPS, config });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---- timeline ----
const SWEEP = 6; // squeegee pull, frames
const FEED = 5; // the sheet feeds up into the press
const T = {
  pass: [5, 20, 35], // pull starts; lands at +SWEEP (11, 26, 41)
  windUp: 48,
  snap: 56,
  stampIn: 59,
  stampHit: 64,
  stampOut: 67,
  lift: 82,
  rip: 90,
  clear: 103,
};

// ---- layout ----
const LOGO_W = 760;
const LOGO_H = (LOGO_W * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w;
const LOGO_C: Pt = [540, 690];
const TITLE_C: Pt = [540, 1150];
const TITLE_W = 860;
const TITLE_SIZE = 118;
const STAMP_C: Pt = [540, 1372];
const SHADOW = 22;

// ---- passes ----
type Pass = {
  ink: string;
  mis: Xf; // misregistration while printing
  logoFinal: Pt; // where this pass's logo lands in register
  titleFinal: Pt;
  dir: 1 | -1; // squeegee direction: 1 = top→bottom
  seed: number;
};
const PASSES: Pass[] = [
  { ink: C.yellow, mis: { x: -52, y: 38, r: -2.6 }, logoFinal: [SHADOW, SHADOW], titleFinal: [0, 0], dir: 1, seed: 3 },
  { ink: C.twitch, mis: { x: 44, y: -30, r: 2.1 }, logoFinal: [0, 0], titleFinal: [10, 10], dir: -1, seed: 11 },
  { ink: C.ink, mis: { x: -20, y: -46, r: -1.2 }, logoFinal: [0, 0], titleFinal: [0, 0], dir: 1, seed: 23 },
];
const landAt = (k: number) => T.pass[k] + SWEEP;

// ---- camera / shake ----
const IMPACTS = [
  { f: FEED, amp: 9 },
  { f: landAt(0), amp: 7 },
  { f: landAt(1), amp: 7 },
  { f: landAt(2), amp: 9 },
  { f: T.snap, amp: 18 },
  { f: T.stampHit, amp: 11 },
];
const shake = (frame: number) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const { f, amp } of IMPACTS) {
    const t = frame - f;
    if (t < 0 || t > 10) continue;
    const k = amp * Math.exp(-t / 2.3);
    x += (rand(f * 13 + t) - 0.5) * 2 * k;
    y += (rand(f * 29 + t + 7) - 0.5) * 2 * k;
    r += (rand(f * 41 + t + 3) - 0.5) * 0.18 * k;
  }
  return { x, y, r };
};

// ---------------------------------------------------------------------------
// The printed art for one pass: registration targets, the mark, the title.

const RegTarget: React.FC<{ c: Pt; ink: string }> = ({ c, ink }) => (
  <g transform={`translate(${c[0]} ${c[1]})`} stroke={ink} strokeWidth={3} fill="none">
    <circle r={20} />
    <circle r={8} fill={ink} stroke="none" />
    <line x1={-34} x2={34} y1={0} y2={0} />
    <line x1={0} x2={0} y1={-34} y2={34} />
  </g>
);
const TARGETS: Pt[] = [
  [540, 92],
  [52, 960],
  [1028, 960],
];

const xf = (t: Xf, c: Pt) => `translate(${t.x} ${t.y}) rotate(${t.r} ${c[0]} ${c[1]})`;

const PassArt: React.FC<{ p: Pass; k: number; g: Xf; logo: Pt; title: Pt; squash: number }> = ({ p, k, g, logo, title, squash }) => {
  const s = LOGO_W / LOGO_VIEWBOX.w;
  const lx = LOGO_C[0] - LOGO_W / 2;
  const ly = LOGO_C[1] - LOGO_H / 2;
  return (
    <g filter={`url(#ink-${k})`} transform={xf(g, LOGO_C)}>
      {TARGETS.map((c, i) => (
        <RegTarget key={i} c={c} ink={p.ink} />
      ))}
      <g
        transform={`translate(${logo[0]} ${logo[1]}) translate(${LOGO_C[0]} ${LOGO_C[1] + LOGO_H / 2}) scale(${1 + squash} ${1 - squash}) translate(${-LOGO_C[0]} ${-(LOGO_C[1] + LOGO_H / 2)})`}
      >
        <g transform={`translate(${lx} ${ly}) scale(${s})`}>
          {LOGO_ORDER.map((piece) => (
            <path key={piece} d={LOGO_PATHS[piece]} fill={p.ink} />
          ))}
        </g>
      </g>
      <g transform={`translate(${title[0]} ${title[1]})`} fill={p.ink} fontFamily={FONT_DISPLAY} fontSize={TITLE_SIZE}>
        <text x={TITLE_C[0] - TITLE_W / 2} y={TITLE_C[1] - 18} textLength={TITLE_W} lengthAdjust="spacingAndGlyphs">
          WATERHOUSE
        </text>
        <text x={TITLE_C[0] - TITLE_W / 2} y={TITLE_C[1] + TITLE_SIZE * 0.92} textLength={TITLE_W} lengthAdjust="spacingAndGlyphs">
          SESSIONS
        </text>
      </g>
    </g>
  );
};

/** Riso ink: slightly rough edges, static speckle holes where the ink skipped. */
const InkFilter: React.FC<{ id: string; seed: number; holes?: number; rough?: number }> = ({ id, seed, holes = 0.7, rough = 3.5 }) => (
  <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves={2} seed={seed} result="warp" />
    <feDisplacementMap in="SourceGraphic" in2="warp" scale={rough} xChannelSelector="R" yChannelSelector="G" result="ruff" />
    <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={1} seed={seed + 100} result="n" />
    <feColorMatrix in="n" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  22 0 0 0 ${-22 * holes}`} result="holes" />
    <feComposite in="ruff" in2="holes" operator="out" />
  </filter>
);

// ---------------------------------------------------------------------------
// Peel geometry.

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const clipPoly = (poly: Pt[], p: Pt, n: Pt, side: 1 | -1): Pt[] => {
  const out: Pt[] = [];
  const s = (q: Pt) => side * dot(sub(q, p), n);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = s(a);
    const sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
};
const reflect = (q: Pt, p: Pt, n: Pt): Pt => {
  const d = 2 * dot(sub(q, p), n);
  return [q[0] - d * n[0], q[1] - d * n[1]];
};
const toClip = (poly: Pt[]) =>
  poly.length < 3 ? "polygon(0 0, 0 0, 0 0)" : `polygon(${poly.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;
const toPoints = (poly: Pt[]) => poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

const SHEET: Pt[] = [
  [0, 0],
  [W, 0],
  [W, H],
  [0, H],
];
const PEEL_CORNER: Pt = [W, H];
const PEEL_N: Pt = (() => {
  // fold normal points at the peeled corner; slightly steeper than the diagonal for a nicer curl
  const v: Pt = [1, 0.8];
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
})();
const PEEL_MAX = dot(sub(PEEL_CORNER, [0, 0]), PEEL_N) + 40;

/** How far the fold line has travelled in from the corner (px). */
const peelDist = (frame: number) => {
  if (frame < T.lift) return 0;
  // anticipation: the corner lifts a little and hangs
  const lift = 190 * Easing.out(Easing.back(2.2))(clamp01((frame - T.lift) / 6));
  if (frame < T.rip) return lift;
  const t = clamp01((frame - T.rip) / (T.clear - 1 - T.rip));
  return lift + (PEEL_MAX - lift) * Math.pow(t, 1.9);
};

// ---------------------------------------------------------------------------

const Swatches: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ position: "absolute", left: 834, top: 154, display: "flex", gap: 8 }}>
    {PASSES.map((p, k) => {
      const on = frame >= landAt(k);
      const pop = on ? 1 + 0.35 * Math.exp(-(frame - landAt(k)) / 1.6) * Math.cos((frame - landAt(k)) * 1.4) : 1;
      return (
        <div
          key={k}
          style={{
            width: 34,
            height: 34,
            border: "3px solid #000",
            background: on ? p.ink : "transparent",
            transform: `scale(${pop})`,
          }}
        />
      );
    })}
  </div>
);

const Slug: React.FC<{ frame: number }> = ({ frame }) => {
  const passes = PASSES.filter((_, k) => frame >= landAt(k)).length;
  const registered = frame >= T.snap;
  const blinkBad = frame >= landAt(2) + 4 && !registered && Math.floor(frame / 4) % 2 === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        top: 156,
        fontFamily: FONT_MONO,
        fontWeight: 700,
        fontSize: 27,
        letterSpacing: "0.1em",
        color: "#000",
        whiteSpace: "pre",
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <span>WH-SESSIONS · PASS {passes}/3 · TUE</span>
      {frame >= landAt(2) + 4 ? (
        <span
          style={{
            background: registered ? C.yellow : blinkBad ? C.punch : "#000",
            color: registered ? "#000" : C.paper,
            padding: "2px 8px",
          }}
        >
          {registered ? "REG OK" : "REG ✕"}
        </span>
      ) : null}
    </div>
  );
};

const CropMarks: React.FC = () => {
  const L = 54;
  const I = 72;
  const m = (x: number, y: number, sx: number, sy: number, i: number) => (
    <g key={i} stroke="#000" strokeWidth={2.5}>
      <line x1={x} y1={y + sy * 14} x2={x} y2={y + sy * (14 + L)} />
      <line x1={x + sx * 14} y1={y} x2={x + sx * (14 + L)} y2={y} />
    </g>
  );
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      {[
        m(I, I, -1, -1, 0),
        m(W - I, I, 1, -1, 1),
        m(I, H - I, -1, 1, 2),
        m(W - I, H - I, 1, 1, 3),
      ]}
    </svg>
  );
};

/** The rubber stamp: the imprint (from the hit), and the stamp block that delivers it. */
const STAMP_W = 640;
const STAMP_H = 112;
const STAMP_ROT = -6;
const StampImprint: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < T.stampHit) return null;
  const t = frame - T.stampHit;
  const squish = 0.05 * Math.exp(-t / 1.5);
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "multiply" }}>
      <defs>
        <InkFilter id="ink-stamp" seed={41} holes={0.62} rough={2.5} />
      </defs>
      <g
        filter="url(#ink-stamp)"
        transform={`translate(${STAMP_C[0]} ${STAMP_C[1]}) rotate(${STAMP_ROT}) scale(${1 + squish} ${1 - squish})`}
      >
        <rect x={-STAMP_W / 2} y={-STAMP_H / 2} width={STAMP_W} height={STAMP_H} fill="none" stroke={C.punch} strokeWidth={8} />
        <rect
          x={-STAMP_W / 2 + 14}
          y={-STAMP_H / 2 + 14}
          width={STAMP_W - 28}
          height={STAMP_H - 28}
          fill="none"
          stroke={C.punch}
          strokeWidth={3}
        />
        <text
          x={0}
          y={15}
          textAnchor="middle"
          fill={C.punch}
          fontFamily={FONT_MONO}
          fontWeight={800}
          fontSize={42}
          letterSpacing="0.14em"
        >
          WITH DENZO · TUESDAY
        </text>
      </g>
    </svg>
  );
};

const StampBlock: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < T.stampIn || frame > T.stampOut + 7) return null;
  let y: number;
  let sq = 0;
  let rot = STAMP_ROT;
  if (frame < T.stampHit) {
    const t = (frame - T.stampIn) / (T.stampHit - T.stampIn);
    y = interpolate(Math.pow(t, 2.2), [0, 1], [-1500, 0]);
  } else if (frame < T.stampOut) {
    y = 0;
    sq = 0.1 * Math.exp(-(frame - T.stampHit) / 1.2);
  } else {
    const t = (frame - T.stampOut) / 7;
    y = -1600 * Easing.in(Easing.cubic)(t);
    rot = STAMP_ROT + 5 * t;
  }
  const blur = frame < T.stampHit && frame > T.stampIn ? 1 : frame > T.stampOut ? 1 : 0;
  const block = (dy: number, op: number, key: number) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: STAMP_C[0] - (STAMP_W + 30) / 2,
        top: STAMP_C[1] - STAMP_H / 2 - 220 + y + dy,
        width: STAMP_W + 30,
        height: STAMP_H + 220,
        transform: `rotate(${rot}deg) scale(${1 + sq}, ${1 - sq})`,
        transformOrigin: "50% 100%",
        opacity: op,
      }}
    >
      {/* handle */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 150,
          height: 150,
          marginLeft: -75,
          background: C.twitch,
          border: "8px solid #000",
          borderRadius: 75,
          boxShadow: `14px 14px 0 0 #000`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 130,
          width: 70,
          height: 70,
          marginLeft: -35,
          background: "#000",
        }}
      />
      {/* mount */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: "100%",
          height: STAMP_H + 26,
          background: C.amber,
          border: "8px solid #000",
          boxShadow: `14px 14px 0 0 #000`,
        }}
      />
      {/* rubber */}
      <div style={{ position: "absolute", left: 15, right: 15, bottom: -10, height: 18, background: C.punch, border: "5px solid #000" }} />
    </div>
  );
  return (
    <>
      {blur ? block(frame < T.stampHit ? -150 : 150, 0.28, 1) : null}
      {block(0, 1, 0)}
    </>
  );
};

/** The squeegee bar sweeping across at the ink's reveal edge (+ motion ghosts). */
const Squeegee: React.FC<{ y: number; dir: 1 | -1; v: number }> = ({ y, dir, v }) => {
  const bar = (dy: number, op: number, key: number) => (
    <div key={key} style={{ position: "absolute", left: -40, width: W + 80, top: y - 36 + dy, height: 72, opacity: op }}>
      <div style={{ position: "absolute", inset: 0, background: "#000" }} />
      {/* rubber blade on the leading edge */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 16,
          top: dir === 1 ? 72 : -16,
          background: C.amber,
          borderTop: "4px solid #000",
          borderBottom: "4px solid #000",
        }}
      />
      {/* handle grips */}
      {[180, W - 180].map((x) => (
        <div
          key={x}
          style={{ position: "absolute", left: x, top: 14, width: 90, height: 44, background: C.yellow, border: "5px solid #000" }}
        />
      ))}
    </div>
  );
  // animator's smear: the body stretches back along the travel, solid, tapering in thickness
  const len = Math.min(340, v * 0.55);
  return (
    <>
      {len > 8 ? (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {[0.0, 0.35, 0.7].map((t, i) => {
            const y0 = y - dir * (36 + len * t);
            const h = len * (1 - t) * 0.3 + 3;
            return <rect key={i} x={-40} width={W + 80} y={dir === 1 ? y0 - h : y0} height={h} fill="#000" />;
          })}
        </svg>
      ) : null}
      {bar(0, 1, 0)}
    </>
  );
};

// ---------------------------------------------------------------------------

export const Stamp: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame >= T.clear) return <AbsoluteFill>{SOUND}</AbsoluteFill>;

  const sh = shake(frame);
  // paper feed: slides up from below, overshoots a hair, seats with a thud
  const feedY = frame >= FEED ? 0 : H * 0.5 * (1 - Easing.out(Easing.cubic)((frame + 1) / (FEED + 1)));
  const drift = { x: Math.sin(frame / 23) * 4, y: Math.cos(frame / 31) * 3 };

  // registration snap: 0 = misregistered, 1 = in register (overshoots)
  const snap = sp(frame, T.snap, { damping: 11, stiffness: 260, mass: 0.6 });
  // wind-up: the passes drift further apart before the snap
  const wind =
    1 +
    0.35 * Easing.inOut(Easing.cubic)(clamp01((frame - T.windUp) / (T.snap - T.windUp))) * (frame < T.snap ? 1 : 0);
  // whole-art squash on the snap
  const snapSquash = frame >= T.snap ? 0.06 * Math.exp(-(frame - T.snap) / 2) * Math.cos((frame - T.snap) * 1.3) : 0;

  // peel
  const d = peelDist(frame);
  const foldP: Pt = [PEEL_CORNER[0] - PEEL_N[0] * d, PEEL_CORNER[1] - PEEL_N[1] * d];
  const remaining = d > 0 ? clipPoly(SHEET, foldP, PEEL_N, -1) : SHEET;
  const peeled = d > 0 ? clipPoly(SHEET, foldP, PEEL_N, 1) : [];
  const flap = peeled.map((q) => reflect(q, foldP, PEEL_N));
  // 2-tone shading: a darker band along the fold
  const band = Math.min(70, d * 0.35);
  const bandPoly = d > 0 ? clipPoly(flap, [foldP[0] - PEEL_N[0] * band, foldP[1] - PEEL_N[1] * band], PEEL_N, 1) : [];
  const shadowPoly = flap.map(([x, y]): Pt => [x - 16, y + 18]);

  return (
    <AbsoluteFill>
      {/* the sheet (everything printed lives on it, clipped by the peel) */}
      <AbsoluteFill style={{ transform: `translateY(${feedY}px)` }}>
      <AbsoluteFill style={{ clipPath: toClip(remaining), isolation: "isolate", backgroundColor: C.paper }}>
        <AbsoluteFill
          style={{
            transform: `translate(${sh.x + drift.x}px, ${sh.y + drift.y}px) rotate(${sh.r}deg)`,
          }}
        >
          <CropMarks />
          <Slug frame={frame} />
          <Swatches frame={frame} />

          {PASSES.map((p, k) => {
            const start = T.pass[k];
            if (frame < start) return null;
            const r = clamp01((frame - start) / SWEEP);
            const rev = Easing.inOut(Easing.cubic)(r);
            const edge = p.dir === 1 ? rev * (H + 80) - 40 : H + 40 - rev * (H + 80);
            const clip = r >= 1 ? "none" : p.dir === 1 ? `inset(0 0 ${H - edge}px 0)` : `inset(${edge}px 0 0 0)`;
            // landing jolt: the ink "seats" with a small squash
            const tl = frame - landAt(k);
            const seat = tl >= 0 && tl < 8 ? 0.025 * Math.exp(-tl / 1.6) : 0;
            const g: Xf = {
              x: p.mis.x * wind * (1 - snap),
              y: p.mis.y * wind * (1 - snap),
              r: p.mis.r * wind * (1 - snap),
            };
            const logo: Pt = [p.logoFinal[0] * snap, p.logoFinal[1] * snap];
            const title: Pt = [p.titleFinal[0] * snap, p.titleFinal[1] * snap];
            return (
              <AbsoluteFill key={k} style={{ clipPath: clip, mixBlendMode: "multiply" }}>
                <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
                  <defs>
                    <InkFilter id={`ink-${k}`} seed={p.seed} />
                  </defs>
                  <PassArt p={p} k={k} g={g} logo={logo} title={title} squash={seat + snapSquash} />
                </svg>
              </AbsoluteFill>
            );
          })}

          <StampImprint frame={frame} />
        </AbsoluteFill>
        <Grain opacity={0.09} />
        {/* the flap's hard shadow falls on the sheet that's still there */}
        {d > 0 ? (
          <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
            <polygon points={toPoints(shadowPoly)} fill="#000" opacity={0.22} />
          </svg>
        ) : null}
      </AbsoluteFill>
      </AbsoluteFill>

      {/* squeegees ride above the sheet */}
      {PASSES.map((p, k) => {
        const start = T.pass[k];
        const r = (frame - start) / SWEEP;
        if (r < 0 || r > 1) return null;
        const rev = Easing.inOut(Easing.cubic)(clamp01(r));
        const edge = p.dir === 1 ? rev * (H + 80) - 40 : H + 40 - rev * (H + 80);
        const prev = Easing.inOut(Easing.cubic)(clamp01(r - 1 / SWEEP));
        const v = Math.abs(rev - prev) * (H + 80);
        return <Squeegee key={k} y={edge + (p.dir === 1 ? -36 : 36)} dir={p.dir} v={v} />;
      })}

      <StampBlock frame={frame} />

      {/* the peeling flap: back of the sheet, yellow, with a hard amber band at the fold */}
      {d > 0 && flap.length >= 3 ? (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <polygon points={toPoints(flap)} fill={C.yellow} stroke="#000" strokeWidth={8} strokeLinejoin="round" />
          {bandPoly.length >= 3 ? <polygon points={toPoints(bandPoly)} fill={C.amber} /> : null}
          <polygon points={toPoints(flap)} fill="none" stroke="#000" strokeWidth={8} strokeLinejoin="round" />
        </svg>
      ) : null}

      {SOUND}
    </AbsoluteFill>
  );
};

// ---- sound ----
const S: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => (
  <Sequence from={at} layout="none">
    {children}
  </Sequence>
);
const SOUND = (
  <>
    <S at={0}>
      <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.4} playbackRate={1.4} />
    </S>
    <S at={FEED}>
      <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.6} playbackRate={1.15} />
      <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.35} />
    </S>
    {PASSES.map((_, k) => (
      <React.Fragment key={k}>
        <S at={T.pass[k]}>
          <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.32} playbackRate={1.7} />
          <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.45} playbackRate={1.3} />
        </S>
        <S at={landAt(k)}>
          <Audio src={staticFile("audio/bumper/clack.wav")} volume={0.85} playbackRate={[1.05, 0.95, 0.85][k]} />
          <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.55} playbackRate={[1.25, 1.1, 0.95][k]} />
        </S>
      </React.Fragment>
    ))}
    <S at={landAt(2) + 4}>
      <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.45} />
    </S>
    <S at={T.windUp}>
      <Audio src={staticFile("audio/bumper/rise.wav")} volume={0.35} playbackRate={1.4} />
    </S>
    <S at={T.snap}>
      <Audio src={staticFile("audio/bumper/clunk.wav")} volume={0.95} />
      <Audio src={staticFile("audio/recap/slam.wav")} volume={0.7} />
      <Audio src={staticFile("audio/bumper/thump.wav")} volume={0.6} />
    </S>
    <S at={T.stampIn + 1}>
      <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.35} playbackRate={1.5} />
    </S>
    <S at={T.stampHit}>
      <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.95} playbackRate={0.85} />
      <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.8} />
    </S>
    <S at={T.stampOut}>
      <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.2} playbackRate={1.6} />
    </S>
    <S at={T.lift}>
      <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.55} />
    </S>
    <S at={T.rip}>
      <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.6} playbackRate={0.9} />
      <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.45} playbackRate={0.8} />
    </S>
  </>
);
