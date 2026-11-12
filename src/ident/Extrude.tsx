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
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, LogoPiece, W, rand } from "./brand";
import { Grain } from "./common";

/**
 * EXTRUDE — "the hard shadow becomes depth".
 * The brutal offset shadow pops on, then literally extrudes into a 3D block while the
 * camera swings to a 3/4 hero angle. Type gets the same solid extrude. Exit: snap
 * dead-on, depth sucks back to zero, then shoots at camera, yellow floods, and a
 * hazard-tape band wipes the frame clear to the content.
 *
 * Beat grid: 120 bpm, beat = 15 f, half-beat = 7.5 f.
 */
export const EXTRUDE_FRAMES = 120;
const FPS = 30;

// ---- timeline (frames) ----
const T = {
  shadowPop: 2,
  swing: 12,
  pieces: { house: 12, slatA: 19, slatB: 26, door: 33 } as Record<LogoPiece, number>,
  word1: 45,
  word2: 53,
  tag: 66,
  snapBack: 82,
  collapse: 88,
  shoot: 94,
  flood: 101,
  wipeStart: 103,
  wipeEnd: 112, // fully clear from here
};

// ---- layout ----
const MW = 800; // mark width
const MH = (MW * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w;
const CX = 505;
const CY_START = 860; // centred while alone
const CY = 680; // craned up to make room for the type
const N = 40; // extrusion layers per piece
const MAX_DEPTH = 230; // px at full extrusion
const PERSPECTIVE = 2200;
// burst origin (mark-local px): the bulk of the house, so the tunnel floods outward from there
const BURST_O: [number, number] = [MW * 0.19, MH * 0.7]; // inside the house body, so the gaps never open up
const SHADOW_OFF = 24; // flat offset shadow, px

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const sp = (frame: number, at: number, config: Parameters<typeof spring>[0]["config"] = {}) =>
  spring({ frame: frame - at, fps: FPS, config });

// Decaying camera shake from a list of impacts.
const IMPACTS: { f: number; amp: number }[] = [
  { f: T.pieces.house, amp: 10 },
  { f: T.pieces.slatA, amp: 6 },
  { f: T.pieces.slatB, amp: 6 },
  { f: T.pieces.door, amp: 12 },
  { f: T.word1, amp: 7 },
  { f: T.word2, amp: 8 },
  { f: T.tag, amp: 9 },
  { f: T.collapse + 3, amp: 9 },
  { f: T.flood, amp: 18 },
];
const shake = (frame: number) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const { f, amp } of IMPACTS) {
    const t = frame - f;
    if (t < 0 || t > 10) continue;
    const k = amp * Math.exp(-t / 2.6);
    x += (rand(f * 13 + t) - 0.5) * 2 * k;
    y += (rand(f * 29 + t + 7) - 0.5) * 2 * k;
    r += (rand(f * 41 + t + 3) - 0.5) * 0.25 * k;
  }
  return { x, y, r };
};

