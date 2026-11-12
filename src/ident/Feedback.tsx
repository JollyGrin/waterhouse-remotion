import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H as PH, LOGO_ORDER, LOGO_PATHS, LogoPiece, W as PW, rand } from "./brand";

/**
 * FEEDBACK — the VJ booth at 4am: a camera pointed at its own monitor.
 * The mark rolls in on a V-hold slip and locks as an outline. Kicks on a 120 bpm grid push the
 * feedback loop: the copies build into a tunnel, twist into a spiral, and spin down into the
 * centre. The tape stutters, rewinds, and on the next kick the loop flips: solid luma trails blow
 * outward from a filled mark. Then everything converges into one sharp mark, the title feeds in
 * and sharpens, one yellow rule. Finally the door of the mark becomes the monitor, the monitor
 * shows the frame, the frame shows the monitor — and the camera dives through two generations of
 * the loop into the last door, which is the window to the content.
 *
 * Monochrome luma on black; VHS tracking, luma smear, bloom, scanlines, head-switch noise.
 * Grid: 120 bpm, beat = 15 f.
 */
export const FEEDBACK_FRAMES = 138;

// ---- timeline (frames) ----
const KICKS = [8, 23, 38, 53, 68, 83, 98, 113];
const K1 = 8; // tunnel builds
const K2 = 23; // twist into a spiral
const K3 = 38; // collapse inward
const STUT = 45; // stutter fill 45–52 (freeze loop, then rewind)
const K4 = 53; // flip: explode outward, filled
const K5 = 68; // resolve: one sharp mark, title feeds in
const K6 = 83; // echo
const LIVE = 98; // the door becomes the monitor
const DIVE0 = 103; // camera starts the dive
const CLEAR = 128; // fully transparent from here

// ---- layout: one object per orientation (portrait 1080×1920, wide 1920×1080) ----
const RHO = 5; // each generation turns a little
const DEPTH = 2; // generations drawn below the front one; the door of the deepest is the hole
const LINE = "WITH DENZO · TUESDAY";
type Pt = [number, number];

const mkLayout = (wide: boolean) => {
  const W = wide ? 1920 : PW;
  const H = wide ? 1080 : PH;
  // portrait: the mark centred, title stacked under it. wide: a lockup, mark left, title column right.
  const MW = wide ? 620 : 640;
  const K = MW / 1000;
  const X0 = wide ? 270 : (W - MW) / 2;
  const Y0 = wide ? 313 : 540;
  const PC: Pt = [X0 + 500 * K, Y0 + 333 * K]; // centre of the mark
  const LOGO_T = `translate(${X0} ${Y0}) scale(${K})`;
  const TX = wide ? 1330 : W / 2; // title column centre
  const TW = wide ? 640 : 720;
  const T1_Y = wide ? 498 : 1110;
  const T2_Y = wide ? 588 : 1200;
  const RULE_Y = wide ? 638 : 1250;
  const LINE_Y = wide ? 702 : 1314;
  // before the lockup the wide mark sits at frame centre; it slides left on K5 to make room for the title
  const SLIDE = wide ? W / 2 - PC[0] : 0;

  // ---- the loop: nesting the whole frame into the door ----
  const DOOR_C: Pt = [X0 + 685.8 * K, Y0 + 531.9 * K]; // door bbox centre
  const AIM: Pt = [X0 + 685.8 * K, Y0 + 552.3 * K]; // centre of the door's inscribed rectangle
  // portrait: the nested frame covers the door. wide: the door holds a true 16:9 monitor (bezel + screen),
  // fitted inside the door's inscribed rectangle, so the frame-in-frame reads as a screen.
  const PAD = wide ? 70 : 0; // bezel, in nested-frame units
  const NR = wide
    ? (0.94 * 178.6 * K) / ((W + 2 * PAD) * Math.cos((RHO * Math.PI) / 180) + (H + 2 * PAD) * Math.sin((RHO * Math.PI) / 180))
    : 1.3 * Math.max((178.6 * K) / W, (268 * K) / H);
  const NC: Pt = wide ? AIM : DOOR_C;
  const NEST = `translate(${NC[0]} ${NC[1]}) rotate(${RHO}) scale(${NR}) translate(${-W / 2} ${-H / 2})`;
  const nestPt = (p: Pt): Pt => {
    const a = (RHO * Math.PI) / 180;
    const x = (p[0] - W / 2) * NR;
    const y = (p[1] - H / 2) * NR;
    return [NC[0] + x * Math.cos(a) - y * Math.sin(a), NC[1] + x * Math.sin(a) + y * Math.cos(a)];
  };
  const HOLE_C = nestPt(nestPt(AIM)); // where the hole sits on screen before the dive
  const Z_FINAL = wide ? 14000 : 1400;

  // display furniture
  const OSD_L = wide ? 96 : 92;
  const OSD_R = wide ? 1824 : 930;
  const OSD_Y = wide ? 108 : 170;
  const CAM_Y = wide ? 144 : 210;
  const LABEL_Y = wide ? 1000 : 1440;
  const HS_Y = H - 52; // head-switch noise at the bottom of the raster
  const HS_K = wide ? W / PW : 1;
  return {
    wide, W, H, MW, K, X0, Y0, PC, LOGO_T, TX, TW, T1_Y, T2_Y, RULE_Y, LINE_Y, SLIDE,
    PAD, NR, NEST, HOLE_C, Z_FINAL, OSD_L, OSD_R, OSD_Y, CAM_Y, LABEL_Y, HS_Y, HS_K,
  };
};
type Ly = ReturnType<typeof mkLayout>;
const LY_PORTRAIT = mkLayout(false);
const LY_WIDE = mkLayout(true);
const LyCtx = React.createContext<Ly>(LY_PORTRAIT);
const useLy = () => React.useContext(LyCtx);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const seg = (t: number, r: [number, number], v: [number, number], easing: (x: number) => number = (x) => x) =>
  interpolate(t, r, v, { ...clamp, easing });
