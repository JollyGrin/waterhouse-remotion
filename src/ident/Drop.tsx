import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, LOGO_PATHS, LogoPiece, rand } from "./brand";
import { Grain } from "./common";

/**
 * DROP — physics comedy. The mark is a pile of heavy brutal blocks.
 * The title rains onto a hazard-taped ledge as keycap tiles, the house is built on top of it piece by
 * piece, the door is late (one beat of silence, then it comes in from orbit and everything hops — which
 * also knocks the crooked H straight). A sign drops on chains under the ledge. Then the latch clicks, the
 * ledge splits into a trapdoor, one frame of hang-time, and everything falls out of frame; the paper set
 * drops after it, trailing a yellow sheet, and the content is underneath.
 *
 * Deterministic per-frame physics (gravity, restitution, resting state), 120 bpm grid (beat = 15 f).
 */
export const DROP_FRAMES = 124;

// ---------------------------------------------------------------------------
// layout

const LEDGE_Y = 1230; // ledge top surface = floor
const LEDGE_H = 54; // face height incl. borders
const LEDGE_BOTTOM = LEDGE_Y + LEDGE_H;
const S = 0.8; // logo units -> px
const X0 = 106;
const S_ROW_TOP = LEDGE_Y - 118; // SESSIONS row top
const W_ROW_TOP = S_ROW_TOP - 100; // WATERHOUSE row top = logo baseline
const Y0 = W_ROW_TOP - 665.9 * S; // logo origin

const T = {
  latch: 88,
  open: 91,
  fall: 93, // after 2 frames of hang-time
  sheet: 96,
  tag: 76,
};

// ---------------------------------------------------------------------------
// bodies

type Kind = "letter" | "piece" | "door";
type Body = {
  id: string;
  kind: Kind;
  x: number;
  y: number; // rest top
  w: number;
  h: number;
  dropAt: number;
  startTop: number;
  v0: number;
  g: number;
  e: number; // restitution
  hopV: number;
  rot0: number;
  crooked?: number;
  char?: string;
  color?: string;
  fs?: number;
  piece?: LogoPiece;
  bbox?: [number, number, number, number];
  seed: number;
};

const perm = (n: number, seed: number) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand(seed + i * 3.1) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const P = C.paper;
const Y = C.yellow;
const A = C.amber;
const U = C.twitch;
const W_COLORS = [Y, P, A, P, U, Y, P, A, P, U];
const S_COLORS = [P, Y, P, U, P, A, P, Y];

const letters = (): Body[] => {
  const out: Body[] = [];
  const sOrder = perm(8, 11);
  "SESSIONS".split("").forEach((ch, i) => {
    out.push({
      id: `s${i}`,
      kind: "letter",
      x: 64 + i * 112,
      y: S_ROW_TOP,
      w: 108,
      h: 118,
      dropAt: Math.round(sOrder[i] * 1.1),
      startTop: -150 - rand(i * 7 + 1) * 140,
      v0: 55,
      g: 14,
      e: 0.15,
      hopV: 26,
      rot0: (rand(i * 5 + 2) - 0.5) * 24,
      char: ch,
      color: S_COLORS[i],
      fs: 74,
      seed: i * 17 + 3,
    });
  });
  const wOrder = perm(10, 29);
  "WATERHOUSE".split("").forEach((ch, i) => {
    out.push({
      id: `w${i}`,
      kind: "letter",
      x: 62 + i * 90,
      y: W_ROW_TOP,
      w: 86,
      h: 100,
      dropAt: 14 + Math.round(wOrder[i] * 1.0),
      startTop: -130 - rand(i * 9 + 4) * 140,
      v0: 55,
      g: 14,
      e: 0.22,
      hopV: 26,
      rot0: (rand(i * 3 + 8) - 0.5) * 28,
      crooked: ch === "H" ? 10 : undefined,
      char: ch,
      color: W_COLORS[i],
      fs: 58,
      seed: i * 23 + 101,
    });
  });
  return out;
};

const BBOX: Record<LogoPiece, [number, number, number, number]> = {
  house: [0, 2, 348, 663.5],
  slatA: [379.6, 48.6, 305.6, 239],
  slatB: [722.2, 160.9, 277.8, 212],
  door: [596.5, 397.9, 178.7, 268],
};

