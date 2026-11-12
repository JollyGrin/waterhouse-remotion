import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, W, rand } from "./brand";
import { Grain } from "./common";

/**
 * SLICE — knife cuts.
 * The card is a stack of cut paper: a paper face over yellow, purple and an amber base.
 * Each knife cut flashes a line across the frame, then the face splits and the halves
 * slide apart along the cut; the lower sheets lag behind, so every gap shows the
 * coloured strata. A horizontal cut opens a slit in the page and the title slides out
 * of it. Everything snaps back clean, then one last cut splits the whole screen and the
 * halves fly apart to the content, each trailed by a coloured sheet.
 *
 * Beat grid: 120 bpm, beat = 15 f.
 */
export const SLICE_FRAMES = 120;
const FPS = 30;

type Pt = [number, number];
const sp = (frame: number, at: number, config: Parameters<typeof spring>[0]["config"] = {}) =>
  frame < at ? 0 : spring({ frame: frame - at, fps: FPS, config });

// ---- timeline ----
const T = {
  slam: 0,
  shadow: 3,
  slitFlash: 50,
  slitOpen: 53,
  word1: 55,
  word2: 59,
  tag: 68,
  snapBack: 80,
  exitFlash: 90,
  exitSplit: 93,
  clear: 106, // nothing drawn from here
};
const FLASH_LEAD = 3; // flash starts this many frames before its split

// ---- layout ----
const CW = 780; // card
const CH = 540;
const CX0 = 520 - CW / 2; // card origin (world) before the slit
const CY0 = 840 - CH / 2;
const MARK_W = 600;
const MARK_H = (MARK_W * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w;
const MARK_X = (CW - MARK_W) / 2;
const MARK_Y = (CH - MARK_H) / 2;
const OUTLINE = 10;
const SHADOW = 26;

const YS = CY0 + CH + 92; // slit line (world y)
const G = 148; // slit half-opening

// ---- geometry ----
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const dirOf = (deg: number): Pt => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const normalOf = (d: Pt): Pt => [-d[1], d[0]];

/** Keep the part of `poly` where side * dot(x - p, n) >= 0. */
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
const area = (poly: Pt[]) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};
const toClip = (poly: Pt[]) =>
  poly.length < 3 ? "polygon(0 0, 0 0, 0 0)" : `polygon(${poly.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(", ")})`;
const toPoints = (poly: Pt[]) => poly.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

// ---- the card cuts (card-local coords) ----
type Cut = { split: number; p: Pt; deg: number; a: number; b: number };
const CUTS: Cut[] = [
  // a: slide along the cut, b: separation across it (px, for the + side; the - side mirrors)
  { split: 15, p: [390, 236], deg: -13, a: 46, b: 17 },
  { split: 30, p: [512, 300], deg: 83, a: -30, b: 15 },
  { split: 45, p: [390, 410], deg: 4, a: -42, b: 14 },
];
type Frag = { poly: Pt[]; sides: { k: number; s: 1 | -1 }[] };
const CARD: Pt[] = [
  [0, 0],
  [CW, 0],
  [CW, CH],
  [0, CH],
];

const fragmentsAt = (frame: number): Frag[] => {
  let frags: Frag[] = [{ poly: CARD, sides: [] }];
  CUTS.forEach((c, k) => {
    if (frame < c.split) return;
    const n = normalOf(dirOf(c.deg));
    const next: Frag[] = [];
    for (const f of frags) {
      for (const s of [1, -1] as const) {
        const poly = clipPoly(f.poly, c.p, n, s);
        if (poly.length >= 3 && area(poly) > 4) next.push({ poly, sides: [...f.sides, { k, s }] });
      }
    }
    frags = next;
  });
  return frags;
};

const cutAmp = (frame: number, k: number) =>
  sp(frame, CUTS[k].split, { damping: 9, stiffness: 210, mass: 0.55 });

const dispOf = (f: Frag, frame: number, restore: number): Pt => {
  let x = 0;
  let y = 0;
  for (const { k, s } of f.sides) {
    const c = CUTS[k];
    const d = dirOf(c.deg);
    const n = normalOf(d);
    const amp = cutAmp(frame, k) * s * restore;
    x += amp * (c.a * d[0] + c.b * n[0]);
    y += amp * (c.a * d[1] + c.b * n[1]);
  }
  return [x, y];
};

