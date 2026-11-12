import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, LogoPiece, W, rand } from "./brand";

/**
 * MONOLITH — Extrude, remade adult/serious.
 * The mark as dark concrete slabs, revealed by one hard raking light. Real per-face
 * flat shading (each side quad lit from its world normal), slow inertial orbit to a low
 * monumental angle, slabs sliding out to depth on low booms. Exit: the light cuts out,
 * the camera pushes into the house face until it fills the frame, then a hard
 * horizontal slit of light opens to the content.
 */
export const MONOLITH_FRAMES = 140;

// ---- timeline (frames) ----
const T = {
  lightIn: 0,
  lightFull: 24,
  orbitStart: 4,
  orbitEnd: 76,
  slide: { house: 8, slatA: 20, slatB: 32, door: 44 } as Record<LogoPiece, number>,
  slideDur: 22,
  labels: 54,
  word1: 62,
  word2: 68,
  rule: 76,
  host: 78,
  cut: 110, // light cuts out
  pushStart: 112,
  pushEnd: 122,
  slit: 123, // thin line of light
  openStart: 124,
  openEnd: 131, // fully clear from here
};

// ---- palette (tone rules: near-black, concrete greys, paper type, one yellow detail) ----
const K = {
  wall: "#121212",
  wedgeCore: "#4a4844",
  wedgePen: "#302f2c",
  castShadow: "#1b1a18",
  grey: "#8a8a86",
  paper: C.paper,
  accent: C.yellow,
};

// ---- layout ----
const MW = 820;
const S = MW / LOGO_VIEWBOX.w;
const MH = LOGO_VIEWBOX.h * S;
const CX = 540;
const CY = 700;
const MAX_DEPTH = 330;
const PERSPECTIVE = 1900;

type Pt = [number, number];
type V3 = [number, number, number];

// Straight-edged outlines of the four pieces (viewBox units; the house's 2-unit corner radii dropped).
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

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
const slideEase = Easing.bezier(0.55, 0, 0.18, 1); // slow start, firm stone-like stop, no overshoot
const deg = Math.PI / 180;

/** CSS "rotateX(rx) rotateY(ry) rotateZ(rz)" applied to a vector (y down, z toward viewer). */
const rot = (v: V3, rx: number, ry: number, rz: number): V3 => {
  let [x, y, z] = v;
  const cz = Math.cos(rz * deg);
  const sz = Math.sin(rz * deg);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cy = Math.cos(ry * deg);
  const sy = Math.sin(ry * deg);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cx = Math.cos(rx * deg);
  const sx = Math.sin(rx * deg);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
};
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const grey = (v: number) => {
  const c = Math.round(Math.max(0, Math.min(255, v)));
  return `rgb(${c},${c},${c - 2 < 0 ? 0 : c - 2})`;
};

const centroid = (p: Pt[]): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

// Side quads per piece, oriented so the div's front side faces outward (backface culling works).
type Side = { x: number; y: number; len: number; ang: number; n: Pt; key: string };
const SIDES: Record<LogoPiece, Side[]> = (() => {
  const out = {} as Record<LogoPiece, Side[]>;
  for (const piece of LOGO_ORDER) {
    const poly = POLY[piece].map(([x, y]) => [x * S, y * S] as Pt);
    const c = centroid(poly);
    out[piece] = poly.map((p, i) => {
      let a = p;
      let b = poly[(i + 1) % poly.length];
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // after rotateX(-90deg) rotateZ(ang) the div's normal is (-sin, cos, 0): make that outward
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (nx * (mid[0] - c[0]) + ny * (mid[1] - c[1]) < 0) {
        [a, b] = [b, a];
        ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
      return {
        x: a[0],
        y: a[1],
        len: Math.hypot(b[0] - a[0], b[1] - a[1]),
        ang,
        n: [-Math.sin(ang), Math.cos(ang)] as Pt,
        key: `${piece}-${i}`,
      };
    });
  }
  return out;
})();

// ---- film texture ----
const FilmGrain: React.FC<{ frame: number }> = ({ frame }) => {
  const seed = frame % 24;
  return (
    <>
      <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.16, pointerEvents: "none" }}>
        <svg width="100%" height="100%">
          <filter id={`fg-${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves={2} seed={seed} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="linear" slope="1.9" intercept="-0.55" />
              <feFuncG type="linear" slope="1.9" intercept="-0.55" />
              <feFuncB type="linear" slope="1.9" intercept="-0.55" />
            </feComponentTransfer>
          </filter>
          <rect width="100%" height="100%" filter={`url(#fg-${seed})`} />
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{ mixBlendMode: "multiply", opacity: 0.35, pointerEvents: "none" }}>
        <svg width="100%" height="100%">
          <filter id={`fd-${seed}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves={1} seed={seed + 40} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#fd-${seed})`} />
        </svg>
      </AbsoluteFill>
    </>
  );
};