const piece = (p: LogoPiece, dropAt: number, startTop: number, extra: Partial<Body> = {}): Body => {
  const [bx, by, bw, bh] = BBOX[p];
  return {
    id: p,
    kind: p === "door" ? "door" : "piece",
    x: X0 + bx * S,
    y: Y0 + by * S,
    w: bw * S,
    h: bh * S,
    dropAt,
    startTop,
    v0: 60,
    g: 14,
    e: 0.1,
    hopV: 17,
    rot0: 0,
    piece: p,
    bbox: BBOX[p],
    seed: p.length * 31 + dropAt,
    ...extra,
  };
};

const BODIES: Body[] = [
  ...letters(),
  piece("house", 28, -600, { rot0: -5 }),
  piece("slatA", 37, -260, { rot0: 7 }),
  piece("slatB", 44, -240, { rot0: -6 }),
  // late, from orbit
  piece("door", 54, -2600, { v0: 120, g: 18, e: 0.08, rot0: 3 }),
];

type Impact = { f: number; v: number };
type State = { visible: boolean; dy: number; v: number; impacts: Impact[] };

const simulate = (b: Body, frame: number, hop: number | null): State => {
  let y = b.startTop - b.y;
  let v = b.v0;
  let resting = false;
  const impacts: Impact[] = [];
  if (frame < b.dropAt) return { visible: false, dy: y, v: 0, impacts };
  for (let f = b.dropAt + 1; f <= frame; f++) {
    if (hop !== null && f === hop && b.kind !== "door" && resting) {
      v = -b.hopV;
      resting = false;
    }
    if (resting) continue;
    v += b.g;
    y += v;
    if (y >= 0) {
      y = 0;
      impacts.push({ f, v });
      v = -v * b.e;
      if (Math.abs(v) < 5) {
        v = 0;
        resting = true;
      }
    }
  }
  return { visible: true, dy: y, v, impacts };
};

const DOOR = BODIES.find((b) => b.kind === "door")!;
const HOP = simulate(DOOR, 300, null).impacts[0].f; // the door's slam = everyone hops

// Static impact list (for sound + shake).
const ALL_IMPACTS = BODIES.flatMap((b) => simulate(b, 300, HOP).impacts.map((i) => ({ ...i, b })));

// ---------------------------------------------------------------------------
// camera shake

const SHAKES: { f: number; amp: number }[] = [
  ...ALL_IMPACTS.filter((i) => i.v > 40).map((i) => ({
    f: i.f,
    amp:
      i.b.kind === "door"
        ? 26
        : i.b.kind === "piece"
          ? (i.b.id === "house" ? 12 : 8) * Math.min(1, i.v / 180)
          : 1.4 * Math.min(1, i.v / 200),
  })),
  { f: T.tag + 5, amp: 4 },
  { f: T.latch, amp: 3 },
  { f: T.open + 6, amp: 7 },
];

const shake = (frame: number) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const { f, amp } of SHAKES) {
    const t = frame - f;
    if (t < 0 || t > 10) continue;
    const k = amp * Math.exp(-t / 2.4);
    x += (rand(f * 13 + t) - 0.5) * 2 * k;
    y += (rand(f * 29 + t + 7) - 0.5) * 2 * k;
    r += (rand(f * 41 + t + 3) - 0.5) * 0.22 * k;
  }
  // cap the sum so a letter cascade can't add up to an earthquake
  const m = 30;
  return { x: Math.max(-m, Math.min(m, x)), y: Math.max(-m, Math.min(m, y)), r: Math.max(-1.5, Math.min(1.5, r)) };
};

// ---------------------------------------------------------------------------
// per-body motion

const SQUASH_CAP: Record<Kind, number> = { letter: 0.26, piece: 0.2, door: 0.32 };
const JIG: Record<Kind, number> = { letter: 0.008, piece: 0.03, door: 0.075 };

const MAIN_LANDINGS = BODIES.map((b) => {
  const imp = simulate(b, 300, HOP).impacts[0];
  return { id: b.id, f: imp.f, jig: JIG[b.kind] };
});

