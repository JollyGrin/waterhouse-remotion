import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, COPY, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LogoPiece, rand, W } from "./brand";
import { Grain } from "./common";

/**
 * PRESS — "the site's button is the ident".
 * 120 bpm grid: beat = 15 f, 8th = 7.5 f.
 */
export const PRESS_FRAMES = 110;

// ---- timing (frames) -------------------------------------------------------
const T = {
  wipe: [0, 2, 4, 6], // stack-wipe layer starts: yellow, purple, black, paper
  wipeDur: 9,
  cardPop: 8,
  land: { house: 15, slatA: 22, slatB: 30, door: 37 } as Record<LogoPiece, number>,
  fall: 6,
  label1: 45,
  label2: 52,
  tag: 59,
  tape: 60,
  cursorIn: 64,
  cursorArrive: 75,
  lift: 76,
  press: 82,
  split: 85,
  exitStart: 87,
  exitDur: 8,
};

// ---- easing helpers --------------------------------------------------------
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const expoOut = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(p)));
const prog = (f: number, start: number, dur: number) => clamp01((f - start) / dur);
/** Damped spring impulse: 0 at t<=0, kicks to 1 then rings out. */
const ring = (t: number, freq = 0.55, decay = 0.28) => (t < 0 ? 0 : Math.exp(-decay * t) * Math.cos(freq * t * Math.PI));
/** Settling spring from 0 to 1 with overshoot. */
const springTo = (t: number, freq = 0.32, decay = 0.25) =>
  t <= 0 ? 0 : 1 - Math.exp(-decay * t) * Math.cos(freq * t * Math.PI);

// ---- layout ----------------------------------------------------------------
const CARD = { x: 70, y: 330, w: 860, h: 680, border: 9, shadow: 24 };
const LOGO_W = 690;
const LOGO_SCALE = LOGO_W / 1000; // px per logo unit
const LOGO_X = CARD.x + (CARD.w - LOGO_W) / 2;
const LOGO_Y = CARD.y + (CARD.h - 666 * LOGO_SCALE) / 2 + 6;
const CLICK = { x: CARD.x + CARD.w * 0.66, y: CARD.y + CARD.h * 0.6 };

// ---- camera ----------------------------------------------------------------
const HITS: { f: number; amp: number }[] = [
  { f: T.land.house, amp: 9 },
  { f: T.land.slatA, amp: 6 },
  { f: T.land.slatB, amp: 6 },
  { f: T.land.door, amp: 12 },
  { f: T.label1, amp: 3 },
  { f: T.label2, amp: 3 },
  { f: T.press, amp: 14 },
];

