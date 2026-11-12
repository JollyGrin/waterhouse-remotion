import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, LOGO_PATHS, W, rand } from "./brand";

/**
 * TILE — "the mark multiplies into an infinite brand wallpaper, then we dive through one door".
 *
 * One mark → spits out a 3×3 block → 5×5 → the whole wallpaper, the camera pulling out on
 * each beat with overshoot. Rows tick sideways like a mechanical ticker, the title lands on
 * a black band, the camera locks on one tile and flies through its door: the door piece is
 * a hole (SVG mask) that grows past the lens, its thick black frame edge flying by.
 *
 * Beat grid: 120 bpm, beat = 15 f, 8th = 7.5 f.
 */
export const TILE_FRAMES = 116;
const FPS = 30;

const T = {
  shadow: 2,
  antic: 10,
  split1: 15,
  split2: 30,
  wall: 45,
  band: 52,
  tick1: 60,
  tag: 67,
  tick2: 75,
  bandOut: 80,
  lock: 82,
  diveStart: 88,
  hole: 89,
  diveDur: 16,
};

// ---- world ----
const CW = 1000; // cell width (world units)
const CH = 840;
const LS = 0.76; // logo scale inside a cell
const LOX = -500 * LS; // logo origin, centred in the cell
const LOY = -333 * LS;
const IMAX = 9; // columns -8..8 (room for the ticker shift)
const JMAX = 9;
const SHIFT_CELLS = 2; // per tick
const MARK_SHADOW = 30; // logo units, mark's own hard shadow inside a cell

// camera
const S0 = 1.0;
const S1 = 0.31;
const S2 = 0.196;
const S3 = 0.17;
const S_END = 20;
const ANCHOR0: [number, number] = [540, 800];
const ANCHOR1: [number, number] = [540, 960];

// the door, logo units. Pivot = centre of its rectangular part.
const DOOR_PX = 685.85;
const DOOR_PY = 552.3;
const DOOR_STROKE = 13; // logo units; flies past the lens as the thick frame edge
const PIVOT: [number, number] = [LOX + LS * DOOR_PX, LOY + LS * DOOR_PY];
// Fully clear once the door's inner rect (minus half the stroke) covers 1080×1920 around the pivot.
const S_CLEAR = (960 / ((DOOR_PY - (438.767 + DOOR_STROKE / 2)) * LS)) * 1.04;

const LOGO_D = [LOGO_PATHS.house, LOGO_PATHS.slatA, LOGO_PATHS.slatB, LOGO_PATHS.door].join(" ");
const MARK_D_NO_DOOR = [LOGO_PATHS.house, LOGO_PATHS.slatA, LOGO_PATHS.slatB].join(" ");

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const sp = (frame: number, at: number, config: Parameters<typeof spring>[0]["config"] = {}) =>
  frame < at ? 0 : spring({ frame: frame - at, fps: FPS, config });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- colourways ----
type Way = { bg: string; mark: string; shadow: string };
const WAYS: Way[] = [
  { bg: C.paper, mark: C.ink, shadow: C.yellow },
  { bg: C.yellow, mark: C.ink, shadow: C.paper },
  { bg: C.twitch, mark: C.paper, shadow: C.ink },
  { bg: C.amber, mark: C.ink, shadow: C.paper },
];
const ACCENTS: Way[] = [
  { bg: C.mint, mark: C.ink, shadow: C.paper },
  { bg: C.punch, mark: C.paper, shadow: C.ink },
];
const mod = (n: number, m: number) => ((n % m) + m) % m;
// the tile that ends up dead centre after the ticker (row 0 moves right by 2 ticks)
const TARGET_I = -2 * SHIFT_CELLS;
const wayFor = (i: number, j: number): Way => {
  if ((i === 0 && j === 0) || (i === TARGET_I && j === 0)) return WAYS[0];
  const h = rand(i * 31.7 + j * 113.3 + 5);
  if (Math.max(Math.abs(i), Math.abs(j)) >= 2 && h < 0.09) return ACCENTS[h < 0.045 ? 0 : 1];
  return WAYS[mod(i + 2 * j, 4)];
};