const oCub = Easing.out(Easing.cubic);
const iCub = Easing.in(Easing.cubic);
const ioCub = Easing.inOut(Easing.cubic);
const oQuad = Easing.out(Easing.quad);
const iQuad = Easing.in(Easing.quad);

// ---- signal time: freeze loop + rewind on the fill ----
const sigT = (f: number) => {
  if (f >= STUT && f <= STUT + 5) return STUT - 1 + ((f - STUT) % 3);
  if (f === STUT + 6) return 40;
  if (f === STUT + 7) return 36;
  return f;
};

// ---- the feedback parameters ----
type Loop = {
  mode: "outline" | "fill";
  n: number; // copies (fractional)
  s: number; // scale per generation
  th: number; // rotation per generation (deg)
  d: [number, number]; // offset per generation (px)
  z: number; // global zoom
  r: number; // global rotation (deg)
  amp: number; // luma of the first copy
  decay: number; // luma decay per generation
  blur: number; // extra screen blur per generation (px)
};
const loopAt = (T: number): Loop => {
  if (T < K4) {
    const z = (1 + seg(T, [K1, K3], [0, 0.05], ioCub)) * seg(T, [K3, K3 + 10], [1, 0.3], iCub);
    return {
      mode: "outline",
      n: seg(T, [K1, K1 + 6], [0, 14], oQuad),
      s: 0.87 + seg(T, [K2, K2 + 7], [0, 0.015], oCub) + seg(T, [K3, K3 + 10], [0, -0.07], iQuad),
      th: 3.5 + seg(T, [K2, K2 + 7], [0, 7.5], oCub) + seg(T, [K3, K3 + 10], [0, 13], iQuad),
      d: [Math.sin(T / 7) * 4, -6 + Math.cos(T / 9) * 2],
      z,
      r: seg(T, [0, K2], [-3, 2]) + seg(T, [K2, K2 + 7], [0, -12], oCub) + seg(T, [K3, K3 + 10], [0, -75], iCub),
      amp: 0.9,
      decay: 0.85,
      blur: 0.28,
    };
  }
  // flip: explode outward, filled; then converge into one mark on K5
  const p = seg(T, [K5, K5 + 6], [0, 1], oCub);
  const s0 = seg(T, [K4, K4 + 14], [1.2, 1.06], oQuad);
  return {
    mode: "fill",
    n: 12,
    s: s0 + (1 - s0) * p,
    th: seg(T, [K4, K4 + 14], [-7, -2], oQuad) * (1 - p),
    d: [0, seg(T, [K4, K4 + 14], [-14, -4], oQuad) * (1 - p)],
    z: seg(T, [K4, K4 + 10], [0.3, 1], oCub),
    r: seg(T, [K4, K4 + 10], [28, 0], oCub),
    amp: seg(T, [K4, K4 + 14], [0.55, 0.18], oQuad) * (1 - p),
    decay: 0.8,
    blur: 1.0,
  };
};