const camera = (f: number) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const h of HITS) {
    const t = f - h.f;
    if (t < 0 || t > 6) continue;
    const a = h.amp * Math.exp(-0.65 * t);
    x += a * (rand(h.f * 7 + t) * 2 - 1);
    y += a * (rand(h.f * 13 + t + 3) * 2 - 1) * 0.6 + (t === 0 ? a * 0.8 : 0);
    r += a * 0.04 * (rand(h.f * 3 + t + 9) * 2 - 1);
  }
  // slow push + roll drift
  const s = 1 + 0.03 * (f / PRESS_FRAMES);
  r += interpolate(f, [0, PRESS_FRAMES], [-0.35, 0.35]);
  return { transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})` };
};

// ---- pieces ----------------------------------------------------------------
const PIECE_FILL: Record<LogoPiece, string> = { house: C.ink, slatA: C.ink, slatB: C.ink, door: C.yellow };
const PIECE_SHADOW: Record<LogoPiece, string> = { house: C.twitch, slatA: C.twitch, slatB: C.twitch, door: C.ink };

const Piece: React.FC<{ p: LogoPiece; f: number }> = ({ p, f }) => {
  const land = T.land[p];
  const t = f - land;
  if (t < -T.fall) return null;
  const sh = 22 / LOGO_SCALE; // 22px offset in logo units
  let ty = 0;
  let sx = 1;
  let sy = 1;
  let ghosts: number[] = [];
  if (t < 0) {
    // gravity fall (accelerating), stretched on the way down
    const pp = (t + T.fall) / T.fall;
    ty = -1500 * (1 - pp * pp);
    sy = 1 + 0.35 * pp;
    sx = 1 - 0.08 * pp;
    ghosts = [0.55, 0.3, 0.12];
  } else {
    // squash on landing, ring out
    const k = ring(t, 0.5, 0.42);
    sy = 1 - 0.2 * k;
    sx = 1 + 0.12 * k;
  }
  // shadow snaps on at landing with a little overshoot
  const shK = t < 0 ? 0 : t === 0 ? 1.35 : t === 1 ? 0.9 : 1;
  const stroke = p === "door" ? { stroke: C.ink, strokeWidth: 10 / LOGO_SCALE, strokeLinejoin: "miter" as const } : {};
  const fallSpeed = t < 0 ? 2 * 1500 * ((t + T.fall) / T.fall) / T.fall : 0;
  return (
    <g style={{ transform: `translateY(${ty}px)` }}>
      {ghosts.map((o, i) => (
        <path
          key={i}
          d={LOGO_PATHS[p]}
          fill={PIECE_FILL[p]}
          opacity={o * 0.5}
          style={{
            transform: `translateY(${-(i + 1) * fallSpeed * 0.28}px) scale(${sx}, ${sy})`,
            transformBox: "fill-box",
            transformOrigin: "50% 100%",
          }}
        />
      ))}
      <g style={{ transform: `scale(${sx}, ${sy})`, transformBox: "fill-box", transformOrigin: "50% 100%" }}>
        {shK > 0 && (
          <path d={LOGO_PATHS[p]} fill={PIECE_SHADOW[p]} style={{ transform: `translate(${sh * shK}px, ${sh * shK}px)` }} />
        )}
        <path d={LOGO_PATHS[p]} fill={PIECE_FILL[p]} {...stroke} />
      </g>
    </g>
  );
};

// ---- press state shared by everything that "pushes in" --------------------
/** 0 = resting (shadow out), negative = lifted, 1 = fully pressed. */
const pressAmount = (f: number, delay = 0) => {
  const fl = f - delay;
  const lift = interpolate(fl, [T.lift, T.press - 1], [0, -0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  if (fl < T.press) return lift;
  // snaps in, tiny rebound
  const t = fl - T.press;
  return 1 - 0.12 * Math.max(0, ring(t - 1, 0.6, 0.6));
};

// ---- the card --------------------------------------------------------------
const Card: React.FC<{ f: number }> = ({ f }) => {
  const pop = springTo(f - T.cardPop, 0.3, 0.32);
  if (f < T.cardPop) return null;
  const pr = pressAmount(f);
  const off = CARD.shadow * (1 - pr); // pressed → 0, lifted → bigger
  const tx = CARD.shadow - off;
  const squash = f >= T.press ? 1 - 0.035 * Math.max(0, ring(f - T.press, 0.7, 0.5)) : 1;
  const shadowOn = f >= T.cardPop + 3;
  return (
    <div
      style={{
        position: "absolute",
        left: CARD.x,
        top: CARD.y,
        width: CARD.w,
        height: CARD.h,
        transform: `translate(${tx}px, ${tx}px) scale(${(0.6 + 0.4 * pop) * (2 - squash)}, ${(0.6 + 0.4 * pop) * squash})`,
        transformOrigin: "50% 60%",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#ffffff",
          border: `${CARD.border}px solid ${C.ink}`,
          boxShadow: shadowOn ? `${off}px ${off}px 0 0 ${C.ink}` : "none",
        }}
      />
      {/* corner ticks, like a UI component spec */}
      <div style={{ position: "absolute", left: 22, top: 18, fontFamily: FONT_MONO, fontWeight: 700, fontSize: 26, letterSpacing: "0.18em" }}>
        WH—S/01
      </div>
      <div
        style={{
          position: "absolute",
          right: 22,
          top: 18,
          fontFamily: FONT_MONO,
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: "0.18em",
          background: C.ink,
          color: C.yellow,
          padding: "2px 10px",
        }}
      >
        ▶ PLAY
      </div>
    </div>
  );
};

const LogoLayer: React.FC<{ f: number }> = ({ f }) => {
  const pr = Math.max(0, pressAmount(f));
  const lift = Math.min(0, pressAmount(f));
  const tx = CARD.shadow * pr + CARD.shadow * lift;
  const squash = f >= T.press ? 1 - 0.035 * Math.max(0, ring(f - T.press, 0.7, 0.5)) : 1;
  return (
    <svg
      width={LOGO_W}
      height={666 * LOGO_SCALE}
      viewBox="0 0 1000 666"
      style={{
        position: "absolute",
        left: LOGO_X,
        top: LOGO_Y,
        overflow: "visible",
        transform: `translate(${tx}px, ${tx}px) scale(${2 - squash}, ${squash})`,
      }}
    >
      {LOGO_ORDER.map((p) => (
        <Piece key={p} p={p} f={f} />
      ))}
    </svg>
  );
};

// ---- header strip ----------------------------------------------------------
const Header: React.FC<{ f: number }> = ({ f }) => {
  const start = 10;
  if (f < start) return null;
  const p = expoOut(prog(f, start, 8));
  const pr = pressAmount(f, 4);
  const off = 8 * (1 - pr);
  const items = ["WATERHOUSE STUDIOS", "AMSTERDAM", "EP.TUE"];
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        top: 196,
        width: 860,
        height: 70,
        transform: `translate(${8 - off}px, ${8 - off}px)`,
        clipPath: `inset(-20px ${(1 - p) * 100}% -20px -20px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: C.paper,
          border: `6px solid ${C.ink}`,
          boxShadow: `${off}px ${off}px 0 0 ${C.ink}`,
          display: "flex",
          alignItems: "stretch",
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: "0.2em",
        }}
      >
        {items.map((t, i) => (
          <div
            key={t}
            style={{
              flex: i === 0 ? 2.2 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderLeft: i === 0 ? "none" : `6px solid ${C.ink}`,
              background: i === 2 ? C.twitch : "transparent",
              color: i === 2 ? C.paper : C.ink,
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---- labels ----------------------------------------------------------------
const Label: React.FC<{
  f: number;
  start: number;
  text: string;
  top: number;
  left: number;
  bg: string;
  color: string;
  rot: number;
  size: number;
  pressDelay: number;
}> = ({ f, start, text, top, left, bg, color, rot, size, pressDelay }) => {
  if (f < start) return null;
  const p = expoOut(prog(f, start, 7));
  const pt = expoOut(prog(f, start + 1.5, 7));
  const settle = ring(f - start - 5, 0.5, 0.45);
  const pr = pressAmount(f, pressDelay);
  const sh = 14;
  const off = sh * (1 - pr);
  const tx = sh - off;
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        transform: `translate(${(1 - p) * -120 + tx}px, ${tx}px) rotate(${rot + settle * 1.2}deg)`,
        transformOrigin: "0% 50%",
        clipPath: `inset(-40px ${(1 - p) * 100}% -40px -40px)`,
      }}
    >
      <div
        style={{
          background: bg,
          color,
          border: `7px solid ${C.ink}`,
          boxShadow: `${off}px ${off}px 0 0 ${C.ink}`,
          padding: "16px 26px 12px",
          fontFamily: FONT_DISPLAY,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <div style={{ transform: `translateX(${(1 - pt) * -60}px)` }}>{text}</div>
      </div>
    </div>
  );
};

const Tag: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.tag) return null;
  const full = `${COPY.day} · ${COPY.host}`;
  const n = Math.min(full.length, Math.floor((f - T.tag) * 2.5) + 1);
  const box = expoOut(prog(f, T.tag, 4));
  const pr = pressAmount(f, 3);
  const off = 8 * (1 - pr);
  const blink = Math.floor(f / 4) % 2 === 0 || n < full.length;
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        top: 1408,
        transform: `translate(${8 - off}px, ${8 - off}px) scaleX(${0.2 + 0.8 * box})`,
        transformOrigin: "0% 50%",
        background: C.ink,
        color: C.yellow,
        fontFamily: FONT_MONO,
        fontWeight: 800,
        fontSize: 40,
        letterSpacing: "0.22em",
        padding: "12px 18px",
        boxShadow: `${off}px ${off}px 0 0 ${C.yellow}`,
        whiteSpace: "pre",
      }}
    >
      {full.slice(0, n)}
      <span style={{ opacity: blink ? 1 : 0 }}>█</span>
    </div>
  );
};