// Sutherland–Hodgman: clip the frame rectangle to the band lo <= x + y < hi.
type Pt = [number, number];
const clipHalf = (poly: Pt[], c: number, keepGreater: boolean): Pt[] => {
  const out: Pt[] = [];
  const inside = (p: Pt) => (keepGreater ? p[0] + p[1] >= c : p[0] + p[1] <= c);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const sa = a[0] + a[1];
      const sb = b[0] + b[1];
      const t = (c - sa) / (sb - sa);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
};
const PAD = 40;
const RECT: Pt[] = [
  [-PAD, -PAD],
  [W + PAD, -PAD],
  [W + PAD, H + PAD],
  [-PAD, H + PAD],
];
const toClip = (poly: Pt[]) =>
  poly.length < 3 ? "polygon(0 0, 0 0, 0 0)" : `polygon(${poly.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;

// ---------------------------------------------------------------------------

const layerColor = (i: number) => {
  if (i === 0) return C.ink; // front face
  if (i <= 1) return C.ink; // brutal rim
  if (i >= N - 1) return C.ink; // back cap outline
  return i < N * 0.52 ? C.yellow : C.amber; // hard two-tone band, no gradients
};

/** All pieces, layer-major (back to front across pieces) so flat/burst stacking nests cleanly. */
const Block: React.FC<{
  depth: Record<LogoPiece, number>; // px, >= 0 into the screen
  burst: number; // exit: back layers scale up behind the face, a zoom-tunnel of the extrusion
  offX: number; // flat oblique offset at the back layer (the 2D shadow)
  offY: number;
}> = ({ depth, burst, offX, offY }) => {
  const layers = [];
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const sc = 1 + t * t * burst;
    for (const piece of LOGO_ORDER) {
      const z = -t * Math.max(depth[piece], 0.4);
      layers.push(
        <svg
          key={`${i}-${piece}`}
          width={MW}
          height={MH}
          viewBox={`0 0 ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            overflow: "visible",
            transform: `translate3d(${t * offX}px, ${t * offY}px, ${z}px) scale(${sc})`,
            transformOrigin: `${BURST_O[0]}px ${BURST_O[1]}px`,
          }}
        >
          <path
            d={LOGO_PATHS[piece]}
            fill={burst > 0 && i > 0 && i < N ? (Math.floor(i / 5) % 2 ? C.amber : C.yellow) : layerColor(i)}
          />
        </svg>,
      );
    }
  }
  return <>{layers}</>;
};