// ---- cells ----
type Cell = { i: number; j: number; ring: number; appear: number; way: Way };
const CELLS: Cell[] = (() => {
  const out: Cell[] = [];
  for (let j = -JMAX; j <= JMAX; j++) {
    for (let i = -IMAX; i <= IMAX; i++) {
      const ring = Math.max(Math.abs(i), Math.abs(j));
      const ang = (Math.atan2(j, i) + Math.PI) / (2 * Math.PI); // pinwheel stagger
      let appear = 0;
      if (ring === 1) appear = T.split1 + Math.round(ang * 2);
      else if (ring === 2) appear = T.split2 + Math.round(ang * 2);
      else if (ring >= 3) appear = T.wall + Math.round((ring - 3) * 0.6) + Math.round(ang * 2);
      out.push({ i, j, ring, appear, way: wayFor(i, j) });
    }
  }
  // children are born from under their parents (outer rings first); the target tile last so it can pop over its neighbours at the lock
  const key = (c: Cell) => (c.i === TARGET_I && c.j === 0 ? -1 : c.ring);
  return out.sort((a, b) => key(b) - key(a));
})();

// ---- camera ----
const logZoom = (f: number) => {
  const p1 = sp(f, T.split1, { damping: 13, stiffness: 160, mass: 0.8 });
  const p2 = sp(f, T.split2, { damping: 13, stiffness: 160, mass: 0.8 });
  const p3 = sp(f, T.wall, { damping: 15, stiffness: 120, mass: 0.9 });
  let z = Math.log(S0) + (Math.log(S1) - Math.log(S0)) * p1 + (Math.log(S2) - Math.log(S1)) * p2 + (Math.log(S3) - Math.log(S2)) * p3;
  // slow drift out during the hold
  z += interpolate(f, [T.wall + 8, T.lock], [0, -0.05], clamp);
  // lock: settle back in a touch
  z += 0.05 * sp(f, T.lock, { damping: 14, stiffness: 140 });
  // dive anticipation (pull back), then accelerate through the door
  const antic = interpolate(f, [T.diveStart - 4, T.diveStart, T.diveStart + 3], [0, -0.09, 0], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const dive = interpolate(f, [T.diveStart, T.diveStart + T.diveDur], [0, 1], { ...clamp, easing: Easing.in(Easing.poly(2.2)) });
  z += antic + (Math.log(S_END) - Math.log(S3 * Math.exp(0.0))) * dive;
  return z;
};
const zoomAt = (f: number) => Math.exp(logZoom(f));

const IMPACTS: { f: number; amp: number }[] = [
  { f: T.shadow, amp: 6 },
  { f: T.split1 + 1, amp: 12 },
  { f: T.split2 + 1, amp: 12 },
  { f: T.wall + 2, amp: 18 },
  { f: T.band, amp: 10 },
  { f: T.tick1, amp: 7 },
  { f: T.tag, amp: 8 },
  { f: T.tick2, amp: 7 },
  { f: T.lock, amp: 5 },
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
    r += (rand(f * 41 + t + 3) - 0.5) * 0.2 * k;
  }
  return { x, y, r };
};

// ticker: rows shift by whole cells on two beats, mechanical clunk with a hair of overshoot
const tickP = (f: number, at: number) => sp(f, at, { damping: 17, stiffness: 320, mass: 0.6 });
const rowDir = (j: number) => (mod(j, 2) === 0 ? 1 : -1);
const rowShiftCells = (f: number) => SHIFT_CELLS * (tickP(f, T.tick1) + tickP(f, T.tick2));

const CLEAR_FROM = (() => {
  for (let f = T.diveStart; f < TILE_FRAMES; f++) if (zoomAt(f) >= S_CLEAR) return f;
  return TILE_FRAMES;
})();

// ---------------------------------------------------------------------------