const Tape: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.tape) return null;
  const p = expoOut(prog(f, T.tape, 8));
  const scroll = (f - T.tape) * 6;
  return (
    <div
      style={{
        position: "absolute",
        left: -100,
        top: 1536,
        width: W + 200,
        height: 64,
        transform: `translateX(${(1 - p) * (W + 200)}px) rotate(-4deg)`,
        borderTop: `7px solid ${C.ink}`,
        borderBottom: `7px solid ${C.ink}`,
        background: `repeating-linear-gradient(45deg, ${C.ink} 0 22px, ${C.yellow} 22px 44px)`,
        backgroundPosition: `${-scroll}px 0`,
      }}
    />
  );
};

// ---- cursor ----------------------------------------------------------------
const CURSOR_PATH = "M0 0 L0 108 L28 82 L47 126 L68 117 L49 74 L86 74 Z";

const Cursor: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.cursorIn) return null;
  const p = expoOut(prog(f, T.cursorIn, T.cursorArrive - T.cursorIn));
  // quadratic arc from bottom-right
  const P0 = { x: 1180, y: 1560 };
  const P1 = { x: 1060, y: 760 };
  const P2 = { x: CLICK.x, y: CLICK.y };
  let x = (1 - p) * (1 - p) * P0.x + 2 * (1 - p) * p * P1.x + p * p * P2.x;
  let y = (1 - p) * (1 - p) * P0.y + 2 * (1 - p) * p * P1.y + p * p * P2.y;
  // hover wobble before press
  if (f >= T.cursorArrive && f < T.press) {
    const t = f - T.cursorArrive;
    x += Math.sin(t * 1.3) * 5;
    y += Math.cos(t * 1.1) * 4 - t * 1.5;
  }
  // follow the card in on press
  const pr = Math.max(0, pressAmount(f));
  x += CARD.shadow * pr;
  y += CARD.shadow * pr;
  const click = f >= T.press - 1 && f < T.press + 2 ? 0.86 : 1;
  const tilt = (1 - p) * -18;
  const speed = 1 - p;
  return (
    <svg
      width={140}
      height={170}
      viewBox="-10 -10 120 150"
      style={{
        position: "absolute",
        left: x - 14,
        top: y - 14,
        overflow: "visible",
        transform: `rotate(${tilt}deg) scale(${click * (1 + speed * 0.15)}, ${click * (1 - speed * 0.08)})`,
        transformOrigin: "14px 14px",
      }}
    >
      <path d={CURSOR_PATH} fill={C.ink} transform="translate(10 10)" />
      <path d={CURSOR_PATH} fill={C.ink} stroke={C.paper} strokeWidth={8} strokeLinejoin="miter" paintOrder="stroke" />
      <path d={CURSOR_PATH} fill={C.ink} />
    </svg>
  );
};

