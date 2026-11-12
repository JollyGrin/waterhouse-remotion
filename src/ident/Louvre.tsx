import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_ORDER, LOGO_PATHS, LOGO_VIEWBOX, W } from "./brand";

/**
 * LOUVRE: the frame is a wall of heavy vertical metal fins, lit by one hard raking light
 * from the left. Each fin is a real CSS-3D slab (two faces and two edges) turning on its own
 * axis. A staggered rotation wave runs across the wall, so the incoming face catches the rake
 * (a sheen ripples across as the fins land) and the outgoing one goes black.
 * The faces carry slices of an image, so it only reads when the fins lock: closed wall →
 * wave 1 (L→R) shows the mark → wave 2 (R→L) shows the lockup → wave 3 (from the centre out)
 * turns the fins edge-on, the gaps open onto the content, and the fins part like doors.
 * While the wall is closed a dim backlight bleeds through the gaps as the fins turn.
 *
 * Grid: 120 bpm → beat = 15 f.
 */
export const LOUVRE_FRAMES = 140;

// ---- timeline (frames) ----
const LIGHT_ON = 3; // breaker: the rake snaps on
const W1 = { start: 12, stagger: 1.0, dur: 19 }; // L→R, lands ≈ 45
const W2 = { start: 58, stagger: 1.0, dur: 19 }; // R→L, lands ≈ 91
const W3 = { start: 105, stagger: 1.25, dur: 15 }; // centre-out, to edge-on
const SPLIT = { start: 118, dur: 11 }; // the fins part
const CLEAR = 130;

// ---- geometry ----
const P = 72; // fin pitch = face width
const NV = 15; // visible fins (15 × 72 = 1080)
const EXTRA = 3; // fins beyond each frame edge (camera angle)
const D = 16; // fin thickness
const TOP = -160;
const BH = H + 320;
const PERSP = 2400;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const finEase = Easing.bezier(0.72, 0, 0.22, 1); // heavy start, firm stop
const deg = Math.PI / 180;

type V3 = [number, number, number];
const nrm = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const LIGHT = nrm([-0.85, -0.2, 0.5]); // toward the light: hard left, a bit high, in front
const HALF = nrm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

// ---- per-fin rotation ----
const ord = (i: number) => Math.min(NV - 1, Math.max(0, i)); // extras follow their nearest visible fin
const phase = (f: number, w: { start: number; stagger: number; dur: number }, k: number) =>
  finEase(Math.min(1, Math.max(0, (f - (w.start + k * w.stagger)) / w.dur)));
const landAt = (w: { start: number; stagger: number; dur: number }, k: number) => w.start + k * w.stagger + w.dur;
const k1 = (i: number) => ord(i);
const k2 = (i: number) => NV - 1 - ord(i);
const k3 = (i: number) => Math.abs(ord(i) - (NV - 1) / 2);

const angle = (f: number, i: number) => {
  let a = 180 * phase(f, W1, k1(i)) + 180 * phase(f, W2, k2(i)) + 90 * phase(f, W3, k3(i));
  // firm mechanical stop: a one-degree shudder, no rebound
  for (const [w, k] of [
    [W1, k1(i)],
    [W2, k2(i)],
  ] as const) {
    const t = f - landAt(w, k);
    if (t >= 0 && t < 5) a += [0.9, -0.5, 0.25, -0.1, 0][Math.floor(t)];
  }
  return a;
};

// ---- light ----
const lightOn = (f: number) => {
  if (f < LIGHT_ON) return 0;
  return [0.75, 0.38, 0.92][f - LIGHT_ON] ?? 1; // a tube catching (two onsets)
};
const shade = (n: V3, L: number, falloff: number) => {
  const lam = Math.max(0, dot(n, LIGHT));
  const b = 0.035 + L * falloff * (0.1 + 1.8 * lam);
  const spec = L * Math.pow(Math.max(0, dot(n, HALF)), 70) * 0.5;
  return { b, spec };
};

// ---- palette ----
const FACE_TOP = "#1c1c1b";
const FACE_BOT = "#0b0b0b";
const EDGE = "#2b2a28";
const INK = "#e4e0d9"; // the printed mark: paper, slightly dirty
const LABEL = "#5f5d59";

// ---- the three images printed across the wall (frame coords, y offset by -TOP) ----
const LW = 820;
const LS = LW / LOGO_VIEWBOX.w;
const LOGO_Y = 610;
const TW = 800;