const rotationOf = (b: Body, st: State, frame: number) => {
  const imps = st.impacts;
  if (!imps.length) return b.rot0;
  let from = b.rot0;
  let target = 0;
  let since = imps[0].f;
  if (b.crooked) {
    const re = imps.find((i) => i.f > HOP);
    if (re) {
      from = b.crooked;
      target = 0;
      since = re.f;
    } else {
      target = b.crooked;
      if (frame >= HOP) return b.crooked + Math.sin((frame - HOP) * 0.9) * 2; // airborne wobble
    }
  }
  const dt = frame - since;
  let r = target + (from - target) * Math.exp(-dt / 2.2) * Math.cos(dt * 0.9);
  for (const i of imps) {
    const d = frame - i.f;
    if (d >= 0 && d < 14) r += (rand(i.f * 7 + b.seed) - 0.5) * 2 * Math.min(1, i.v / 200) * 3 * Math.exp(-d / 3) * Math.sin(d * 1.2);
  }
  return r;
};

const squashOf = (b: Body, st: State, frame: number) => {
  let s = 0;
  const cap = SQUASH_CAP[b.kind];
  for (const i of st.impacts) {
    const d = frame - i.f;
    if (d >= 0 && d < 12) s += Math.min(cap, i.v / (b.kind === "letter" ? 650 : 520)) * Math.exp(-d / 2.4) * Math.cos(d * 1.5);
  }
  if (st.dy === 0) {
    for (const g of MAIN_LANDINGS) {
      if (g.id === b.id) continue;
      const d = frame - g.f;
      if (d >= 0 && d < 10) s += g.jig * Math.exp(-d / 2) * Math.cos(d * 1.7);
    }
  }
  let sy = 1 - s;
  let sx = 1 + s * 0.7;
  if (st.dy < 0 && st.v !== 0) {
    const k = Math.min(b.kind === "door" ? 0.45 : 0.28, Math.abs(st.v) / 600);
    sy *= 1 + k;
    sx /= 1 + k * 0.6;
  }
  return { sx, sy };
};

// exit: trapdoor fall
const exitOf = (b: Body, frame: number) => {
  const cx = b.x + b.w / 2;
  const delay = (Math.abs(cx - 540) / 540) * 2; // centre goes first: the doors open from the middle
  const t = frame - T.fall - delay;
  if (frame < T.open) return { dx: 0, dy: 0, r: 0, sy: 1 };
  if (t <= 0) {
    // hang-time: a tiny "uh-oh" stretch
    const h = Math.min(1, (frame - T.open + 1) / 2);
    return { dx: 0, dy: -3 * h, r: 0, sy: 1 + 0.035 * h };
  }
  const dir = rand(b.seed * 3.3) > 0.5 ? 1 : -1;
  return {
    dx: dir * t * (1.5 + rand(b.seed) * 2),
    dy: 5.5 * t * t + 6 * t,
    r: dir * Math.pow(t, 1.5) * (0.6 + rand(b.seed + 1) * 0.8),
    sy: 1 + Math.min(0.18, t * 0.02),
  };
};

// ---------------------------------------------------------------------------
// renderers