const Band: React.FC<{ frame: number }> = ({ frame }) => {
  const inP = sp(frame, T.band, { damping: 11, stiffness: 220, mass: 0.7 });
  const outP = interpolate(frame, [T.bandOut, T.bandOut + 6], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  if (frame < T.band || outP >= 1) return null;
  const sy = inP * (1 - outP);
  const LC = { damping: 22, stiffness: 240 };
  const l1 = sp(frame, T.band + 1, LC);
  const l2 = sp(frame, T.band + 4, LC);
  const v1 = l1 - sp(frame - 1, T.band + 1, LC);
  const v2 = l2 - sp(frame - 1, T.band + 4, LC);
  const top = 1070;
  const h = 296;
  const exitX = outP * 1300;
  return (
    <div style={{ position: "absolute", left: 0, top, width: W, height: h, transform: `scaleY(${sy})`, transformOrigin: "50% 50%" }}>
      {/* hard purple shadow + yellow rules */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 18, height: h, background: C.twitch }} />
      <div style={{ position: "absolute", inset: 0, background: C.ink, borderTop: `12px solid ${C.yellow}`, borderBottom: `12px solid ${C.yellow}` }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 28,
          textAlign: "center",
          fontFamily: FONT_DISPLAY,
          fontSize: 116,
          lineHeight: "122px",
          letterSpacing: "-0.04em",
          color: C.yellow,
          transform: `translateX(${(1 - l1) * -1100 - exitX}px) skewX(${Math.max(-20, Math.min(20, v1 * 60))}deg)`,
        }}
      >
        WATERHOUSE
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 152,
          textAlign: "center",
          fontFamily: FONT_DISPLAY,
          fontSize: 116,
          lineHeight: "122px",
          letterSpacing: "-0.04em",
          color: C.paper,
          transform: `translateX(${(1 - l2) * 1100 + exitX}px) skewX(${Math.max(-20, Math.min(20, -v2 * 60))}deg)`,
        }}
      >
        SESSIONS
      </div>
    </div>
  );
};

const Tag: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < T.tag) return null;
  const p = sp(frame, T.tag, { damping: 10, stiffness: 260, mass: 0.6 });
  const out = interpolate(frame, [T.bandOut - 1, T.bandOut + 5], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  if (out >= 1) return null;
  const flash = frame - T.tag < 2;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 1388,
        display: "flex",
        justifyContent: "center",
        transform: `translateY(${out * 260}px) scale(${lerp(1.5, 1, Math.min(p, 1.2))}) rotate(-1.5deg)`,
      }}
    >
      <div
        style={{
          background: flash ? C.yellow : C.ink,
          color: flash ? C.ink : C.yellow,
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 40,
          letterSpacing: "0.22em",
          padding: "14px 26px 14px 34px",
          border: `5px solid ${C.ink}`,
          boxShadow: `10px 10px 0 0 ${C.twitch}`,
        }}
      >
        WITH DENZO · TUESDAY
      </div>
    </div>
  );
};