const Corners: React.FC = () => (
  <g style={{ fontFamily: FONT_MONO }} fontWeight={500} fill={LABEL}>
    <text x={84} y={176} fontSize={22} letterSpacing={6}>
      WATERHOUSE STUDIOS
    </text>
    <text x={W - 150} y={176} fontSize={22} letterSpacing={6} textAnchor="end">
      AMS
    </text>
    <text x={84} y={1440} fontSize={18} letterSpacing={5}>
      52.37°N 4.90°E
    </text>
    <text x={W - 150} y={1440} fontSize={18} letterSpacing={5} textAnchor="end">
      120 BPM
    </text>
  </g>
);

const ImgWall: React.FC = () => (
  <>
    <Corners />
    <g style={{ fontFamily: FONT_MONO }} fontWeight={500} fill="#3a3936" fontSize={16} letterSpacing={3}>
      {Array.from({ length: NV }, (_, i) => (
        <text key={i} x={i * P + P / 2} y={1520} textAnchor="middle">
          {String(i + 1).padStart(2, "0")}
        </text>
      ))}
    </g>
  </>
);

const ImgMark: React.FC = () => (
  <>
    <Corners />
    <g transform={`translate(${(W - LW) / 2} ${LOGO_Y}) scale(${LS})`}>
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={INK} />
      ))}
    </g>
    <text x={W / 2} y={LOGO_Y + LOGO_VIEWBOX.h * LS + 110} fontSize={22} letterSpacing={10} fill={LABEL} textAnchor="middle" style={{ fontFamily: FONT_MONO }} fontWeight={500}>
      SESSIONS · EP.—
    </text>
  </>
);

const SMW = 330;
const SMS = SMW / LOGO_VIEWBOX.w;
const ImgTitle: React.FC = () => (
  <>
    <Corners />
    <g transform={`translate(${(W - SMW) / 2} ${560}) scale(${SMS})`}>
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={INK} />
      ))}
    </g>
    <g fill={INK} style={{ fontFamily: FONT_DISPLAY }} fontSize={92} textAnchor="middle">
      <text x={W / 2} y={930} textLength={TW} lengthAdjust="spacing">
        WATERHOUSE
      </text>
      <text x={W / 2} y={1046} textLength={TW} lengthAdjust="spacing">
        SESSIONS
      </text>
    </g>
    <rect x={W / 2 - 64} y={1100} width={128} height={5} fill={C.yellow} />
    <g style={{ fontFamily: FONT_MONO }} fontWeight={500} textAnchor="middle">
      <text x={W / 2} y={1168} fontSize={32} letterSpacing={10} fill="#a9a59f">
        WITH DENZO · TUESDAY
      </text>
      <text x={W / 2} y={1216} fontSize={22} letterSpacing={12} fill={LABEL}>
        AMSTERDAM
      </text>
    </g>
  </>
);

const IMAGES = { wall: ImgWall, mark: ImgMark, title: ImgTitle } as const;
type ImgKey = keyof typeof IMAGES;

/** One face: the slice of an image under fin i, lit. */
const Face: React.FC<{ i: number; img: ImgKey; b: number; spec: number; transform: string; grainSeed: number }> = ({
  i,
  img,
  b,
  spec,
  transform,
  grainSeed,
}) => {
  const Img = IMAGES[img];
  const x0 = i * P;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: P,
        height: BH,
        overflow: "hidden",
        transform,
        backfaceVisibility: "hidden",
        background: `linear-gradient(180deg, ${FACE_TOP} 0%, #151514 45%, ${FACE_BOT} 100%)`,
        filter: `brightness(${b.toFixed(3)})`,
      }}
    >
      <svg width={P} height={BH} viewBox={`${x0} ${TOP} ${P} ${BH}`} style={{ position: "absolute", left: 0, top: 0 }}>
        {/* brushed fins: fine vertical striations */}
        <rect x={x0} y={TOP} width={P} height={BH} fill="url(#lv-brush)" />
        {/* the rake: a pool of light upper-left, falling away to a dark lower-right */}
        <rect x={x0} y={TOP} width={P} height={BH} fill="url(#lv-pool)" />
        <rect x={x0} y={TOP} width={P} height={BH} fill="url(#lv-fall)" />
        <Img />
        <rect x={x0} y={TOP} width={P} height={BH} filter={`url(#lv-grain${grainSeed})`} opacity={0.11} style={{ mixBlendMode: "screen" }} />
        <rect x={x0} y={TOP} width={P} height={BH} filter={`url(#lv-grain${(grainSeed + 3) % 8})`} opacity={0.18} style={{ mixBlendMode: "multiply" }} />
        {/* bevels: the leading edge catches the rake, a dark seam on the trailing edge */}
        <rect x={x0} y={TOP} width={2} height={BH} fill="#fff" opacity={0.09} />
        <rect x={x0 + P - 2} y={TOP} width={2} height={BH} fill="#000" opacity={0.7} />
      </svg>
      {spec > 0.003 ? (
        <div style={{ position: "absolute", inset: 0, background: "#f4f1ea", opacity: spec, mixBlendMode: "screen" }} />
      ) : null}
    </div>
  );
};