/** Comic impact lines at the click point. */
const Burst: React.FC<{ f: number }> = ({ f }) => {
  const t = f - T.press;
  if (t < 0 || t > 6) return null;
  const p = expoOut(t / 6);
  const n = 9;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {Array.from({ length: n }).map((_, i) => {
        const a = (i / n) * Math.PI * 2 + 0.3;
        const r0 = 80 + 170 * p;
        const r1 = r0 + 110 * (1 - p) + 14;
        const cx = CLICK.x + CARD.shadow;
        const cy = CLICK.y + CARD.shadow;
        return (
          <line
            key={i}
            x1={cx + Math.cos(a) * r0}
            y1={cy + Math.sin(a) * r0}
            x2={cx + Math.cos(a) * r1}
            y2={cy + Math.sin(a) * r1}
            stroke={i % 3 === 0 ? C.twitch : C.ink}
            strokeWidth={20 * (1 - p) + 5}
            strokeLinecap="square"
          />
        );
      })}
    </svg>
  );
};

// ---- the full paper scene --------------------------------------------------
const Scene: React.FC<{ f: number; frozen?: boolean }> = ({ f, frozen }) => (
  <AbsoluteFill style={{ backgroundColor: C.paper }}>
    <AbsoluteFill style={camera(f)}>
      <Header f={f} />
      <Card f={f} />
      <LogoLayer f={f} />
      <Label f={f} start={T.label1} text={COPY.title1} top={1070} left={64} bg={C.ink} color={C.paper} rot={-2} size={102} pressDelay={1} />
      <Label f={f} start={T.label2} text={COPY.title2} top={1224} left={150} bg={C.yellow} color={C.ink} rot={1.5} size={118} pressDelay={2} />
      <Tag f={f} />
      <Tape f={f} />
      {!frozen && <Burst f={f} />}
      <Cursor f={f} />
    </AbsoluteFill>
    <Grain opacity={0.09} />
  </AbsoluteFill>
);