// ---- exit cut (world coords) ----
const EXIT_P: Pt = [540, 940];
const EXIT_D = dirOf(-24);
const EXIT_N = normalOf(EXIT_D); // points down-right-ish (+y)
const PAD = 120;
const WORLD: Pt[] = [
  [-PAD, -PAD],
  [W + PAD, -PAD],
  [W + PAD, H + PAD],
  [-PAD, H + PAD],
];
const HALF_TOP = clipPoly(WORLD, EXIT_P, EXIT_N, -1);
const HALF_BOT = clipPoly(WORLD, EXIT_P, EXIT_N, 1);
const exitDist = (t: number) => (t < 0 ? 0 : 16 + 2300 * Math.pow(Math.min(t, 13) / 13, 2.3));

// ---- camera ----
const IMPACTS: { f: number; amp: number }[] = [
  { f: 5, amp: 12 },
  ...CUTS.map((c) => ({ f: c.split, amp: 9 })),
  { f: T.slitOpen, amp: 10 },
  { f: T.word1 + 4, amp: 5 },
  { f: T.word2 + 4, amp: 6 },
  { f: T.tag, amp: 8 },
  { f: T.snapBack + 3, amp: 9 },
  { f: T.exitSplit, amp: 14 },
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

// ---------------------------------------------------------------------------

/** The knife streak: ink line with a yellow core, drawn across in two frames. */
const Flash: React.FC<{ p: Pt; d: Pt; t: number }> = ({ p, d, t }) => {
  if (t < 0 || t > FLASH_LEAD) return null;
  const L = 2600;
  const a: Pt = [p[0] - d[0] * L, p[1] - d[1] * L];
  const prog = Math.min(1, (t + 1) / 2); // 50% then 100%
  const b: Pt = [a[0] + d[0] * 2 * L * prog, a[1] + d[1] * 2 * L * prog];
  const thin = t >= FLASH_LEAD - 0.5 ? 0.55 : 1; // tightens on the last frame before the split
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.ink} strokeWidth={14 * thin} />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.yellow} strokeWidth={5 * thin} />
    </svg>
  );
};

const CardFace: React.FC = () => (
  <div style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, background: C.paper }}>
    <svg
      width={MARK_W}
      height={MARK_H}
      viewBox={`0 0 ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`}
      style={{ position: "absolute", left: MARK_X, top: MARK_Y, overflow: "visible" }}
    >
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={C.ink} />
      ))}
    </svg>
    {/* corner print marks */}
    <div style={{ position: "absolute", left: 26, top: 22, fontFamily: FONT_MONO, fontWeight: 700, fontSize: 22, letterSpacing: "0.18em", color: C.ink }}>
      WH/SESSIONS
    </div>
    <div style={{ position: "absolute", right: 26, bottom: 20, fontFamily: FONT_MONO, fontWeight: 700, fontSize: 22, letterSpacing: "0.18em", color: C.ink }}>
      TUE
    </div>
  </div>
);

const STRATA: { color: string; f: number }[] = [
  { color: C.amber, f: 0 }, // base sheet, never moves
  { color: C.twitch, f: 0.34 },
  { color: C.yellow, f: 0.67 },
];

/** Cutting-mat grid on the page. */
const Mat: React.FC = () => (
  <svg width={W + 240} height={H + 240} style={{ position: "absolute", left: -120, top: -120 }}>
    <defs>
      <pattern id="mat" width={60} height={60} patternUnits="userSpaceOnUse" x={0} y={0}>
        <path d="M60 0 V60 M0 60 H60" stroke={C.ink} strokeWidth={1.5} fill="none" />
      </pattern>
      <pattern id="mat5" width={300} height={300} patternUnits="userSpaceOnUse" x={0} y={0}>
        <path d="M300 0 V300 M0 300 H300" stroke={C.ink} strokeWidth={3} fill="none" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#mat)" opacity={0.06} />
    <rect width="100%" height="100%" fill="url(#mat5)" opacity={0.08} />
  </svg>
);