export const Louvre: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= CLEAR) return <AbsoluteFill />;

  const L = lightOn(f);
  const closedBehind = f < W3.start; // backlit void behind the fins until wave 3; then the content
  const gs = Math.floor(f / 2) % 8;

  // ---- camera: slow inertial drift from a raking 3/4 to near-frontal, weight on the landings ----
  const ease = Easing.inOut(Easing.cubic);
  const ry = interpolate(f, [0, 92, CLEAR], [-11, -2.2, -1.2], { ...clamp, easing: ease });
  const rx = interpolate(f, [0, 92, CLEAR], [5, 1.2, 0.6], { ...clamp, easing: ease });
  const tz = interpolate(f, [0, 92, CLEAR], [-140, -20, 30], { ...clamp, easing: ease });
  const drift = Math.sin(f / 27) * 5;
  let ky = 0;
  const lands: [number, number][] = [
    [landAt(W1, NV - 1), 7],
    [landAt(W2, NV - 1), 9],
  ];
  for (const [at, amp] of lands) {
    const t = f - Math.round(at);
    if (t >= 0 && t < 10) ky += amp * Math.exp(-t / 2) * (t % 2 === 0 ? 1 : -0.6);
  }
  const cam = `translate3d(${drift}px, ${ky}px, ${tz}px) rotateX(${rx}deg) rotateY(${ry}deg)`;

  // ---- fins ----
  const fins = [];
  const haze: { x: number; o: number }[] = [];
  for (let i = -EXTRA; i < NV + EXTRA; i++) {
    const a = angle(f, i);
    const th = a * deg;
    const s = Math.sin(th);
    const c = Math.cos(th);
    const falloff = 1.16 - 0.42 * ((i + 0.5) / NV); // the rake falls off to the right
    const nF: V3 = [s, 0, c];
    const nB: V3 = [-s, 0, -c];
    const nL: V3 = [-c, 0, s];
    const nR: V3 = [c, 0, -s];
    const front: ImgKey = a < 90 ? "wall" : "title"; // swapped while it faces away
    const back: ImgKey = "mark";

    // the split: once edge-on, the fins part from the centre like doors
    const k = k3(i);
    const st = interpolate(f, [SPLIT.start + k * 0.35, SPLIT.start + k * 0.35 + SPLIT.dur], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
    const dir = i + 0.5 <= NV / 2 ? -1 : 1;
    const sx = dir * st * (W / 2 + 260);

    const sF = shade(nF, L, falloff);
    const sB = shade(nB, L, falloff);
    const sL = shade(nL, L, falloff);
    const sR = shade(nR, L, falloff);
    fins.push(
      <div
        key={i}
        style={{
          position: "absolute",
          left: i * P,
          top: TOP,
          width: P,
          height: BH,
          transformStyle: "preserve-3d",
          transform: `translateX(${sx}px) rotateY(${a}deg)`,
        }}
      >
        <Face i={i} img={front} b={sF.b} spec={sF.spec} transform={`translateZ(${D / 2}px)`} grainSeed={gs} />
        <Face i={i} img={back} b={sB.b} spec={sB.spec} transform={`rotateY(180deg) translateZ(${D / 2}px)`} grainSeed={gs} />
        <div
          style={{
            position: "absolute",
            left: P / 2 - D / 2,
            top: 0,
            width: D,
            height: BH,
            background: EDGE,
            backfaceVisibility: "hidden",
            transform: `rotateY(-90deg) translateZ(${P / 2}px)`,
            filter: `brightness(${sL.b.toFixed(3)})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: P / 2 - D / 2,
            top: 0,
            width: D,
            height: BH,
            background: EDGE,
            backfaceVisibility: "hidden",
            transform: `rotateY(90deg) translateZ(${P / 2}px)`,
            filter: `brightness(${sR.b.toFixed(3)})`,
          }}
        />
      </div>,
    );
    if (closedBehind && i >= -1 && i <= NV) haze.push({ x: i * P + P / 2, o: (1 - Math.abs(c)) * L });
  }

  return (
    <AbsoluteFill>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <defs>
          <pattern id="lv-brush" patternUnits="userSpaceOnUse" width={7} height={BH}>
            <rect x={0} width={1} height={BH} fill="#fff" opacity={0.035} />
            <rect x={3} width={1} height={BH} fill="#000" opacity={0.25} />
            <rect x={5} width={1} height={BH} fill="#fff" opacity={0.018} />
          </pattern>
          <radialGradient id="lv-pool" gradientUnits="userSpaceOnUse" cx={300} cy={780} r={1050}>
            <stop offset="0%" stopColor="#fff6e8" stopOpacity={0.16} />
            <stop offset="45%" stopColor="#fff6e8" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#fff6e8" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="lv-fall" gradientUnits="userSpaceOnUse" x1={250} y1={600} x2={1000} y2={1800}>
            <stop offset="0%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.7} />
          </linearGradient>
          {Array.from({ length: 8 }, (_, s) => (
            <filter key={s} id={`lv-grain${s}`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={s * 7 + 1} />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          ))}
        </defs>
      </svg>

      {/* behind the fins: a dim backlit void, until wave 3 makes it the content */}
      {closedBehind ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 70% 45% at 30% 38%, rgba(118,114,106,${0.9 * L}) 0%, rgba(40,39,37,${L}) 45%, #060606 100%)`,
            backgroundColor: "#060606",
          }}
        />
      ) : null}

      <AbsoluteFill style={{ perspective: PERSP, perspectiveOrigin: "50% 42%" }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d", transform: cam }}>{fins}</AbsoluteFill>
      </AbsoluteFill>

      {/* backlight bleeding through the turning fins into the haze */}
      {closedBehind ? (
        <AbsoluteFill style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
          {haze.map((h, j) =>
            h.o > 0.01 ? (
              <div
                key={j}
                style={{
                  position: "absolute",
                  left: h.x - P * 1.4,
                  top: 0,
                  width: P * 2.8,
                  height: H,
                  opacity: h.o * 0.16,
                  background: "radial-gradient(ellipse 50% 60% at 50% 40%, #efe9dd 0%, rgba(239,233,221,0.35) 40%, rgba(239,233,221,0) 75%)",
                }}
              />
            ) : null,
          )}
        </AbsoluteFill>
      ) : null}

      {/* ---- sound ---- */}
      <Sequence durationInFrames={CLEAR + 6} layout="none">
        <Audio src={staticFile("ident/audio/louvre/drone.wav")} volume={(fr) => interpolate(fr, [0, 8, W3.start, CLEAR + 4], [0, 0.6, 0.7, 0], clamp)} />
      </Sequence>
      <Sequence from={LIGHT_ON} layout="none">
        <Audio src={staticFile("ident/audio/louvre/breaker.wav")} volume={0.8} />
      </Sequence>
      {[W1, W2, W3].map((w, j) => (
        <Sequence key={j} from={w.start - 2} layout="none">
          <Audio src={staticFile("ident/audio/louvre/motor.wav")} volume={() => [0.55, 0.55, 0.45][j]} playbackRate={[1, 0.94, 1.1][j]} />
          <Audio src={staticFile(`ident/audio/louvre/cascade${j + 1}.wav`)} volume={0.85} />
        </Sequence>
      ))}
      <Sequence from={Math.round(landAt(W1, NV - 1)) - 1} layout="none">
        <Audio src={staticFile("ident/audio/louvre/boom.wav")} volume={0.8} />
      </Sequence>
      <Sequence from={Math.round(landAt(W2, NV - 1)) - 1} layout="none">
        <Audio src={staticFile("ident/audio/louvre/boom.wav")} volume={1} playbackRate={0.88} />
      </Sequence>
      <Sequence from={SPLIT.start} layout="none">
        <Audio src={staticFile("ident/audio/louvre/part.wav")} volume={0.7} />
      </Sequence>
    </AbsoluteFill>
  );
};