// ---- stack wipe in ---------------------------------------------------------
const WIPE_COLORS = [C.yellow, C.twitch, C.ink];
const SLOPE = 140; // px rise across the width — angled leading edge

const wipeEdge = (f: number, i: number) => {
  const p = expoOut(prog(f, T.wipe[i], T.wipeDur));
  return H + SLOPE + 40 - p * (H + SLOPE + 80); // y of leading edge (left side)
};

const WipeLayer: React.FC<{ f: number; i: number; color: string }> = ({ f, i, color }) => {
  if (f < T.wipe[i]) return null;
  const y = wipeEdge(f, i);
  const yPrev = wipeEdge(f - 1, i);
  const v = Math.max(0, yPrev - y);
  const poly = (yy: number) => `polygon(0 ${yy}px, 100% ${yy - SLOPE}px, 100% 100%, 0 100%)`;
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: C.ink, clipPath: poly(y - 10 - Math.min(60, v * 0.12)) }} />
      <AbsoluteFill style={{ backgroundColor: color, clipPath: poly(y) }} />
    </>
  );
};

// ---- exit slats ------------------------------------------------------------
const N_SLATS = 10;
const SLAT_H = H / N_SLATS;

const Slats: React.FC<{ f: number }> = ({ f }) => {
  const clickSlat = Math.floor((CLICK.y + CARD.shadow) / SLAT_H);
  const cracking = f >= T.split && f < T.exitStart + 2;
  return (
    <AbsoluteFill>
      {Array.from({ length: N_SLATS }).map((_, i) => {
        const delay = Math.abs(i - clickSlat) * 0.9;
        const kick = (q: number) => (q <= 0 ? 0 : Math.pow(q, 2.2));
        const p = prog(f, T.exitStart + delay, T.exitDur);
        const anticip = f - T.exitStart - delay >= -1 && p === 0 ? -0.015 : 0;
        const e = kick(p) + anticip;
        const ePrev = kick(prog(f - 1, T.exitStart + delay, T.exitDur));
        const dir = i % 2 === 0 ? -1 : 1;
        const dist = W * 1.25;
        const x = dir * e * dist;
        const v = Math.abs(e - ePrev) * dist;
        if (e >= 1) return null;
        const top = i * SLAT_H;
        // a few pixels of vertical jitter as each slat breaks loose
        const jitter = p > 0 && p < 0.3 ? (rand(i * 5 + f) * 2 - 1) * 6 : 0;
        const blurLevel = Math.min(5, Math.round(v / 40));
        return (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${top}px 0 ${H - top - SLAT_H}px 0)`,
              transform: `translate(${x}px, ${jitter}px) skewX(${-dir * Math.min(10, v / 30)}deg)`,
              filter: blurLevel > 0 ? `url(#press-hblur-${blurLevel})` : undefined,
            }}
          >
            <Scene f={Math.min(f, T.split)} frozen={f > T.split} />
            {/* black slat edges once it breaks */}
            {(cracking || p > 0) && (
              <>
                <div style={{ position: "absolute", left: 0, right: 0, top, height: 6, background: C.ink }} />
                <div style={{ position: "absolute", left: 0, right: 0, top: top + SLAT_H - 6, height: 6, background: C.ink }} />
              </>
            )}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

const BlurDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <defs>
      {[1, 2, 3, 4, 5].map((l) => (
        <filter key={l} id={`press-hblur-${l}`} x="-20%" y="0%" width="140%" height="100%">
          <feGaussianBlur stdDeviation={`${l * 9} 0`} />
        </filter>
      ))}
    </defs>
  </svg>
);

// ---- sound -----------------------------------------------------------------
const sfx = (name: string) => staticFile(`audio/${name}`);
const Sfx: React.FC<{ at: number; src: string; volume?: number }> = ({ at, src, volume = 1 }) => (
  <Sequence from={Math.max(0, Math.round(at))} layout="none">
    <Audio src={sfx(src)} volume={volume} />
  </Sequence>
);

const Sound: React.FC = () => (
  <>
    <Sfx at={0} src="recap/whoosh.wav" volume={0.7} />
    <Sfx at={4} src="pullup/whoosh.wav" volume={0.35} />
    <Sfx at={T.cardPop + 2} src="recap/pop.wav" volume={0.6} />
    <Sfx at={11} src="recap/tick.wav" volume={0.5} />
    <Sfx at={T.land.house} src="pullup/thud.wav" volume={0.9} />
    <Sfx at={T.land.house} src="recap/land.wav" volume={0.5} />
    <Sfx at={T.land.slatA} src="pullup/thud.wav" volume={0.7} />
    <Sfx at={T.land.slatB} src="pullup/thud.wav" volume={0.75} />
    <Sfx at={T.land.door} src="recap/slam.wav" volume={0.85} />
    <Sfx at={T.land.door} src="bumper/thump.wav" volume={0.6} />
    <Sfx at={T.label1} src="recap/whoosh.wav" volume={0.35} />
    <Sfx at={T.label1 + 2} src="recap/tick.wav" volume={0.6} />
    <Sfx at={T.label2} src="recap/whoosh.wav" volume={0.35} />
    <Sfx at={T.label2 + 2} src="recap/tick.wav" volume={0.6} />
    {Array.from({ length: 8 }).map((_, i) => (
      <Sfx key={i} at={T.tag + i * 1} src="bumper/led-click.wav" volume={0.35} />
    ))}
    <Sfx at={T.tape} src="pullup/whoosh.wav" volume={0.25} />
    <Sfx at={T.cursorIn + 2} src="recap/whoosh.wav" volume={0.3} />
    <Sfx at={T.press} src="pullup/click.wav" volume={1} />
    <Sfx at={T.press} src="bumper/relay.wav" volume={0.7} />
    <Sfx at={T.press} src="recap/slam.wav" volume={0.45} />
    <Sfx at={T.exitStart - 1} src="pullup/whoosh.wav" volume={0.6} />
    <Sfx at={T.exitStart} src="recap/whoosh.wav" volume={0.5} />
  </>
);

// ---- composition -----------------------------------------------------------
export const Press: React.FC = () => {
  const f = useCurrentFrame();
  const paperIn = f >= T.wipe[3];
  const paperSettled = f >= T.wipe[3] + T.wipeDur;
  return (
    <AbsoluteFill>
      <BlurDefs />
      {/* stack wipe: colour layers only until the paper covers them */}
      {!paperSettled && WIPE_COLORS.map((c, i) => <WipeLayer key={i} f={f} i={i} color={c} />)}
      {paperIn && !paperSettled && (
        <AbsoluteFill
          style={{ backgroundColor: C.ink, clipPath: `polygon(0 ${wipeEdge(f, 3) - 10}px, 100% ${wipeEdge(f, 3) - 10 - SLOPE}px, 100% 100%, 0 100%)` }}
        />
      )}
      {paperIn && f < T.split && (
        <AbsoluteFill
          style={{
            clipPath: paperSettled
              ? undefined
              : `polygon(0 ${wipeEdge(f, 3)}px, 100% ${wipeEdge(f, 3) - SLOPE}px, 100% 100%, 0 100%)`,
          }}
        >
          <Scene f={f} />
        </AbsoluteFill>
      )}
      {f >= T.split && <Slats f={f} />}
      {f > T.split && (
        <AbsoluteFill style={camera(f)}>
          <Burst f={f} />
        </AbsoluteFill>
      )}
      <Sound />
    </AbsoluteFill>
  );
};