export const Tile: React.FC = () => {
  const frame = useCurrentFrame();
  const cleared = frame >= CLEAR_FROM;

  const s = zoomAt(frame);
  const sh = frame >= T.diveStart ? { x: 0, y: 0, r: 0 } : shake(frame);
  // wallpaper tilts on the wall beat, the lock snaps it straight
  const tilt = -3.2 * sp(frame, T.wall, { damping: 12, stiffness: 110 }) * (1 - sp(frame, T.lock, { damping: 13, stiffness: 220 }));
  const lockP = sp(frame, T.lock, { damping: 15, stiffness: 150 });
  const focusX = lerp(0, PIVOT[0], lockP);
  const focusY = lerp(0, PIVOT[1], lockP);
  const ax = lerp(ANCHOR0[0], ANCHOR1[0], lockP) + sh.x;
  const ay = lerp(ANCHOR0[1], ANCHOR1[1], lockP) + sh.y;
  const cam = `translate(${ax} ${ay}) rotate(${tilt + sh.r}) scale(${s}) translate(${-focusX} ${-focusY})`;

  const shiftC = rowShiftCells(frame);
  const shiftPrev = rowShiftCells(frame - 1);
  const vel = shiftC - shiftPrev; // cells per frame

  // hero anticipation squash before the first split
  const antic = interpolate(frame, [T.antic, T.split1 - 1, T.split1 + 2], [0, 1, 0], clamp);
  const heroSx = 1 + 0.05 * antic;
  const heroSy = 1 - 0.07 * antic;

  const shadowP = sp(frame, T.shadow, { damping: 9, stiffness: 300, mass: 0.5 });
  const gridOn = frame >= T.split1;
  const holeOn = frame >= T.hole;
  const holeFlash = frame >= T.hole - 1 && frame < T.hole; // one yellow frame before the knock-out
  const lockBox = frame >= T.lock && frame < T.diveStart + 4;
  const lockBoxP = sp(frame, T.lock, { damping: 10, stiffness: 260, mass: 0.6 });
  // the locked tile jumps forward a hair, then settles
  const targetPop = 1 + 0.16 * interpolate(frame, [T.lock, T.lock + 2, T.lock + 9], [0, 1, 0], { ...clamp, easing: Easing.out(Easing.quad) });

  const blockShadow = 14 / s; // screen px → world, the whole block's hard shadow
  const grainSeed = Math.floor(frame / 2) % 8;

  const cellPos = (c: { i: number; j: number }, f: number) => {
    const x = c.i * CW + rowDir(c.j) * rowShiftCells(f) * CW;
    return [x, c.j * CH] as [number, number];
  };

  const cellTransform = (c: Cell) => {
    if (c.ring === 0) return { x: cellPos(c, frame)[0], y: 0, sc: 1 };
    const p = spring({ frame: frame - c.appear, fps: FPS, config: { damping: 12, stiffness: 190, mass: 0.7 } });
    const [tx, ty] = cellPos(c, frame);
    const parent = { i: c.i - Math.sign(c.i), j: c.j - Math.sign(c.j) };
    const [px, py] = cellPos(parent, frame);
    if (c.ring >= 3) return { x: tx, y: ty, sc: p }; // the wallpaper pops in place as a radial wave
    return { x: lerp(px, tx, p), y: lerp(py, ty, p), sc: lerp(0.35, 1, Math.min(1, p)) };
  };

  const visible = CELLS.filter((c) => c.ring === 0 || frame >= c.appear);

  const skewFor = (j: number) => Math.max(-14, Math.min(14, rowDir(j) * vel * 40));

  const renderCell = (c: Cell, pass: "shadow" | "cell") => {
    const { x, y, sc } = cellTransform(c);
    const hero = c.ring === 0;
    const tgt = c.i === TARGET_I && c.j === 0;
    const sx = hero ? heroSx : tgt ? targetPop : 1;
    const sy = hero ? heroSy : tgt ? targetPop : 1;
    const skew = skewFor(c.j);
    const tr = `translate(${x} ${y}) skewX(${skew}) scale(${sc * sx} ${sc * sy})`;
    if (pass === "shadow") {
      if (!gridOn) return null;
      return (
        <rect key={`s${c.i},${c.j}`} x={-CW / 2 + blockShadow} y={-CH / 2 + blockShadow} width={CW} height={CH} fill={C.ink} transform={tr} />
      );
    }
    const isTarget = c.i === TARGET_I && c.j === 0;
    const markShadowOn = hero ? shadowP : 1;
    return (
      <g key={`c${c.i},${c.j}`} transform={tr}>
        <rect
          x={-CW / 2}
          y={-CH / 2}
          width={CW}
          height={CH}
          fill={c.way.bg}
          stroke={C.ink}
          strokeWidth={gridOn ? 10 : 0}
          vectorEffect="non-scaling-stroke"
        />
        <g transform={`translate(${LOX} ${LOY}) scale(${LS})`}>
          {markShadowOn > 0.01 && (
            <path
              d={LOGO_D}
              fill={c.way.shadow}
              transform={`translate(${MARK_SHADOW * markShadowOn} ${MARK_SHADOW * markShadowOn})`}
            />
          )}
          {isTarget && (holeOn || holeFlash) ? (
            <>
              <path d={MARK_D_NO_DOOR} fill={c.way.mark} />
              {holeFlash && <path d={LOGO_PATHS.door} fill={C.yellow} />}
              <path d={LOGO_PATHS.door} fill="none" stroke={C.ink} strokeWidth={DOOR_STROKE} strokeLinejoin="miter" />
            </>
          ) : (
            <path d={LOGO_D} fill={c.way.mark} />
          )}
        </g>
      </g>
    );
  };

  const targetPos = cellPos({ i: TARGET_I, j: 0 }, frame);

  return (
    <AbsoluteFill>
      {!cleared && (
        <>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <mask id="door-hole" maskUnits="userSpaceOnUse" x={-200} y={-200} width={W + 400} height={H + 400}>
                <rect x={-200} y={-200} width={W + 400} height={H + 400} fill="#fff" />
                {holeOn && (
                  <g transform={cam}>
                    <g transform={`translate(${targetPos[0]} ${targetPos[1]}) translate(${LOX} ${LOY}) scale(${LS})`}>
                      <path d={LOGO_PATHS.door} fill="#000" />
                    </g>
                  </g>
                )}
              </mask>
              <filter id={`tile-grain-${grainSeed}`} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={grainSeed} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
            </defs>
            <g mask="url(#door-hole)">
              <rect x={0} y={0} width={W} height={H} fill={C.paper} />
              <g transform={cam}>
                {visible.map((c) => renderCell(c, "shadow"))}
                {visible.map((c) => renderCell(c, "cell"))}
                {lockBox && (
                  <g transform={`translate(${targetPos[0]} ${targetPos[1]}) scale(${lerp(1.6, 1, Math.min(1.15, lockBoxP))})`}>
                    <rect
                      x={-CW / 2 - 40}
                      y={-CH / 2 - 40}
                      width={CW + 80}
                      height={CH + 80}
                      fill="none"
                      stroke={C.ink}
                      strokeWidth={22}
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={-CW / 2 - 40}
                      y={-CH / 2 - 40}
                      width={CW + 80}
                      height={CH + 80}
                      fill="none"
                      stroke={C.yellow}
                      strokeWidth={10}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )}
              </g>
              <rect
                x={0}
                y={0}
                width={W}
                height={H}
                filter={`url(#tile-grain-${grainSeed})`}
                opacity={0.08}
                style={{ mixBlendMode: "multiply" }}
              />
            </g>
          </svg>
          <Band frame={frame} />
          <Tag frame={frame} />
        </>
      )}

      {/* ---- sound ---- */}
      <Sequence from={T.shadow} layout="none">
        <Audio src={staticFile("audio/recap/pop.wav")} volume={0.7} />
        <Audio src={staticFile("audio/pullup/click.wav")} volume={0.5} />
      </Sequence>
      <Sequence from={T.antic} layout="none">
        <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={T.split1} layout="none">
        <Audio src={staticFile("audio/recap/pop.wav")} volume={0.9} playbackRate={0.9} />
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.8} />
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.25} playbackRate={1.4} />
      </Sequence>
      <Sequence from={T.split2} layout="none">
        <Audio src={staticFile("audio/recap/pop.wav")} volume={0.9} playbackRate={1.15} />
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.8} playbackRate={1.12} />
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.25} playbackRate={1.6} />
      </Sequence>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <Sequence key={k} from={T.wall + k} layout="none">
          <Audio src={staticFile(`audio/pullup/pop-friend-${k}.wav`)} volume={0.55} playbackRate={1 + k * 0.08} />
        </Sequence>
      ))}
      <Sequence from={T.wall + 1} layout="none">
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.5} />
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.8} playbackRate={0.85} />
      </Sequence>
      <Sequence from={T.band} layout="none">
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.8} />
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.4} />
      </Sequence>
      {[T.tick1, T.tick2].map((f, k) => (
        <Sequence key={f} from={f} layout="none">
          <Audio src={staticFile("audio/bumper/clack.wav")} volume={0.9} playbackRate={k ? 0.9 : 1} />
          <Audio src={staticFile("audio/bumper/relay.wav")} volume={0.5} />
          <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.3} playbackRate={1.7} />
        </Sequence>
      ))}
      <Sequence from={T.tag} layout="none">
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.55} />
      </Sequence>
      <Sequence from={T.bandOut} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.35} playbackRate={1.3} />
      </Sequence>
      <Sequence from={T.lock} layout="none">
        <Audio src={staticFile("audio/bumper/led-click.wav")} volume={0.9} />
        <Audio src={staticFile("audio/recap/tick.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={CLEAR_FROM - 20} layout="none">
        <Audio src={staticFile("audio/bumper/cymbal-reverse.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={T.diveStart} layout="none">
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.5} />
      </Sequence>
      <Sequence from={CLEAR_FROM} layout="none">
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={1} />
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.6} playbackRate={0.85} />
      </Sequence>
    </AbsoluteFill>
  );
};