// ---- camera: slow drift + weighty kick thumps ----
const camera = (f: number) => {
  let x = Math.sin(f / 23) * 5;
  let y = Math.cos(f / 29) * 4;
  for (const k of KICKS) {
    const t = f - k;
    if (t < 0 || t > 8) continue;
    const a = (k === K4 || k === K5 ? 7 : 3.5) * Math.exp(-t / 2.2);
    x += (rand(k * 7 + t) - 0.5) * 2 * a;
    y += a * (t === 0 ? 1 : (rand(k * 11 + t) - 0.5) * 2);
  }
  return `translate(${x} ${y})`;
};

// the dive: zoom (log-space) into the deepest door, panning it to centre and un-twisting the generations
const dive = (f: number, { W, H, HOLE_C, Z_FINAL }: Ly) => {
  const t = seg(f, [DIVE0, CLEAR], [0, 1]);
  const e = Math.pow(t, 1.6); // log-zoom accelerating steadily: a heavy, even push, no lurch at the end
  const z = Math.exp(Math.log(Z_FINAL) * e);
  const pc = ioCub(seg(f, [DIVE0, CLEAR - 4], [0, 1]));
  const cx = HOLE_C[0] + (W / 2 - HOLE_C[0]) * pc;
  const cy = HOLE_C[1] + (H / 2 - HOLE_C[1]) * pc;
  const phi = -RHO * DEPTH * pc;
  return { z, tr: `translate(${cx} ${cy}) rotate(${phi}) scale(${z}) translate(${-HOLE_C[0]} ${-HOLE_C[1]})` };
};

const grey = (l: number) => {
  const v = Math.round(250 * Math.max(0, Math.min(1, l)));
  return `rgb(${v},${v},${v})`;
};

const MarkPaths: React.FC<{ pieces?: LogoPiece[] } & React.SVGProps<SVGGElement>> = ({ pieces = LOGO_ORDER, ...rest }) => {
  const { LOGO_T } = useLy();
  return (
    <g transform={LOGO_T} {...rest}>
      {pieces.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} />
      ))}
    </g>
  );
};

// title that feeds in: ghosts trail out and converge onto the sharp line
const FeedText: React.FC<{ f: number; at: number; y: number; children: React.ReactNode; outline?: boolean }> = ({
  f,
  at,
  y,
  children,
  outline,
}) => {
  const { TX, TW } = useLy();
  if (f < at) return null;
  const p = seg(f, [at, at + 10], [0, 1], oCub);
  const style = { fontFamily: FONT_DISPLAY };
  const common = { x: TX, y, fontSize: 76, textAnchor: "middle" as const, textLength: TW, lengthAdjust: "spacing" as const, style };
  const paint = (o: number) =>
    outline ? { fill: "none", stroke: C.paper, strokeWidth: 2.4, strokeOpacity: o } : { fill: C.paper, fillOpacity: o };
  return (
    <g>
      {p < 1
        ? [5, 4, 3, 2, 1].map((k) => {
            const sc = 1 + 0.07 * k * (1 - p);
            return (
              <text
                key={k}
                {...common}
                {...paint(0.55 * Math.pow(0.66, k) * (1 - p))}
                transform={`translate(${TX} ${y + k * 18 * (1 - p)}) scale(${sc}) translate(${-TX} ${-y})`}
              >
                {children}
              </text>
            );
          })
        : null}
      <text {...common} {...paint(1)}>
        {children}
      </text>
    </g>
  );
};