/** Solid stacked-offset type extrude (2D), direction follows the block's camera. */
const ExtrudedWord: React.FC<{
  text: string;
  size: number;
  len: number;
  dir: [number, number];
  color: string;
  face: string;
  style?: React.CSSProperties;
}> = ({ text, size, len, dir, color, face, style }) => {
  const steps = 16;
  const base: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    fontFamily: FONT_DISPLAY,
    fontSize: size,
    lineHeight: 1,
    whiteSpace: "nowrap",
    letterSpacing: "-0.01em",
  };
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{ ...base, position: "relative", visibility: "hidden" }}>{text}</div>
      {Array.from({ length: steps + 1 }, (_, k) => {
        const i = steps - k;
        const t = (i / steps) * len;
        const col = i === 0 ? face : i === steps ? C.ink : color;
        return (
          <div
            key={i}
            style={{
              ...base,
              color: col,
              transform: `translate(${dir[0] * t}px, ${dir[1] * t}px)`,
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
};

export const Extrude: React.FC = () => {
  const frame = useCurrentFrame();

  // ---- flat shadow pop (f2) ----
  const shadowPop = sp(frame, T.shadowPop, { damping: 9, stiffness: 260, mass: 0.6 });

  // ---- camera swing to 3/4, overshoot + settle ----
  const swing = sp(frame, T.swing, { damping: 11, stiffness: 70, mass: 1.1 });
  // snap back to dead-on at exit
  const snap = sp(frame, T.snapBack, { damping: 14, stiffness: 320, mass: 0.6 });
  const camAmt = swing * (1 - snap);

  const tHold = Math.max(0, frame - T.swing);
  const driftY = Math.sin(tHold / 22) * 2.4;
  const driftX = Math.sin(tHold / 31 + 1) * 1.2;
  const roll = Math.sin(tHold / 27) * 0.5;

  const ry = (-34 + driftY) * camAmt;
  const rx = (16 + driftX) * camAmt;
  const rz = roll * camAmt;

  // ---- per-piece depth punch, staggered on half-beats ----
  const collapse = sp(frame, T.collapse, { damping: 12, stiffness: 380, mass: 0.5 });
  const depthMul = 1 - collapse;
  const pieceDepth = (p: LogoPiece) =>
    MAX_DEPTH * sp(frame, T.pieces[p], { damping: 8, stiffness: 180, mass: 0.7 }) * depthMul * (p === "door" ? 1.08 : 1);

  // flat oblique offset: pops at f2, hands over to real depth as the camera turns
  const offBlend = interpolate(swing, [0, 0.9], [1, 0], clamp);
  const off = SHADOW_OFF * shadowPop * offBlend;
  // ---- exit: shoot at camera ----
  const shootT = interpolate(frame, [T.shoot, T.flood], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  // keeps flowing through the flood hold so the frame never sits dead
  const burst = frame >= T.shoot ? shootT * 9 + Math.max(0, frame - T.flood) * 1.1 : 0;

  // crane: the mark starts centred, lifts on the beat before the type lands
  const crane = sp(frame, T.word1 - 5, { damping: 13, stiffness: 120, mass: 0.8 });
  const cy = CY_START + (CY - CY_START) * crane;

  // press-in squash on collapse
  const squash = frame >= T.collapse ? 1 - 0.05 * Math.sin(Math.min(1, (frame - T.collapse) / 7) * Math.PI) : 1;
  // slight anticipation pull-back before the shoot
  const antic = interpolate(frame, [T.collapse + 5, T.shoot], [1, 0.94], clamp);
  const floodPop = sp(frame, T.flood, { damping: 10, stiffness: 400, mass: 0.4 });
  const markScale = squash * (frame < T.shoot ? antic : frame < T.flood ? 0.94 : 1.12 - 0.12 * floodPop);

  const sh = shake(frame);

  // ---- type ----
  const w1 = sp(frame, T.word1, { damping: 9, stiffness: 220, mass: 0.6 });
  const w2 = sp(frame, T.word2, { damping: 9, stiffness: 220, mass: 0.6 });
  const tag = sp(frame, T.tag, { damping: 10, stiffness: 300, mass: 0.5 });
  // extrude direction matches the block: sides toward +x (yaw) and +y (pitch)
  const dirRaw: [number, number] = [0.55 + 0.45 * camAmt, 0.55 + 0.25 * camAmt];
  const dl = Math.hypot(dirRaw[0], dirRaw[1]);
  const dir: [number, number] = [dirRaw[0] / dl, dirRaw[1] / dl];
  const typeLen = 26 * depthMul;
  const typeVisible = frame < T.flood;

  // ---- exit wipe ----
  const wipeT = interpolate(frame, [T.wipeStart, T.wipeEnd], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.55, 0, 0.35, 1),
  });
  const BAND = 260;
  const L = -BAND - 40 + wipeT * (W + H + BAND + 120);
  const wiping = frame >= T.wipeStart;
  const clear = frame >= T.wipeEnd;

  const sceneClip = wiping ? toClip(clipHalf(RECT, L, true)) : undefined;
  const bandClip = toClip(clipHalf(clipHalf(RECT, L, true), L + BAND, false));

  const tagFlash = frame >= T.tag && frame < T.tag + 2;

  return (
    <AbsoluteFill>
      {/* hard cut in — whole scene is one isolated group so the grain multiplies only onto it */}
      {!clear && (
      <AbsoluteFill style={{ isolation: "isolate", clipPath: sceneClip }}>
        <AbsoluteFill style={{ backgroundColor: frame >= T.flood ? C.yellow : C.paper }} />


        {/* registration grid: faint print "+" marks, parallax with the camera so the space reads */}
        {frame < T.flood && (
          <AbsoluteFill style={{ transform: `translate(${ry * 2.2 + sh.x * 0.4}px, ${-rx * 2.2 + sh.y * 0.4}px)` }}>
            <svg width={W + 400} height={H + 400} style={{ position: "absolute", left: -200, top: -200 }}>
              <defs>
                <pattern id="reg" width={120} height={120} patternUnits="userSpaceOnUse">
                  <path d="M60 50 V70 M50 60 H70" stroke={C.ink} strokeWidth={3} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#reg)" opacity={0.11} />
            </svg>
          </AbsoluteFill>
        )}
        {(
          <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}deg)` }}>
            {/* ---- type, under the block ---- */}
            {typeVisible && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: W,
                  top: 1088,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  transform: `translateX(${-28}px)`,
                }}
              >
                <div
                  style={{
                    opacity: w1 > 0.01 ? 1 : 0,
                    transform: `translateY(${(1 - w1) * -70}px) scale(${1.35 - 0.35 * w1})`,
                  }}
                >
                  <ExtrudedWord text="WATERHOUSE" size={92} len={typeLen * w1} dir={dir} color={C.twitch} face={C.ink} />
                </div>
                <div
                  style={{
                    marginTop: 18,
                    opacity: w2 > 0.01 ? 1 : 0,
                    transform: `translateY(${(1 - w2) * -70}px) scale(${1.35 - 0.35 * w2})`,
                  }}
                >
                  <ExtrudedWord text="SESSIONS" size={115} len={typeLen * 1.2 * w2} dir={dir} color={C.twitch} face={C.ink} />
                </div>
                <div
                  style={{
                    marginTop: 46,
                    opacity: tag > 0.01 ? 1 : 0,
                    transform: `scale(${1.7 - 0.7 * tag}) rotate(${-7 + 5 * tag}deg)`,
                    background: tagFlash ? C.yellow : C.ink,
                    color: tagFlash ? C.ink : C.yellow,
                    fontFamily: FONT_MONO,
                    fontWeight: 800,
                    fontSize: 34,
                    letterSpacing: "0.24em",
                    padding: "14px 22px 14px 30px",
                    boxShadow: `${8 * tag * depthMul}px ${8 * tag * depthMul}px 0 0 ${C.twitch}`,
                  }}
                >
                  WITH DENZO · TUESDAY
                </div>
              </div>
            )}

            {/* ---- the block ---- */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                perspective: PERSPECTIVE,
                perspectiveOrigin: `${CX}px ${cy}px`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: CX - MW / 2,
                  top: cy - MH / 2,
                  width: MW,
                  height: MH,
                  // flatten once the depth is gone: avoids Chrome splitting near-coplanar planes during the burst
                  transformStyle: frame >= T.collapse + 7 ? "flat" : "preserve-3d",
                  transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${markScale})`,
                }}
              >
                <Block
                  depth={{ house: pieceDepth("house"), slatA: pieceDepth("slatA"), slatB: pieceDepth("slatB"), door: pieceDepth("door") }}
                  burst={burst}
                  offX={off}
                  offY={off}
                />
              </div>
            </div>
          </AbsoluteFill>
        )}

        {/* hazard band leading the wipe */}
        {wiping && (
          <AbsoluteFill
            style={{
              clipPath: bandClip,
              background: `repeating-linear-gradient(45deg, ${C.ink} 0 38px, ${C.yellow} 38px 76px)`,
            }}
          />
        )}
        {wiping && (
          // black rule on the trailing edge of the band
          <AbsoluteFill
            style={{
              clipPath: toClip(clipHalf(clipHalf(RECT, L, true), L + 18, false)),
              background: C.ink,
            }}
          />
        )}

        <Grain opacity={0.09} />
      </AbsoluteFill>
      )}

      {/* ---- sound ---- */}
      <Sequence from={T.shadowPop} layout="none">
        <Audio src={staticFile("audio/pullup/click.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={T.swing - 3} layout="none">
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.35} />
      </Sequence>
      {LOGO_ORDER.map((p, i) => (
        <Sequence key={p} from={T.pieces[p]} layout="none">
          <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.9} playbackRate={[1, 1.12, 1.25, 0.82][i]} />
        </Sequence>
      ))}
      <Sequence from={T.pieces.door} layout="none">
        <Audio src={staticFile("audio/bumper/clunk.wav")} volume={0.5} />
      </Sequence>
      <Sequence from={T.word1} layout="none">
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={T.word2} layout="none">
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.8} playbackRate={0.9} />
      </Sequence>
      <Sequence from={T.tag} layout="none">
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.55} />
      </Sequence>
      <Sequence from={T.snapBack} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.4} />
      </Sequence>
      <Sequence from={T.collapse + 2} layout="none">
        <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.8} />
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.7} playbackRate={1.4} />
      </Sequence>
      <Sequence from={T.shoot + 4 - 20} layout="none">
        <Audio src={staticFile("audio/bumper/cymbal-reverse.wav")} volume={0.55} />
      </Sequence>
      <Sequence from={T.flood} layout="none">
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={1} />
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={T.wipeStart} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.6} playbackRate={0.8} />
      </Sequence>
    </AbsoluteFill>
  );
};