/** The whole screen (page, card, slit, tag), camera applied, grain on top. */
const Scene: React.FC<{ frame: number }> = ({ frame }) => {
  // camera
  const sh = shake(frame);
  const driftX = Math.sin(frame / 23) * 3;
  const driftY = Math.sin(frame / 31 + 1) * 3;
  const roll = Math.sin(frame / 29) * 0.25;

  // card slam
  const slam = sp(frame, T.slam, { damping: 10, stiffness: 260, mass: 0.6 });
  const cardScale = 1.22 - 0.22 * slam;
  const shadowPop = sp(frame, T.shadow, { damping: 8, stiffness: 320, mass: 0.5 });

  // slit
  const slit = sp(frame, T.slitOpen, { damping: 11, stiffness: 190, mass: 0.6 });
  const g = G * slit;

  // slices
  const restore = 1 - sp(frame, T.snapBack, { damping: 12, stiffness: 360, mass: 0.5 });
  let frags = fragmentsAt(frame);
  const disps = frags.map((f) => dispOf(f, frame, restore));
  const maxD = Math.max(0, ...disps.map(([x, y]) => Math.hypot(x, y)));
  const whole = frags.length === 1 || frame >= T.snapBack + 7 || (frame > T.snapBack && maxD < 2.5);
  if (whole) frags = [{ poly: CARD, sides: [] }];
  const D = whole ? [[0, 0] as Pt] : disps;

  const cardX = CX0;
  const cardY = CY0 - g;

  // title slide along the slit
  const w1 = sp(frame, T.word1, { damping: 10, stiffness: 170, mass: 0.6 });
  const w2 = sp(frame, T.word2, { damping: 10, stiffness: 170, mass: 0.6 });
  const v1 = w1 - sp(frame - 1, T.word1, { damping: 10, stiffness: 170, mass: 0.6 });
  const v2 = w2 - sp(frame - 1, T.word2, { damping: 10, stiffness: 170, mass: 0.6 });
  const tag = sp(frame, T.tag, { damping: 10, stiffness: 300, mass: 0.5 });
  const tagFlash = frame >= T.tag && frame < T.tag + 2;

  // which cut is flashing
  const flashes: { p: Pt; d: Pt; t: number; local: boolean }[] = CUTS.map((c) => ({
    p: c.p,
    d: dirOf(c.deg),
    t: frame - (c.split - FLASH_LEAD),
    local: true,
  }));
  flashes.push({ p: [W / 2, YS], d: [1, 0], t: frame - (T.slitOpen - FLASH_LEAD), local: false });

  const STRIP = 18 * slit; // strata in the slit walls

  return (
    <AbsoluteFill style={{ isolation: "isolate", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate(${driftX + sh.x}px, ${driftY + sh.y}px) rotate(${roll + sh.r}deg)`,
        }}
      >
        {/* page: two halves of the sheet part at the slit */}
        <div style={{ position: "absolute", left: -120, top: -120, width: W + 240, height: YS + 120, transform: `translateY(${-g}px)`, background: C.paper, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0 }}>
            <Mat />
          </div>
        </div>
        <div style={{ position: "absolute", left: -120, top: YS, width: W + 240, height: H - YS + 120, transform: `translateY(${g}px)`, background: C.paper, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: -YS - 120 }}>
            <Mat />
          </div>
        </div>

        {/* the slit: strata walls, ink core, the title sliding out along the cut */}
        {slit > 0.001 && (
          <div style={{ position: "absolute", left: -120, width: W + 240, top: YS - g, height: 2 * g, overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, background: C.ink }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: STRIP * 2, background: C.twitch }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: STRIP, background: C.yellow }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: STRIP * 2, background: C.twitch }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: STRIP, background: C.yellow }} />
            {/* ink rules = cut edges of the page */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, background: C.ink }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, background: C.ink }} />
            <div
              style={{
                position: "absolute",
                left: STRIP * 2,
                right: STRIP * 2,
                top: STRIP * 2,
                bottom: STRIP * 2,
                overflow: "hidden",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 120,
                width: W,
                top: g - 116,
                height: 232,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                fontFamily: FONT_DISPLAY,
                lineHeight: 1,
                whiteSpace: "nowrap",
                letterSpacing: "-0.02em",
              }}
            >
              <div
                style={{
                  fontSize: 90,
                  color: C.paper,
                  transform: `translateX(${(w1 - 1) * 1100 - 20}px) skewX(${Math.max(-24, Math.min(24, -v1 * 140))}deg)`,
                }}
              >
                WATERHOUSE
              </div>
              <div
                style={{
                  fontSize: 112,
                  color: C.yellow,
                  transform: `translateX(${(1 - w2) * 1100 - 20}px) skewX(${Math.max(-24, Math.min(24, v2 * 140))}deg)`,
                }}
              >
                SESSIONS
              </div>
            </div>
          </div>
        )}

        {/* tag under the slit */}
        <div
          style={{
            position: "absolute",
            left: 0,
            width: W,
            top: YS + G + 44,
            display: "flex",
            justifyContent: "center",
            transform: `translateX(-20px)`,
          }}
        >
          <div
            style={{
              opacity: tag > 0.01 ? 1 : 0,
              transform: `scale(${1.7 - 0.7 * tag}) rotate(${-6 + 4 * tag}deg)`,
              background: tagFlash ? C.yellow : C.ink,
              color: tagFlash ? C.ink : C.yellow,
              fontFamily: FONT_MONO,
              fontWeight: 800,
              fontSize: 40,
              letterSpacing: "0.22em",
              padding: "14px 22px 14px 32px",
              boxShadow: `${10 * tag}px ${10 * tag}px 0 0 ${C.twitch}`,
            }}
          >
            WITH DENZO · TUESDAY
          </div>
        </div>

        {/* the card: a stack of cut paper */}
        <div
          style={{
            position: "absolute",
            left: cardX,
            top: cardY,
            width: CW,
            height: CH,
            transform: `scale(${cardScale})`,
            transformOrigin: "50% 50%",
          }}
        >
          {/* base shadow */}
          <div
            style={{
              position: "absolute",
              left: SHADOW * shadowPop,
              top: SHADOW * shadowPop,
              width: CW,
              height: CH,
              background: C.ink,
            }}
          />
          {/* strata: lower sheets lag behind the face */}
          <svg width={CW} height={CH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {STRATA.map(({ color, f }) =>
              frags.map((fr, i) => (
                <polygon
                  key={`${color}-${i}`}
                  points={toPoints(fr.poly)}
                  transform={`translate(${D[i][0] * f} ${D[i][1] * f})`}
                  fill={color}
                  stroke={C.ink}
                  strokeWidth={5}
                  strokeLinejoin="miter"
                />
              )),
            )}
          </svg>
          {/* faces */}
          {frags.map((fr, i) => (
            <div
              key={`face-${i}`}
              style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, transform: `translate(${D[i][0]}px, ${D[i][1]}px)` }}
            >
              <div style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, clipPath: whole ? undefined : toClip(fr.poly) }}>
                <CardFace />
              </div>
            </div>
          ))}
          {/* outlines: card border + every cut edge */}
          <svg width={CW} height={CH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {frags.map((fr, i) => (
              <polygon
                key={`ol-${i}`}
                points={toPoints(fr.poly)}
                transform={`translate(${D[i][0]} ${D[i][1]})`}
                fill="none"
                stroke={C.ink}
                strokeWidth={OUTLINE}
                strokeLinejoin="miter"
              />
            ))}
          </svg>
          {/* knife streaks in card space */}
          {flashes.filter((f) => f.local).map((f, i) => (
            <Flash key={i} p={f.p} d={f.d} t={f.t} />
          ))}
        </div>

        {/* slit streak in world space */}
        {flashes.filter((f) => !f.local).map((f, i) => (
          <div key={i} style={{ position: "absolute", left: 0, top: 0 }}>
            <Flash p={f.p} d={f.d} t={f.t} />
          </div>
        ))}
        {/* exit streak (drawn in world space, part of the scene so both halves carry it) */}
        <div style={{ position: "absolute", left: 0, top: 0 }}>
          <Flash p={EXIT_P} d={EXIT_D} t={frame - T.exitFlash} />
        </div>
      </AbsoluteFill>
      <Grain opacity={0.09} />
    </AbsoluteFill>
  );
};

export const Slice: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame >= T.clear) return <AbsoluteFill>{SOUND}</AbsoluteFill>;

  if (frame < T.exitSplit) {
    return (
      <AbsoluteFill>
        <Scene frame={frame} />
        {SOUND}
      </AbsoluteFill>
    );
  }

  // exit: the whole screen splits along one line; halves fly apart, coloured sheets trail
  const t = frame - T.exitSplit;
  const d = exitDist(t);
  const dt = exitDist(t - 3);
  const shear = 0.18;
  const off = (dist: number, s: 1 | -1): Pt => [
    s * (EXIT_N[0] * dist + EXIT_D[0] * dist * shear),
    s * (EXIT_N[1] * dist + EXIT_D[1] * dist * shear),
  ];
  const half = (poly: Pt[], s: 1 | -1) => {
    const o = off(d, s);
    return (
      <AbsoluteFill key={`h${s}`} style={{ transform: `translate(${o[0]}px, ${o[1]}px)` }}>
        <AbsoluteFill style={{ clipPath: toClip(poly) }}>
          <Scene frame={frame} />
        </AbsoluteFill>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <polygon points={toPoints(poly)} fill="none" stroke={C.ink} strokeWidth={14} />
        </svg>
      </AbsoluteFill>
    );
  };
  const trail = (poly: Pt[], s: 1 | -1, color: string) => {
    const o = off(dt, s);
    return (
      <svg key={`t${s}`} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", transform: `translate(${o[0]}px, ${o[1]}px)` }}>
        <polygon points={toPoints(poly)} fill={color} stroke={C.ink} strokeWidth={12} />
      </svg>
    );
  };
  // the trail sheets stay solid and flat — no grain on them, they read as cut colour paper
  return (
    <AbsoluteFill>
      {trail(HALF_TOP, -1, C.yellow)}
      {trail(HALF_BOT, 1, C.twitch)}
      {half(HALF_TOP, -1)}
      {half(HALF_BOT, 1)}
      {SOUND}
    </AbsoluteFill>
  );
};

// ---- sound ----
const Shing: React.FC<{ at: number; rate?: number }> = ({ at, rate = 1.6 }) => (
  <Sequence from={at} layout="none">
    <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.55} playbackRate={rate} />
    <Audio src={staticFile("audio/bumper/neon-tick.wav")} volume={0.7} />
  </Sequence>
);
const SOUND = (
  <>
    <Sequence from={T.slam + 4} layout="none">
      <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.9} />
      <Audio src={staticFile("audio/pullup/click.wav")} volume={0.6} />
    </Sequence>
    {CUTS.map((c, i) => (
      <React.Fragment key={i}>
        <Shing at={c.split - FLASH_LEAD} rate={1.5 + i * 0.15} />
        <Sequence from={c.split} layout="none">
          <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.7} />
          <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.55} playbackRate={[1.15, 1.3, 0.95][i]} />
        </Sequence>
      </React.Fragment>
    ))}
    <Shing at={T.slitFlash} rate={1.3} />
    <Sequence from={T.slitOpen} layout="none">
      <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.85} playbackRate={0.85} />
      <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.3} playbackRate={1.4} />
    </Sequence>
    <Sequence from={T.word1 + 4} layout="none">
      <Audio src={staticFile("audio/recap/land.wav")} volume={0.7} />
    </Sequence>
    <Sequence from={T.word2 + 4} layout="none">
      <Audio src={staticFile("audio/recap/land.wav")} volume={0.8} playbackRate={0.9} />
    </Sequence>
    <Sequence from={T.tag} layout="none">
      <Audio src={staticFile("audio/recap/slam.wav")} volume={0.55} />
    </Sequence>
    <Sequence from={T.snapBack + 2} layout="none">
      <Audio src={staticFile("audio/bumper/clack.wav")} volume={0.9} />
      <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.6} />
    </Sequence>
    <Shing at={T.exitFlash} rate={1.2} />
    <Sequence from={T.exitSplit} layout="none">
      <Audio src={staticFile("audio/bumper/thump.wav")} volume={1} />
      <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.7} playbackRate={0.8} />
    </Sequence>
  </>
);