const LetterTile: React.FC<{ b: Body; shadow: number }> = ({ b, shadow }) => (
  <div
    style={{
      width: b.w,
      height: b.h,
      boxSizing: "border-box",
      background: b.color,
      border: `5px solid ${C.ink}`,
      boxShadow: `${shadow}px ${shadow}px 0 ${C.ink}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: FONT_DISPLAY,
      fontSize: b.fs,
      lineHeight: 1,
      color: C.ink,
      paddingTop: 4,
    }}
  >
    {b.char}
  </div>
);

const PieceShape: React.FC<{ b: Body; shadow: number }> = ({ b, shadow }) => {
  const [bx, by, bw, bh] = b.bbox!;
  const so = shadow / S;
  return (
    <svg width={b.w} height={b.h} viewBox={`${bx} ${by} ${bw} ${bh}`} style={{ overflow: "visible", display: "block" }}>
      <path d={LOGO_PATHS[b.piece!]} transform={`translate(${so} ${so})`} fill={C.yellow} stroke={C.ink} strokeWidth={5 / S} strokeLinejoin="round" />
      <path d={LOGO_PATHS[b.piece!]} fill={C.ink} stroke={C.ink} strokeWidth={2 / S} strokeLinejoin="round" />
    </svg>
  );
};

const BodyView: React.FC<{ b: Body; frame: number }> = ({ b, frame }) => {
  const st = simulate(b, frame, HOP);
  if (!st.visible) return null;
  const ex = exitOf(b, frame);
  const rot = rotationOf(b, st, frame) + ex.r;
  const { sx, sy } = squashOf(b, st, frame);
  const lift = -st.dy;
  const baseShadow = b.kind === "letter" ? 9 : 16;
  const shadow = baseShadow + Math.min(26, lift * 0.045);
  const origin = b.crooked && rot > 1 ? "100% 100%" : "50% 100%";
  const top = b.y + st.dy + ex.dy;
  if (top > 2100) return null;
  const inner = b.kind === "letter" ? <LetterTile b={b} shadow={shadow} /> : <PieceShape b={b} shadow={shadow} />;
  const ghosts = st.v > 70 && st.dy < 0 ? [0.45, 0.9] : [];
  return (
    <>
      {ghosts.map((k, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x + ex.dx,
            top: top - st.v * k,
            width: b.w,
            height: b.h,
            opacity: i === 0 ? 0.22 : 0.1,
            transform: `rotate(${rot}deg) scale(${sx}, ${sy * ex.sy})`,
            transformOrigin: origin,
          }}
        >
          {inner}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: b.x + ex.dx,
          top,
          width: b.w,
          height: b.h,
          transform: `rotate(${rot}deg) scale(${sx}, ${sy * ex.sy})`,
          transformOrigin: origin,
        }}
      >
        {inner}
      </div>
    </>
  );
};

const HAZARD = `repeating-linear-gradient(45deg, ${C.ink} 0 16px, ${C.yellow} 16px 32px)`;

const LedgeHalf: React.FC<{ side: "L" | "R" | "full"; angle: number; dy: number }> = ({ side, angle, dy }) => {
  const left = side === "R" ? 540 : -20;
  const width = side === "full" ? 1120 : 560;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: LEDGE_Y + dy,
        width,
        height: LEDGE_H,
        boxSizing: "border-box",
        border: `6px solid ${C.ink}`,
        borderTopWidth: 12,
        background: HAZARD,
        boxShadow: `0 16px 0 ${C.ink}`,
        transform: `rotate(${side === "R" ? -angle : angle}deg)`,
        transformOrigin: side === "R" ? "100% 0%" : "0% 0%",
        overflow: "hidden",
      }}
    >
      {/* the load label, which splits with the trapdoor */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 540 - 190 - left - 6,
          width: 380,
          height: 26,
          background: C.ink,
          color: C.yellow,
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 20,
          letterSpacing: "0.16em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "nowrap",
        }}
      >
        MAX LOAD: 1 SESSION
      </div>
    </div>
  );
};

const trapAngle = (frame: number) => {
  const t = frame - T.open;
  if (t <= 0) return 0;
  if (t < 6) return 2.5 * t * t;
  const d = t - 6;
  return 90 + 14 * Math.exp(-d / 3) * Math.sin(d * 1.1);
};

const Tag: React.FC<{ frame: number }> = ({ frame }) => {
  const t = frame - T.tag;
  if (t < 0) return null;
  const TAG_W = 680;
  const TAG_H = 78;
  const L = 52; // chain length
  const cx = 500;
  const fallDy = Math.min(0, -(L + TAG_H + 20) + 12 * t + 5 * t * t);
  const landT = 4.6;
  const d = t - landT;
  const jerk = d > 0 ? 14 * Math.exp(-d / 2.5) * Math.sin(d * 1.15) : 0;
  // two-chain hanging sign: a parallelogram pendulum, the sign stays level and swings on an arc
  const th = d > 0 ? ((24 * Math.PI) / 180) * Math.exp(-d / 14) * Math.sin(d * 0.42) : 0;
  const tx = cx - TAG_W / 2 + L * Math.sin(th);
  const ty = LEDGE_BOTTOM + L * Math.cos(th) + fallDy + jerk;
  const tilt = d > 0 ? 1.4 * Math.exp(-d / 6) * Math.sin(d * 1.3) : 0;
  const attach = [cx - TAG_W / 2 + 54, cx + TAG_W / 2 - 54];
  return (
    <div style={{ position: "absolute", inset: 0, clipPath: `inset(${LEDGE_BOTTOM - 2}px 0 0 0)` }}>
      {attach.map((ax, i) => {
        const ex = tx + (i === 0 ? 54 : TAG_W - 54);
        const ey = ty + 6;
        const len = Math.hypot(ex - ax, ey - LEDGE_BOTTOM);
        const ang = (Math.atan2(ex - ax, ey - LEDGE_BOTTOM) * 180) / Math.PI;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: ax - 4,
              top: LEDGE_BOTTOM - 4,
              width: 8,
              height: len + 4,
              transform: `rotate(${-ang}deg)`,
              transformOrigin: "50% 0%",
              background: `repeating-linear-gradient(to bottom, ${C.ink} 0 10px, transparent 10px 14px)`,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: tx,
          top: ty,
          width: TAG_W,
          height: TAG_H,
          boxSizing: "border-box",
          background: C.ink,
          border: `5px solid ${C.ink}`,
          boxShadow: `10px 10px 0 ${C.twitch}`,
          color: C.yellow,
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 40,
          letterSpacing: "0.14em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "nowrap",
          transform: `rotate(${tilt}deg)`,
        }}
      >
        WITH DENZO · TUESDAY
      </div>
    </div>
  );
};

const sheetFall = (frame: number, start: number) => {
  const t = frame - start;
  return t <= 0 ? 0 : 7 * t * t + 8 * t;
};

// ---------------------------------------------------------------------------

export const Drop: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = shake(frame);
  const sheetY = sheetFall(frame, T.sheet);
  const yellowY = sheetFall(frame, T.sheet + 2);
  const angle = trapAngle(frame);
  const latchShudder = frame === T.latch ? 3 : frame === T.latch + 1 ? -1 : 0;
  const split = frame >= T.latch;
  const drift = Math.sin(frame / 22) * 4;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate(${cam.x}px, ${cam.y + drift * 0.3}px) rotate(${cam.r}deg) scale(1.03)`,
          transformOrigin: "50% 55%",
        }}
      >
        {/* trailing yellow sheet */}
        {frame >= T.sheet && yellowY < 2200 && (
          <AbsoluteFill style={{ transform: `translateY(${yellowY}px)`, background: C.yellow, borderTop: `10px solid ${C.ink}` }} />
        )}
        {/* the paper set: background, ledge, sign */}
        {sheetY < 2200 && (
          <AbsoluteFill style={{ transform: `translateY(${sheetY}px)` }}>
            <AbsoluteFill
              style={{
                background: C.paper,
                backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.09) 2px, transparent 2.6px)`,
                backgroundSize: "54px 54px",
                borderTop: frame >= T.sheet ? `10px solid ${C.ink}` : undefined,
              }}
            />
            <Grain opacity={0.08} />
            <div
              style={{
                position: "absolute",
                left: 64,
                top: 150,
                fontFamily: FONT_MONO,
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: "0.18em",
                color: C.ink,
              }}
            >
              WATERHOUSE STUDIOS — AMS
            </div>
            <div
              style={{
                position: "absolute",
                left: 760,
                top: 146,
                background: C.ink,
                color: C.yellow,
                fontFamily: FONT_MONO,
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: "0.18em",
                padding: "4px 12px",
              }}
            >
              TUE/01
            </div>
            <Tag frame={frame} />
            {split ? (
              <>
                <LedgeHalf side="L" angle={angle} dy={latchShudder} />
                <LedgeHalf side="R" angle={angle} dy={latchShudder} />
              </>
            ) : (
              <LedgeHalf side="full" angle={0} dy={0} />
            )}
          </AbsoluteFill>
        )}
        {/* the blocks */}
        {BODIES.map((b) => (
          <BodyView key={b.id} b={b} frame={frame} />
        ))}
      </AbsoluteFill>
      <DropSound />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// sound

const sfx = (key: string, f: number, file: string, volume: number, rate = 1) => (
  <Sequence key={key} from={f} layout="none">
    <Audio src={staticFile(`audio/${file}.wav`)} volume={volume} playbackRate={rate} />
  </Sequence>
);

const DropSound: React.FC = () => {
  const out: React.ReactNode[] = [];
  // first landing of each body
  const firsts = BODIES.map((b) => ({ b, i: simulate(b, 300, HOP).impacts }));
  firsts.forEach(({ b, i }) => {
    if (!i.length) return;
    const f = i[0].f;
    if (b.kind === "letter") {
      const big = b.id.startsWith("s");
      out.push(sfx(`t-${b.id}`, f, "recap/tick", 0.55, (big ? 0.85 : 1.05) + rand(b.seed) * 0.25));
      if (rand(b.seed + 5) > 0.55) out.push(sfx(`tp-${b.id}`, f, "bumper/tap", 0.35, big ? 0.9 : 1.15));
    } else if (b.kind === "piece") {
      const rate = b.id === "house" ? 0.72 : b.id === "slatA" ? 0.92 : 1.02;
      out.push(sfx(`th-${b.id}`, f, "pullup/thud", 1, rate));
      out.push(sfx(`cl-${b.id}`, f, b.id === "house" ? "bumper/thump" : "bumper/clunk", b.id === "house" ? 0.55 : 0.35, b.id === "house" ? 1 : 1.2));
    } else {
      out.push(sfx("door-slam", f, "recap/slam", 0.75));
      out.push(sfx("door-thump", f, "bumper/thump", 0.65, 0.85));
      out.push(sfx("door-thud", f, "pullup/thud", 0.75, 0.62));
    }
  });
  // rows completing
  const lastS = Math.max(...firsts.filter((x) => x.b.id.startsWith("s")).map((x) => x.i[0].f));
  const lastW = Math.max(...firsts.filter((x) => x.b.id.startsWith("w")).map((x) => x.i[0].f));
  out.push(sfx("row-s", lastS, "recap/land", 0.45, 0.9));
  out.push(sfx("row-w", lastW, "recap/land", 0.45, 1.05));
  // incoming door: reverse swell into the slam
  out.push(sfx("incoming", HOP - 10, "bumper/cymbal-reverse", 0.55, 2));
  out.push(sfx("incoming-w", HOP - 6, "recap/whoosh", 0.4, 0.8));
  // hop re-landing clatter
  const reland = ALL_IMPACTS.filter((i) => i.f > HOP && i.b.kind !== "door");
  const relandF = reland.length ? Math.min(...reland.map((i) => i.f)) : HOP + 4;
  out.push(sfx("reland-a", relandF, "bumper/clack", 0.6, 0.9));
  out.push(sfx("reland-b", relandF + 1, "recap/tick", 0.5, 0.8));
  out.push(sfx("reland-c", relandF + 2, "bumper/tap", 0.45, 1.1));
  // the sign on chains
  out.push(sfx("tag-whoosh", T.tag, "pullup/whoosh", 0.18, 2.2));
  out.push(sfx("tag-chain", T.tag + 4, "bumper/relay", 0.7, 0.85));
  out.push(sfx("tag-chain2", T.tag + 5, "bumper/clack", 0.5, 0.75));
  out.push(sfx("tag-creak", T.tag + 9, "bumper/creak", 0.22, 1.6));
  // latch, trapdoor, fall
  out.push(sfx("latch", T.latch, "bumper/relay", 0.9, 0.9));
  out.push(sfx("latch-click", T.latch, "pullup/click", 0.7, 0.8));
  out.push(sfx("trap-creak", T.open, "bumper/creak", 0.5, 1.25));
  out.push(sfx("trap-bang", T.open + 6, "bumper/clunk", 0.7, 1));
  out.push(sfx("fall", T.fall, "pullup/whoosh", 0.45, 0.85));
  out.push(sfx("sheet", T.sheet + 1, "recap/whoosh", 0.4, 0.75));
  return <>{out}</>;
};