/** Characters typed on at `cps` chars per frame from `at`. */
const typed = (text: string, frame: number, at: number, cps = 1.5) =>
  text.slice(0, Math.max(0, Math.min(text.length, Math.floor((frame - at) * cps))));

// ---------------------------------------------------------------------------

export const Monolith: React.FC = () => {
  const frame = useCurrentFrame();
  const lit = frame < T.cut;

  // ---- light ----
  const lightAmt = lit ? interpolate(frame, [T.lightIn, 6, T.lightFull], [0.0, 0.35, 1], { ...clamp, easing: easeIO }) : 0;
  // azimuth: grazing from the far left, swinging to a low-left uplight (monument flood)
  const la = interpolate(frame, [0, 60], [0, 1], { ...clamp, easing: easeIO });
  const L = norm3([-0.98 + 0.3 * la, 0.08 + 0.5 * la, 0.16 + 0.34 * la]);

  // ---- camera: slow inertial orbit to a low 3/4, continuous drift, no overshoot ----
  const orbit = interpolate(frame, [T.orbitStart, T.orbitEnd], [0, 1], { ...clamp, easing: easeIO });
  const ry = -30 * orbit - 0.045 * frame;
  const rx = 13 * orbit + 0.012 * frame;
  const rz = 0.6 * orbit;
  const dolly = 0.84 + 0.16 * orbit + 0.0006 * Math.max(0, frame - T.orbitEnd);

  // ---- slabs sliding out to depth ----
  const depthOf = (p: LogoPiece) =>
    MAX_DEPTH * interpolate(frame, [T.slide[p], T.slide[p] + T.slideDur], [0, 1], { ...clamp, easing: slideEase });
  const landings = LOGO_ORDER.map((p) => T.slide[p] + T.slideDur);

  // one low, short shake: only the final (door) landing, and the push's end
  const lastLand = landings[3];
  const shakeT = frame - lastLand;
  const shakeAmp = shakeT >= 0 && shakeT < 10 ? 3.2 * Math.exp(-shakeT / 3) : 0;
  const shY = shakeAmp * Math.sin(shakeT * 1.7);
  const shX = shakeAmp * 0.4 * Math.sin(shakeT * 1.1 + 1);

  // gate weave: 1–2 px, re-picked on twos, eased
  const gw = Math.floor(frame / 2);
  const weaveX = (rand(gw * 3.1) - 0.5) * 2.2;
  const weaveY = (rand(gw * 7.7 + 2) - 0.5) * 1.6;

  // ---- exit push (2D, around a point inside the house face) ----
  const pushT = interpolate(frame, [T.pushStart, T.pushEnd], [0, 1], { ...clamp, easing: Easing.in(Easing.exp) });
  const pushScale = 1 + 11 * pushT;
  // project a point inside the house's front face to screen to push around it
  const pLocal: V3 = [200 * S - MW / 2, 470 * S - MH / 2, 0];
  const pr = rot(pLocal, rx, ry, rz).map((v) => v * dolly) as V3;
  const kp = PERSPECTIVE / (PERSPECTIVE - pr[2]);
  const pushOrigin: Pt = [CX + pr[0] * kp, CY + pr[1] * kp];

  // ---- exit slit ----
  const openT = interpolate(frame, [T.openStart, T.openEnd], [0, 1], { ...clamp, easing: Easing.bezier(0.3, 0, 0.2, 1) });
  const slitHalf = frame < T.slit ? -1 : frame < T.openStart ? 0 : openT * (H / 2 + 40);
  const clear = frame >= T.openEnd;
  const MID = H / 2;
  const mask =
    slitHalf < 0
      ? undefined
      : `linear-gradient(to bottom, #000 0px, #000 ${MID - slitHalf}px, transparent ${MID - slitHalf}px, transparent ${MID + slitHalf}px, #000 ${MID + slitHalf}px, #000 100%)`;

  // ---- light wedge on the wall (screen-space band, hard edges, two steps) ----
  const wedgeX = interpolate(frame, [T.lightIn, T.lightFull + 2], [-1750, 380], { ...clamp, easing: easeIO });
  const wedge = (grow: number) => {
    const x0 = wedgeX - grow;
    const x1 = wedgeX + 1300 + grow;
    const skew = -420; // bottom leans right: light thrown up from low left
    return `polygon(${x0 + skew}px -40px, ${x1 + skew}px -40px, ${x1 - 180}px ${H + 40}px, ${x0 - 180}px ${H + 40}px)`;
  };

  // ---- shading ----
  const AMB = 0.11;
  const sideColor = (n: Pt) => {
    const nw = rot([n[0], n[1], 0], rx, ry, rz);
    const d = Math.max(0, dot(nw, L));
    return grey(18 + 150 * (AMB + lightAmt * d));
  };
  const frontN = rot([0, 0, 1], rx, ry, rz);
  const frontColor = grey(6 + 8 * lightAmt * Math.max(0, dot(frontN, L)));
  const rimColor = (n: Pt) => {
    const l2 = Math.hypot(L[0], L[1]) || 1;
    const b = Math.max(0, (n[0] * L[0] + n[1] * L[1]) / l2);
    return { stroke: grey(14 + 150 * lightAmt * b), on: lightAmt * b > 0.05 };
  };

  const castOffset = (frame < T.cut ? 1 : 0) * interpolate(frame, [0, T.slide.door + T.slideDur], [80, 170], clamp);

  // ---- type ----
  const w1 = interpolate(frame, [T.word1, T.word1 + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const w2 = interpolate(frame, [T.word2, T.word2 + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const ruleW = interpolate(frame, [T.rule, T.rule + 9], [0, 120], { ...clamp, easing: Easing.out(Easing.cubic) });
  const halo = "0 0 10px rgba(250,246,246,0.16)";

  const label: React.CSSProperties = {
    position: "absolute",
    fontFamily: FONT_MONO,
    fontWeight: 500,
    fontSize: 24,
    letterSpacing: "0.22em",
    color: K.grey,
    whiteSpace: "pre",
  };

  const Block3D: React.FC<{ shadowOnly?: boolean }> = ({ shadowOnly }) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        perspective: PERSPECTIVE,
        perspectiveOrigin: `${CX}px ${CY}px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: CX - MW / 2,
          top: CY - MH / 2,
          width: MW,
          height: MH,
          transformStyle: "preserve-3d",
          transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${dolly})`,
        }}
      >
        {shadowOnly ? (
          // the brutal offset shadow, now a real cast shadow on the wall behind
          <svg
            width={MW}
            height={MH}
            viewBox={`0 0 ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              overflow: "visible",
              transform: `translate3d(${castOffset * 1.15}px, ${-castOffset * 0.8}px, ${-MAX_DEPTH - 260}px)`,
            }}
          >
            {LOGO_ORDER.map((p) => (
              <path key={p} d={LOGO_PATHS[p]} fill={K.castShadow} />
            ))}
          </svg>
        ) : (
          LOGO_ORDER.map((piece) => {
            const D = depthOf(piece);
            return (
              <React.Fragment key={piece}>
                {D > 0.6 &&
                  SIDES[piece].map((s) => (
                    <div
                      key={s.key}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: s.len + 0.6,
                        height: D,
                        transformOrigin: "0 0",
                        transform: `translate3d(${s.x}px, ${s.y}px, 0px) rotateZ(${s.ang}rad) rotateX(-90deg)`,
                        backfaceVisibility: "hidden",
                        backgroundColor: sideColor(s.n),
                        // formwork board marks across the slab
                        backgroundImage:
                          "repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 2px, transparent 2px, transparent 54px)",
                      }}
                    />
                  ))}
                {/* front face */}
                <svg
                  width={MW}
                  height={MH}
                  viewBox={`0 0 ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`}
                  style={{ position: "absolute", left: 0, top: 0, overflow: "visible", transform: "translateZ(0.5px)" }}
                >
                  <path d={LOGO_PATHS[piece]} fill={frontColor} />
                  {SIDES[piece].map((s) => {
                    const r = rimColor(s.n);
                    if (!r.on) return null;
                    const x1 = s.x / S;
                    const y1 = s.y / S;
                    const x2 = x1 + (Math.cos(s.ang) * s.len) / S;
                    const y2 = y1 + (Math.sin(s.ang) * s.len) / S;
                    return (
                      <line key={s.key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={r.stroke} strokeWidth={3.2 / S} strokeLinecap="square" />
                    );
                  })}
                </svg>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <AbsoluteFill>
      {!clear && (
        <AbsoluteFill
          style={{
            isolation: "isolate",
            WebkitMaskImage: mask,
            maskImage: mask,
          }}
        >
          <AbsoluteFill style={{ backgroundColor: K.wall }} />

          {/* weave + shake for everything photographed */}
          <AbsoluteFill style={{ transform: `translate(${weaveX + shX}px, ${weaveY + shY}px)` }}>
            {/* push group */}
            <AbsoluteFill
              style={{
                transform: `scale(${pushScale})`,
                transformOrigin: `${pushOrigin[0]}px ${pushOrigin[1]}px`,
              }}
            >
              {/* raking light on the wall */}
              {lit && (
                <>
                  <AbsoluteFill style={{ backgroundColor: K.wedgePen, clipPath: wedge(46), opacity: Math.min(1, lightAmt * 1.4) }} />
                  <AbsoluteFill style={{ backgroundColor: K.wedgeCore, clipPath: wedge(0), opacity: Math.min(1, lightAmt * 1.4) }} />
                  {/* cast shadow, only visible inside the lit wedge */}
                  <AbsoluteFill style={{ clipPath: wedge(46), opacity: Math.min(1, lightAmt * 1.4) }}>
                    <Block3D shadowOnly />
                  </AbsoluteFill>
                </>
              )}

              <Block3D />

              {/* title, set beneath */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: W,
                  top: 1090,
                  opacity: frame >= T.cut ? 0.38 : 1,
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
                    textShadow: halo,
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
                <div
                  style={{
                    ...label,
                    position: "relative",
                    marginTop: 26,
                    fontSize: 28,
                    color: K.paper,
                    opacity: 0.86,
                    minHeight: 34,
                  }}
                >
                  {typed("WITH DENZO — TUESDAY", frame, T.host, 2)}
                </div>
              </div>
            </AbsoluteFill>
          </AbsoluteFill>

          {/* slate annotations, fixed to the frame (inside the safe area) */}
          <div style={{ ...label, left: 64, top: 112 }}>{typed("WATERHOUSE STUDIOS", frame, T.labels)}</div>
          <div style={{ ...label, right: 1080 - 950, top: 112, textAlign: "right" }}>
            {typed("52.37°N  4.89°E", frame, T.labels + 4)}
          </div>
          <div style={{ ...label, left: 64, top: 1452 }}>{typed("SESSIONS / EP.—", frame, T.labels + 8)}</div>
          <div style={{ ...label, right: 1080 - 950, top: 1452, textAlign: "right" }}>
            {typed("AMSTERDAM", frame, T.labels + 12)}
          </div>
          {/* corner ticks */}
          {frame >= T.labels &&
            [
              [64, 80, 1, 1],
              [950, 80, -1, 1],
              [64, 1500, 1, -1],
              [950, 1500, -1, -1],
            ].map(([x, y, sx, sy], i) => (
              <div key={i} style={{ position: "absolute", left: x, top: y, width: 0, height: 0 }}>
                <div style={{ position: "absolute", left: sx > 0 ? 0 : -22, top: 0, width: 22, height: 2, backgroundColor: "#3a3a3a" }} />
                <div style={{ position: "absolute", left: 0, top: sy > 0 ? 0 : -22, width: 2, height: 22, backgroundColor: "#3a3a3a" }} />
              </div>
            ))}

          {/* vignette */}
          <AbsoluteFill
            style={{
              background: "radial-gradient(ellipse 75% 60% at 50% 42%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)",
              pointerEvents: "none",
            }}
          />

          <FilmGrain frame={frame} />

          {/* the slit of light: a hairline before it opens, then the two lit edges */}
          {frame >= T.slit && (
            <>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: W,
                  top: MID - Math.max(0, slitHalf) - 3,
                  height: frame < T.openStart ? 6 : 3,
                  backgroundColor: K.paper,
                  boxShadow: "0 0 14px rgba(250,246,246,0.35)",
                }}
              />
              {frame >= T.openStart && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    width: W,
                    top: MID + slitHalf,
                    height: 3,
                    backgroundColor: K.paper,
                    boxShadow: "0 0 14px rgba(250,246,246,0.35)",
                  }}
                />
              )}
            </>
          )}
        </AbsoluteFill>
      )}

      {/* ---- sound: low, industrial ---- */}
      <Sequence durationInFrames={T.cut} layout="none">
        <Audio src={staticFile("ident/audio/monolith/rumble.wav")} volume={(f) => interpolate(f, [0, 20, T.cut - 4, T.cut], [0, 0.8, 0.8, 0], clamp)} />
      </Sequence>
      <Sequence from={2} layout="none">
        <Audio src={staticFile("audio/bumper/hum.wav")} volume={0.22} playbackRate={0.6} />
      </Sequence>
      {landings.map((f, i) => (
        <Sequence key={i} from={f} layout="none">
          <Audio src={staticFile("ident/audio/monolith/boom.wav")} volume={() => [0.7, 0.55, 0.55, 0.95][i]} playbackRate={[1, 1.06, 1.12, 0.92][i]} />
          {i === 3 && <Audio src={staticFile("ident/audio/monolith/metal.wav")} volume={0.32} playbackRate={0.85} />}
        </Sequence>
      ))}
      {LOGO_ORDER.map((p) => (
        <Sequence key={p} from={T.slide[p]} layout="none">
          <Audio src={staticFile("audio/bumper/clunk.wav")} volume={0.12} playbackRate={0.55} />
        </Sequence>
      ))}
      {[0, 4, 8, 12].map((d) => (
        <Sequence key={d} from={T.labels + d} layout="none">
          <Audio src={staticFile("audio/bumper/led-click.wav")} volume={0.1} playbackRate={0.7} />
        </Sequence>
      ))}
      <Sequence from={T.word1} layout="none">
        <Audio src={staticFile("ident/audio/monolith/slit.wav")} volume={0.35} playbackRate={0.7} />
      </Sequence>
      <Sequence from={T.cut} layout="none">
        <Audio src={staticFile("ident/audio/monolith/switch.wav")} volume={1} />
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={0.45} playbackRate={0.7} />
      </Sequence>
      <Sequence from={T.pushEnd + 1 - 42} layout="none">
        <Audio src={staticFile("ident/audio/monolith/swell.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={T.slit} layout="none">
        <Audio src={staticFile("ident/audio/monolith/boom.wav")} volume={1} playbackRate={0.85} />
        <Audio src={staticFile("ident/audio/monolith/metal.wav")} volume={0.55} />
        <Audio src={staticFile("ident/audio/monolith/slit.wav")} volume={0.6} />
      </Sequence>
    </AbsoluteFill>
  );
};