const LowerThird: React.FC<{ f: number }> = ({ f }) => {
  const { TX, RULE_Y, LINE_Y } = useLy();
  const rw = seg(f, [K5 + 10, K5 + 15], [0, 128], oCub);
  const ADV = 27; // 30px JetBrains Mono (0.6em) + 9 letter-spacing
  const total = LINE.length * ADV - 9;
  const x0 = TX - total / 2;
  const nChars = Math.max(0, Math.min(LINE.length, Math.floor((f - (K5 + 12)) * 1.7)));
  const cursorOn = f >= K5 + 12 && f < LIVE - 2 && (nChars < LINE.length || Math.floor(f / 5) % 2 === 0);
  return (
    <g>
      {rw > 0 ? <rect x={TX - rw / 2} y={RULE_Y} width={rw} height={5} fill={C.yellow} /> : null}
      <text x={x0} y={LINE_Y} fontSize={30} letterSpacing={9} fill="#9a9893" style={{ fontFamily: FONT_MONO }} fontWeight={500}>
        {LINE.slice(0, nChars)}
      </text>
      {cursorOn ? <rect x={x0 + nChars * ADV} y={LINE_Y - 25} width={17} height={30} fill="#9a9893" /> : null}
    </g>
  );
};

// one generation of the finished frame; the door shows the next generation
const Generation: React.FC<{ depth: number; zoom: number; f: number }> = ({ depth, zoom, f }) => {
  const { W, H, K, X0, Y0, NR, NEST, PAD, T1_Y, T2_Y, wide } = useLy();
  const screen = zoom * Math.pow(NR, depth);
  const dim = interpolate(Math.log(screen), [Math.log(NR * NR), Math.log(NR), 0], [0.32, 0.6, 1], clamp);
  return (
    <g>
      {/* the front generation sits on the screen-space glow; deeper ones carry their own */}
      {depth > 0 ? <rect x={0} y={0} width={W} height={H} fill="url(#glow)" /> : null}
      <g opacity={dim}>
        <MarkPaths pieces={["house", "slatA", "slatB"]} fill={C.paper} />
        <FeedText f={999} at={0} y={T1_Y}>
          WATERHOUSE
        </FeedText>
        <FeedText f={999} at={0} y={T2_Y} outline>
          SESSIONS
        </FeedText>
        <LowerThird f={LIVE + 40} />
      </g>
      <g clipPath="url(#door)">
        {wide ? <rect x={X0 + 590 * K} y={Y0 + 390 * K} width={192 * K} height={282 * K} fill="#000" /> : null}
        {depth < DEPTH ? (
          <g transform={NEST}>
            {wide ? (
              // the monitor: a dark bezel with a faint edge catching the room light, the screen glowing inside it
              <>
                <rect x={-PAD} y={-PAD} width={W + 2 * PAD} height={H + 2 * PAD} rx={PAD * 0.5} fill="#0b0b0a" stroke="#4d4c48" strokeWidth={10} />
                <rect x={-6} y={-6} width={W + 12} height={H + 12} fill="none" stroke="#1d1d1b" strokeWidth={12} />
              </>
            ) : null}
            <Generation depth={depth + 1} zoom={zoom} f={f} />
          </g>
        ) : null}
        {depth === 0 && f < LIVE + 5 ? (
          <rect x={X0 + 560 * K} y={Y0 + 380 * K} width={260 * K} height={300 * K} filter="url(#static)" opacity={seg(f, [LIVE, LIVE + 5], [0.85, 0])} />
        ) : null}
      </g>
      <MarkPaths pieces={["door"]} fill="none" stroke={C.paper} strokeWidth={1.6 / K} strokeOpacity={0.6 * dim} />
    </g>
  );
};

// wide only: the mark rides at frame centre until the lockup, then settles left (portrait: no wrapper at all)
const wrapSlide = (wide: boolean, dx: number, el: React.ReactElement) => (wide ? <g transform={`translate(${dx} 0)`}>{el}</g> : el);

// the loop before the door goes live
const Loop: React.FC<{ f: number; T: number }> = ({ f, T }) => {
  const { PC, K, T1_Y, T2_Y, SLIDE, wide } = useLy();
  const L = loopAt(T);
  const G = `translate(${PC[0]} ${PC[1]}) rotate(${L.r}) scale(${L.z}) translate(${-PC[0]} ${-PC[1]})`;
  const copies = [];
  const filters = [];
  const nMax = Math.ceil(L.n);
  for (let k = nMax; k >= 1; k--) {
    const vis = Math.max(0, Math.min(1, L.n - k + 1));
    const l = L.amp * Math.pow(L.decay, k) * vis;
    if (l < 0.006) continue;
    const sk = Math.pow(L.s, k);
    const scr = L.z * sk;
    const std = (0.4 + k * L.blur) / scr;
    filters.push(
      <filter key={k} id={`fb${k}`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation={std} />
      </filter>,
    );
    const tr = `translate(${PC[0] + k * L.d[0]} ${PC[1] + k * L.d[1]}) rotate(${k * L.th}) scale(${sk}) translate(${-PC[0]} ${-PC[1]})`;
    copies.push(
      <g key={k} transform={tr} filter={`url(#fb${k})`}>
        {L.mode === "outline" ? (
          <MarkPaths fill="none" stroke={C.paper} strokeOpacity={l} strokeWidth={5 / K} strokeLinejoin="miter" />
        ) : (
          <MarkPaths fill={grey(l)} />
        )}
      </g>,
    );
  }
  // echo on K6: a faint outward ripple of outlines
  const echo = [];
  if (T >= K6 && T < K6 + 14) {
    const e = seg(T, [K6, K6 + 13], [0, 1], oCub);
    for (let k = 4; k >= 1; k--) {
      const sc = 1 + 0.045 * k * e;
      echo.push(
        <g key={k} transform={`translate(${PC[0]} ${PC[1] - k * 10 * e}) scale(${sc}) translate(${-PC[0]} ${-PC[1]})`}>
          <MarkPaths fill="none" stroke={C.paper} strokeOpacity={0.4 * Math.pow(0.68, k) * (1 - e)} strokeWidth={3 / K} />
        </g>,
      );
    }
  }
  const signal = seg(f, [0, 4], [0, 1]);
  return (
    <g opacity={signal}>
      <defs>{filters}</defs>
      {wrapSlide(
        wide,
        SLIDE * (1 - seg(T, [K5 - 8, K5 + 5], [0, 1], ioCub)),
        <g transform={G}>
          {copies}
          {echo}
          {L.mode === "outline" ? (
            <MarkPaths fill="none" stroke={C.paper} strokeWidth={5 / K} strokeLinejoin="miter" />
          ) : (
            <MarkPaths fill={C.paper} />
          )}
        </g>,
      )}
      <FeedText f={T} at={K5} y={T1_Y}>
        WATERHOUSE
      </FeedText>
      <FeedText f={T} at={K5 + 3} y={T2_Y} outline>
        SESSIONS
      </FeedText>
      {T >= K5 ? <LowerThird f={T} /> : null}
    </g>
  );
};

const tc = (t: number) => {
  const s = Math.floor(t / 30);
  const fr = t % 30;
  return `00:00:${String(s).padStart(2, "0")}:${String(fr).padStart(2, "0")}`;
};

const FeedbackCore: React.FC = () => {
  const ly = useLy();
  const { W, H, NEST, LOGO_T, OSD_L, OSD_R, OSD_Y, CAM_Y, LABEL_Y, HS_Y, HS_K } = ly;
  const f = useCurrentFrame();
  const T = sigT(f);
  const live = f >= LIVE;
  const dv = dive(f, ly);
  const cam = camera(f);

  // V-hold roll on the way in
  const roll = (interpolate(f, [0, K1], [1.7, 0], { ...clamp, easing: oCub }) % 1) * H;
  const rolling = roll > 0.5;

  // VHS amounts
  const stutter = f >= STUT && f < K4;
  const track = 7 + (stutter ? 60 : 0) + (rolling ? 20 : 0) + (f >= LIVE && f < LIVE + 3 ? 30 : 0);
  const seed = f % 23;

  const content = live ? (
    <g transform={dv.tr}>
      <Generation depth={0} zoom={dv.z} f={f} />
    </g>
  ) : (
    <Loop f={f} T={T} />
  );

  // OSD
  const osdState = f >= STUT && f < STUT + 6 ? "❚❚ PAUSE" : f >= STUT + 6 && f < K4 ? "◀◀ REW" : "▶ PLAY";
  const osdOn = f >= 2;

  // head-switch noise at the bottom of the raster
  const hs = Array.from({ length: 7 }, (_, i) => ({
    y: HS_Y + i * 6 + rand(f * 3 + i) * 3,
    x: (rand(f * 5.3 + i * 9) - 0.5) * 180 * HS_K,
    w: (300 + rand(f * 1.1 + i) * 700) * HS_K,
    h: 1.5 + rand(f * 7.7 + i) * 3,
    o: 0.08 + rand(f * 2.3 + i * 4) * 0.22,
  }));

  return (
    <AbsoluteFill>
      {f < CLEAR ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
          <defs>
            <clipPath id="door" clipPathUnits="userSpaceOnUse">
              <path d={LOGO_PATHS.door} transform={LOGO_T} />
            </clipPath>
            <mask id="alpha" maskUnits="userSpaceOnUse" x={-W} y={-H} width={W * 3} height={H * 3}>
              <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="#fff" />
              {f >= DIVE0 ? (
                <g transform={cam}>
                  <g transform={dv.tr}>
                    <g transform={NEST}>
                      <g transform={NEST}>
                        <path d={LOGO_PATHS.door} transform={LOGO_T} fill="#000" />
                      </g>
                    </g>
                  </g>
                </g>
              ) : null}
            </mask>
            <filter id="vhs" filterUnits="userSpaceOnUse" x={-80} y={-20} width={W + 160} height={H + 40} colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.011" numOctaves={2} seed={seed} result="n" />
              <feColorMatrix in="n" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="nx" />
              <feDisplacementMap in="SourceGraphic" in2="nx" scale={track} xChannelSelector="R" yChannelSelector="G" result="d" />
              <feGaussianBlur in="d" stdDeviation="10 0" result="sm" />
              <feOffset in="sm" dx={7} result="smo" />
              <feColorMatrix in="smo" type="matrix" values="0.5 0 0 0 0  0 0.5 0 0 0  0 0 0.5 0 0  0 0 0 1 0" result="smd" />
              <feGaussianBlur in="d" stdDeviation={18} result="bl" />
              <feColorMatrix in="bl" type="matrix" values="0.55 0 0 0 0  0 0.55 0 0 0  0 0 0.55 0 0  0 0 0 1 0" result="bld" />
              <feBlend in="d" in2="smd" mode="screen" result="a" />
              <feBlend in="a" in2="bld" mode="screen" />
            </filter>
            <filter id="static" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={f} />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <filter id={`grain${seed}`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves={2} seed={seed * 7 + 1} stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <pattern id="scan" width={4} height={4} patternUnits="userSpaceOnUse">
              <rect y={0} width={4} height={1.6} fill="#000" />
            </pattern>
            <radialGradient id="vig" cx="50%" cy="45%" r="78%">
              <stop offset="50%" stopColor="#000" stopOpacity={0} />
              <stop offset="100%" stopColor="#000" stopOpacity={0.8} />
            </radialGradient>
            <radialGradient id="glow" cx="50%" cy="42%" r="60%">
              <stop offset="0%" stopColor="#1a1a19" />
              <stop offset="100%" stopColor="#040404" />
            </radialGradient>
          </defs>

          <g mask="url(#alpha)">
            <g filter="url(#vhs)">
              <rect x={-120} y={-40} width={W + 240} height={H + 80} fill="url(#glow)" />
              <g transform={cam}>
                {rolling ? (
                  <>
                    <g transform={`translate(0 ${roll})`}>{content}</g>
                    <g transform={`translate(0 ${roll - H})`}>{content}</g>
                    <rect x={-20} y={roll - 46} width={W + 40} height={92} fill="#000" />
                    <rect x={-20} y={roll - 16} width={W + 40} height={3} fill="#3a3a38" />
                  </>
                ) : (
                  content
                )}
              </g>
            </g>

            {/* the display: scanlines, grain, head-switch, vignette */}
            <rect x={0} y={0} width={W} height={H} fill="url(#scan)" opacity={0.42} />
            <rect x={0} y={0} width={W} height={H} filter={`url(#grain${seed})`} opacity={0.075} style={{ mixBlendMode: "screen" }} />
            {stutter ? (
              <rect x={0} y={((f - STUT) * 233) % H} width={W} height={70} filter="url(#static)" opacity={0.22} style={{ mixBlendMode: "screen" }} />
            ) : null}
            {hs.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="#c9c7c1" opacity={b.o} />
            ))}
            <rect x={0} y={0} width={W} height={H} fill="url(#vig)" />

            {/* OSD: the deck's character generator, clean on top */}
            {osdOn ? (
              <g style={{ fontFamily: FONT_MONO }} fontWeight={700} fill="#d6d4ce" opacity={0.78}>
                <text x={OSD_L} y={OSD_Y} fontSize={28} letterSpacing={4}>
                  {osdState}
                </text>
                <text x={OSD_R} y={OSD_Y} fontSize={28} letterSpacing={3} textAnchor="end">
                  {tc(T)}
                </text>
                {live ? (
                  <text x={OSD_R} y={CAM_Y} fontSize={22} letterSpacing={4} textAnchor="end" fill="#8d8b86">
                    CAM 1 ▸ MON 1
                  </text>
                ) : null}
                {f >= K5 + 6 ? (
                  <text x={OSD_L} y={LABEL_Y} fontSize={22} letterSpacing={5} fill="#6d6b67" fontWeight={500}>
                    WATERHOUSE STUDIOS · AMS
                  </text>
                ) : null}
              </g>
            ) : null}
          </g>
        </svg>
      ) : null}

      {/* ---- sound ---- */}
      <Sequence layout="none">
        <Audio src={staticFile("ident/audio/feedback/deck.wav")} volume={0.6} />
        <Audio src={staticFile("ident/audio/feedback/roll.wav")} volume={0.45} />
      </Sequence>
      <Sequence durationInFrames={CLEAR} layout="none">
        <Audio
          src={staticFile("ident/audio/feedback/hiss.wav")}
          volume={(fr) => interpolate(fr, [0, 4, CLEAR - 6, CLEAR], [0, 0.32, 0.32, 0], clamp)}
        />
      </Sequence>
      <Sequence from={2} durationInFrames={CLEAR - 2} layout="none">
        <Audio
          src={staticFile("ident/audio/feedback/howl.wav")}
          volume={(fr) => interpolate(fr + 2, [2, 12, STUT, STUT + 1, K4, DIVE0, CLEAR - 3, CLEAR], [0, 0.6, 0.65, 0.0, 0.7, 0.6, 0.5, 0], clamp)}
        />
      </Sequence>
      {[K1, K2, K3, K6, LIVE, 113].map((k) => (
        <Sequence key={k} from={k} layout="none">
          <Audio src={staticFile("ident/audio/feedback/kick.wav")} volume={() => k === 113 ? 0.6 : 0.8} />
        </Sequence>
      ))}
      <Sequence from={STUT} layout="none">
        <Audio src={staticFile("ident/audio/feedback/stutter.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={STUT + 6} layout="none">
        <Audio src={staticFile("ident/audio/feedback/rewind.wav")} volume={0.45} />
      </Sequence>
      <Sequence from={K4} layout="none">
        <Audio src={staticFile("ident/audio/feedback/kick-big.wav")} volume={0.9} />
      </Sequence>
      <Sequence from={K5} layout="none">
        <Audio src={staticFile("ident/audio/feedback/kick.wav")} volume={0.85} />
        <Audio src={staticFile("ident/audio/feedback/lock.wav")} volume={0.55} />
      </Sequence>
      <Sequence from={LIVE} layout="none">
        <Audio src={staticFile("ident/audio/feedback/pop.wav")} volume={0.5} />
      </Sequence>
      <Sequence from={CLEAR - 25} layout="none">
        <Audio src={staticFile("ident/audio/feedback/dive.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={CLEAR - 1} layout="none">
        <Audio src={staticFile("ident/audio/feedback/sub.wav")} volume={0.85} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const Feedback: React.FC = () => (
  <LyCtx.Provider value={LY_PORTRAIT}>
    <FeedbackCore />
  </LyCtx.Provider>
);

/** Landscape cut (1920×1080, "Feedback-16x9"): same timeline and audio, re-laid out as a lockup. */
export const FeedbackWide: React.FC = () => (
  <LyCtx.Provider value={LY_WIDE}>
    <FeedbackCore />
  </LyCtx.Provider>
);
