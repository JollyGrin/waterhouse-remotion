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
 * POP-UP — the mark is a paper pop-up book.
 * Hard cut to a closed purple book on the paper table. It swings open on its spine,
 * and the four die-cut pieces lie flat on the right-hand... near page showing their
 * coloured backs. On the beat each one peels, flips (colour -> black) and stands up
 * on the spine with overshoot. The title pops up as two folded tabs, a bookmark tab
 * slides out of the top. Exit: the pieces fold flat onto the page (the flat logo),
 * then the whole FRAME folds in half along the spine toward the lens like closing
 * the card, slaps shut (the bottom half is now the content), and the folded card
 * tips away into the screen.
 *
 * Beat grid: 120 bpm, beat = 15 f, 8th = 7.5 f.
 */
export const POPUP_FRAMES = 116;
const FPS = 30;

const T = {
  tremble: 2,
  open: 6,
  land: 15, // cover hits the table (approx; spring)
  pieces: { house: 22, slatA: 30, slatB: 37, door: 45 } as Record<LogoPiece, number>,
  tab1: 52,
  tab2: 60,
  bookmark: 67,
  foldDown: 83, // pieces fold flat onto the far page, staggered
  foldUp: 89, // frame folds toward the lens
  slap: 97,
  tipStart: 100,
  tipEnd: 107, // fully clear from here
};

// ---- layout (page space: origin at the spine centre, -y = far page, +y = near page) ----
const SY = 900; // spine on screen: the frame folds exactly here
const CX = 500;
const BW = 880;
const BH = 660;
const LW = 720;
const LH = (LW * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w;
const STAND = -64; // standing angle (deg, rotateX about the hinge); -90 = vertical, leaning back to face camera
const BORDER = 10;
const BOOK_SHADOW = 26;

const BACKS: Record<LogoPiece, string> = {
  house: C.yellow,
  slatA: C.twitch,
  slatB: C.amber,
  door: C.punch,
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const sp = (frame: number, at: number, config: Parameters<typeof spring>[0]["config"] = {}) =>
  spring({ frame: frame - at, fps: FPS, config });

const IMPACTS: { f: number; amp: number }[] = [
  { f: T.land, amp: 14 },
  { f: T.pieces.house + 5, amp: 6 },
  { f: T.pieces.slatA + 5, amp: 4 },
  { f: T.pieces.slatB + 5, amp: 4 },
  { f: T.pieces.door + 5, amp: 8 },
  { f: T.tab1 + 5, amp: 5 },
  { f: T.tab2 + 5, amp: 6 },
  { f: T.foldDown + 6, amp: 6 },
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
// angles

/** Cover angle: +180 closed (lying on the far page, outside up) -> 0 open (flat on the near side). */
const coverAngle = (frame: number) => {
  if (frame < T.open) {
    // anticipation: the cover lifts a hair, settles, then goes
    return 180 - interpolate(frame, [T.tremble, T.tremble + 2, T.open], [0, 6, 0], clamp);
  }
  const s = sp(frame, T.open, { damping: 9, stiffness: 95, mass: 0.75 });
  let c = 180 * (1 - s);
  if (c < 0) c = -c * 0.7; // bounces off the table instead of going through it
  return c;
};

/** A pop-up card's angle relative to the page/cover. -180 = lying flat toward the viewer (back up). */
const popAngle = (frame: number, at: number, foldAt: number, seed: number) => {
  // peel: lifts a few degrees, sticks, then snaps up
  const peel = interpolate(frame, [at - 6, at - 3, at - 1], [0, 9, 2], clamp);
  const up = sp(frame, at, { damping: 7.5, stiffness: 150, mass: 0.7 });
  let a = -180 + peel + (STAND + 180) * up;
  // life: tiny sway after it settles
  const t = frame - at;
  if (t > 8) a += Math.sin(t / 8 + seed) * 1.6 * Math.min(1, (t - 8) / 10);
  // exit: fold back down flat toward the viewer (colour flashes back), gravity, tiny bounce
  if (frame >= foldAt) {
    const b = interpolate(frame, [foldAt, foldAt + 5], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
    a = a * (1 - b) - 180 * b;
    const tl = frame - (foldAt + 5);
    if (tl > 0) a += 9 * Math.exp(-tl / 1.6) * Math.abs(Math.sin(tl * 1.3));
  }
  return a;
};

// ---------------------------------------------------------------------------
// pieces

const PATH_VB = `0 0 ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`;

/** One die-cut card: 4 stacked layers so it has a real edge when it passes edge-on. */
const PieceCard: React.FC<{ piece: LogoPiece; angle: number }> = ({ piece, angle }) => {
  const layers: { z: number; fill: string }[] = [
    { z: -4.5, fill: BACKS[piece] },
    { z: -1.5, fill: C.ink },
    { z: 1.5, fill: C.ink },
    { z: 4.5, fill: C.ink },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: BW / 2 - LW / 2,
        top: -LH,
        width: LW,
        height: LH,
        transformStyle: "preserve-3d",
        transformOrigin: "50% 100%",
        transform: `translateZ(7px) rotateX(${angle}deg)`,
      }}
    >
      {layers.map(({ z, fill }, i) => (
        <svg
          key={i}
          width={LW}
          height={LH}
          viewBox={PATH_VB}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible", transform: `translateZ(${z}px)` }}
        >
          <path d={LOGO_PATHS[piece]} fill={fill} stroke={i === 0 ? C.ink : "none"} strokeWidth={i === 0 ? 10 : 0} />
        </svg>
      ))}
    </div>
  );
};

/** Hard flat shadow of a card on the page: its orthographic footprint, sheared by the light. */
const PieceShadow: React.FC<{ piece: LogoPiece; angle: number }> = ({ piece, angle }) => {
  const r = (angle * Math.PI) / 180;
  const k = Math.cos(r);
  const sh = -0.42 * Math.abs(Math.sin(r));
  return (
    <svg
      width={LW}
      height={LH}
      viewBox={PATH_VB}
      style={{
        position: "absolute",
        left: -LW / 2,
        top: -LH,
        overflow: "visible",
        transformOrigin: "50% 100%",
        transform: `translateZ(1px) matrix(1, 0, ${sh}, ${k}, 0, 0)`,
      }}
    >
      <path d={LOGO_PATHS[piece]} fill="rgba(0,0,0,0.17)" />
    </svg>
  );
};

/** A title tab: a folded strip that pops up off the near page. */
const Tab: React.FC<{
  hingeY: number; // cover-local y of the hinge
  w: number;
  h: number;
  angle: number;
  face: string;
  ink: string;
  back: string;
  text: string;
  size: number;
}> = ({ hingeY, w, h, angle, face, ink, back, text, size }) => (
  <div
    style={{
      position: "absolute",
      left: BW / 2 - w / 2,
      top: hingeY - h,
      width: w,
      height: h,
      transformStyle: "preserve-3d",
      transformOrigin: "50% 100%",
      transform: `translateZ(4px) rotateX(${angle}deg)`,
    }}
  >
    {/* back */}
    <div style={{ position: "absolute", inset: 0, background: back, border: `${BORDER - 2}px solid ${C.ink}`, transform: "translateZ(-3px)" }} />
    {/* edge */}
    <div style={{ position: "absolute", inset: 0, background: C.ink, transform: "translateZ(0px)" }} />
    {/* face */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: face,
        border: `${BORDER - 2}px solid ${C.ink}`,
        transform: "translateZ(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_DISPLAY,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        color: ink,
        whiteSpace: "nowrap",
        paddingTop: size * 0.06,
      }}
    >
      {text}
    </div>
  </div>
);

// ---------------------------------------------------------------------------

const Registration: React.FC<{ dx: number; dy: number }> = ({ dx, dy }) => (
  <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px)` }}>
    <svg width={W + 400} height={H + 400} style={{ position: "absolute", left: -200, top: -200 }}>
      <defs>
        <pattern id="pp-reg" width={120} height={120} patternUnits="userSpaceOnUse">
          <path d="M60 50 V70 M50 60 H70" stroke={C.ink} strokeWidth={3} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#pp-reg)" opacity={0.11} />
    </svg>
  </AbsoluteFill>
);

const HAZARD = `repeating-linear-gradient(45deg, ${C.ink} 0 22px, ${C.yellow} 22px 44px)`;

/** The cover's outside: what you see on the hard cut. */
const CoverOutside: React.FC = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: C.twitch,
      border: `${BORDER}px solid ${C.ink}`,
      backfaceVisibility: "hidden",
      transform: "translateZ(-1px) rotateX(180deg)",
      overflow: "hidden",
    }}
  >
    {/* hazard spine (at the bottom of this face = the spine edge once flipped) */}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 54, background: HAZARD, borderTop: `${BORDER}px solid ${C.ink}` }} />
    <svg
      width={460}
      height={(460 * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w}
      viewBox={PATH_VB}
      style={{ position: "absolute", left: 60, top: 150, overflow: "visible" }}
    >
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={C.ink} />
      ))}
    </svg>
    <div
      style={{
        position: "absolute",
        left: 56,
        top: 52,
        background: C.ink,
        color: C.yellow,
        fontFamily: FONT_MONO,
        fontWeight: 800,
        fontSize: 30,
        letterSpacing: "0.22em",
        padding: "10px 16px 10px 20px",
      }}
    >
      WH·S 01
    </div>
    <div
      style={{
        position: "absolute",
        left: 60,
        top: 480,
        fontFamily: FONT_DISPLAY,
        fontSize: 62,
        color: C.paper,
        letterSpacing: "-0.02em",
        WebkitTextStroke: `0px`,
        textShadow: `6px 6px 0 ${C.ink}`,
      }}
    >
      SESSIONS
    </div>
  </div>
);

const Scene: React.FC<{ frame: number }> = ({ frame }) => {
  const c = coverAngle(frame);
  const open = c < 100; // inside of the cover faces up: pieces visible
  const landed = frame >= T.land;

  // camera: steep look-down on the closed book, eases to the hero tilt as it opens
  const camS = sp(frame, T.open - 2, { damping: 12, stiffness: 60, mass: 1 });
  const th = Math.max(0, frame - T.open);
  const tilt = 52 - 16 * camS + Math.sin(th / 23) * 1.2;
  const ry = -5 + 7 * camS + Math.sin(th / 29 + 0.7) * 2.2;
  const rz = -2 + 2.6 * camS + Math.sin(th / 31) * 0.5;
  const push = 1.12 - 0.17 * camS + frame * 0.0006;
  const camY = 300 * (1 - camS);
  const sh = shake(frame);

  const ang = (p: LogoPiece, i: number) => popAngle(frame, T.pieces[p], T.foldDown + i * 1.5, i * 1.7);
  const tab1A = popAngle(frame, T.tab1, T.foldDown + 3, 5.1);
  const tab2A = popAngle(frame, T.tab2, T.foldDown + 4, 2.3);

  const nearShadow = sp(frame, T.land, { damping: 10, stiffness: 300, mass: 0.5 });
  const bm = sp(frame, T.bookmark, { damping: 11, stiffness: 170, mass: 0.7 });
  const bmFold = interpolate(frame, [T.foldDown, T.foldDown + 4], [1, 0], { ...clamp, easing: Easing.in(Easing.quad) });

  return (
    <AbsoluteFill style={{ isolation: "isolate", backgroundColor: C.paper, overflow: "hidden" }}>
      <Registration dx={ry * 2.4 + sh.x * 0.4} dy={-(tilt - 36) * 3 + sh.y * 0.4} />
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}deg)` }}>
        <div style={{ position: "absolute", inset: 0, perspective: 1900, perspectiveOrigin: `${CX}px ${SY - 330 + camY}px` }}>
          {/* book group: zero-size at the spine centre */}
          <div
            style={{
              position: "absolute",
              left: CX + 40 * (1 - camS),
              top: SY + camY,
              width: 0,
              height: 0,
              transformStyle: "preserve-3d",
              transform: `scale(${push}) rotateX(${tilt}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
            }}
          >
            {/* table shadows */}
            <div
              style={{
                position: "absolute",
                left: -BW / 2 + BOOK_SHADOW,
                top: -BH + BOOK_SHADOW,
                width: BW,
                height: BH,
                background: C.ink,
                transform: "translateZ(-2px)",
              }}
            />
            {landed && (
              <div
                style={{
                  position: "absolute",
                  left: -BW / 2 + BOOK_SHADOW * nearShadow,
                  top: BOOK_SHADOW * nearShadow,
                  width: BW,
                  height: BH,
                  background: C.ink,
                  transform: "translateZ(-2px)",
                }}
              />
            )}

            {/* bookmark tab: slides out of the top of the far page */}
            <div
              style={{
                position: "absolute",
                left: -140,
                top: -BH - 118 * bm * bmFold + 20,
                width: 600,
                height: 150,
                background: C.ink,
                transform: "translateZ(-1px)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: 16,
                color: C.yellow,
                fontFamily: FONT_MONO,
                fontWeight: 800,
                fontSize: 40,
                letterSpacing: "0.2em",
                whiteSpace: "nowrap",
              }}
            >
              WITH DENZO · TUE
            </div>

            {/* far page */}
            <div
              style={{
                position: "absolute",
                left: -BW / 2,
                top: -BH,
                width: BW,
                height: BH,
                background: C.paper,
                border: `${BORDER}px solid ${C.ink}`,
                borderBottomWidth: 4,
              }}
            />

            {/* hard flat shadows of the pop-ups on the page */}
            {open &&
              landed &&
              LOGO_ORDER.map((p, i) => <PieceShadow key={p} piece={p} angle={ang(p, i)} />)}

            {/* the cover: near page when open */}
            <div
              style={{
                position: "absolute",
                left: -BW / 2,
                top: 0,
                width: BW,
                height: BH,
                transformStyle: "preserve-3d",
                transformOrigin: "50% 0%",
                transform: `rotateX(${c}deg)`,
              }}
            >
              {/* inside */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: C.paper,
                  border: `${BORDER}px solid ${C.ink}`,
                  borderTopWidth: 4,
                  backfaceVisibility: "hidden",
                }}
              >
                {/* print marks on the inside page */}
                <div
                  style={{
                    position: "absolute",
                    right: 22,
                    bottom: 16,
                    fontFamily: FONT_MONO,
                    fontWeight: 700,
                    fontSize: 20,
                    letterSpacing: "0.2em",
                    color: C.ink,
                    opacity: 0.55,
                  }}
                >
                  FOLD · POP · 01
                </div>
              </div>
              <CoverOutside />

              {open && (
                <>
                  <Tab hingeY={300} w={760} h={112} angle={tab1A} face={C.yellow} ink={C.ink} back={C.mint} text="WATERHOUSE" size={74} />
                  <Tab hingeY={520} w={640} h={124} angle={tab2A} face={C.ink} ink={C.yellow} back={C.yellow} text="SESSIONS" size={86} />
                  {LOGO_ORDER.map((p, i) => (
                    <PieceCard key={p} piece={p} angle={ang(p, i)} />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </AbsoluteFill>
      <Grain opacity={0.09} />
    </AbsoluteFill>
  );
};

/** Back of the card once the frame has folded: shown on the top half. */
const PH = H - SY; // the folded half's height; once landed it spans [SY - PH, SY]
const BackPanel: React.FC = () => (
  <AbsoluteFill style={{ background: C.yellow, isolation: "isolate" }}>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 70, background: HAZARD, borderTop: `${BORDER}px solid ${C.ink}` }} />
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 700,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: C.ink,
          color: C.yellow,
          fontFamily: FONT_MONO,
          fontWeight: 800,
          fontSize: 38,
          letterSpacing: "0.22em",
          padding: "14px 22px 14px 30px",
          boxShadow: `8px 8px 0 0 ${C.twitch}`,
        }}
      >
        WITH DENZO · TUESDAY
      </div>
    </div>
    <svg
      width={560}
      height={(560 * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w}
      viewBox={PATH_VB}
      style={{ position: "absolute", left: (W - 560) / 2 - 10, top: 270, overflow: "visible" }}
    >
      {LOGO_ORDER.map((p) => (
        <path key={p} d={LOGO_PATHS[p]} fill={C.ink} />
      ))}
    </svg>
    <Grain opacity={0.09} />
  </AbsoluteFill>
);

export const Popup: React.FC = () => {
  const frame = useCurrentFrame();

  const folding = frame >= T.foldUp && frame < T.slap;
  const slapped = frame >= T.slap;
  const clear = frame >= T.tipEnd;

  // frame fold toward the lens, gravity in, slap
  const a = interpolate(frame, [T.foldUp, T.slap], [0, 180], { ...clamp, easing: Easing.in(Easing.quad) });
  // tip away into the screen about the top edge
  const tipAntic = interpolate(frame, [T.slap, T.slap + 2, T.tipStart], [0, 4, 0], clamp);
  const tip = interpolate(frame, [T.tipStart, T.tipEnd], [0, -90], { ...clamp, easing: Easing.in(Easing.quad) });
  // slap shake on the folded card
  const st = frame - T.slap;
  const slapY = st >= 0 && st < 6 ? Math.exp(-st / 1.4) * 16 * (st % 2 ? -1 : 1) : 0;

  const topClip = `polygon(0 0, ${W}px 0, ${W}px ${SY}px, 0 ${SY}px)`;
  const botClip = `polygon(0 ${SY}px, ${W}px ${SY}px, ${W}px ${H}px, 0 ${H}px)`;

  return (
    <AbsoluteFill>
      {!folding && !slapped && <Scene frame={frame} />}

      {folding && (
        <>
          <AbsoluteFill style={{ clipPath: topClip }}>
            <Scene frame={frame} />
          </AbsoluteFill>
          <AbsoluteFill style={{ perspective: 2300, perspectiveOrigin: `${W / 2}px ${SY}px` }}>
            <AbsoluteFill
              style={{
                transformStyle: "preserve-3d",
                transformOrigin: `50% ${SY}px`,
                transform: `rotateX(${a}deg)`,
              }}
            >
              <AbsoluteFill style={{ clipPath: botClip, backfaceVisibility: "hidden" }}>
                <Scene frame={frame} />
              </AbsoluteFill>
              {/* the back of the bottom half, pre-flipped so it reads upright once landed */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: SY,
                  width: W,
                  height: H - SY,
                  backfaceVisibility: "hidden",
                  transform: "rotateX(180deg)",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, width: W, height: PH }}>
                  <BackPanel />
                </div>
              </div>
            </AbsoluteFill>
          </AbsoluteFill>
        </>
      )}

      {slapped && !clear && (
        <AbsoluteFill style={{ perspective: 1600, perspectiveOrigin: `${W / 2}px 0px` }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: W,
              height: SY,
              overflow: "hidden",
              transformOrigin: "50% 0%",
              transform: `translateY(${slapY}px) rotateX(${tip + tipAntic}deg)`,
              borderBottom: `${BORDER}px solid ${C.ink}`,
            }}
          >
            <div style={{ position: "absolute", left: 0, top: SY - PH, width: W, height: PH }}>
              <BackPanel />
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* ---- sound ---- */}
      <Sequence from={T.tremble} layout="none">
        <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.7} />
      </Sequence>
      <Sequence from={T.open} layout="none">
        <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.8} />
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.3} playbackRate={1.2} />
      </Sequence>
      <Sequence from={T.land} layout="none">
        <Audio src={staticFile("audio/pullup/thud.wav")} volume={1} playbackRate={0.85} />
        <Audio src={staticFile("audio/recap/land.wav")} volume={0.6} />
      </Sequence>
      {LOGO_ORDER.map((p, i) => (
        <React.Fragment key={p}>
          <Sequence from={T.pieces[p] - 4} layout="none">
            <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.35} playbackRate={1.3} />
          </Sequence>
          <Sequence from={T.pieces[p]} layout="none">
            <Audio src={staticFile("audio/recap/pop.wav")} volume={0.85} playbackRate={[1, 1.12, 1.25, 0.9][i]} />
          </Sequence>
          <Sequence from={T.pieces[p] + 5} layout="none">
            <Audio src={staticFile("audio/pullup/thud.wav")} volume={0.45} playbackRate={[1.2, 1.35, 1.45, 1.0][i]} />
          </Sequence>
        </React.Fragment>
      ))}
      <Sequence from={T.tab1} layout="none">
        <Audio src={staticFile("audio/recap/pop.wav")} volume={0.8} playbackRate={1.35} />
        <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.35} playbackRate={1.4} />
      </Sequence>
      <Sequence from={T.tab2} layout="none">
        <Audio src={staticFile("audio/recap/pop.wav")} volume={0.85} playbackRate={1.5} />
        <Audio src={staticFile("audio/bumper/rustle.wav")} volume={0.35} playbackRate={1.5} />
      </Sequence>
      <Sequence from={T.bookmark} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.35} playbackRate={1.6} />
        <Audio src={staticFile("audio/recap/tick.wav")} volume={0.6} />
      </Sequence>
      {[0, 1.5, 3, 4.5].map((d, i) => (
        <Sequence key={i} from={Math.round(T.foldDown + 5 + d)} layout="none">
          <Audio src={staticFile("audio/bumper/tap.wav")} volume={0.6} playbackRate={[1, 1.15, 0.9, 1.25][i]} />
        </Sequence>
      ))}
      <Sequence from={T.foldUp} layout="none">
        <Audio src={staticFile("audio/pullup/whoosh.wav")} volume={0.6} playbackRate={0.9} />
      </Sequence>
      <Sequence from={T.slap} layout="none">
        <Audio src={staticFile("audio/recap/slam.wav")} volume={0.9} />
        <Audio src={staticFile("audio/bumper/thump.wav")} volume={0.9} />
        <Audio src={staticFile("audio/bumper/clack.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={T.tipStart} layout="none">
        <Audio src={staticFile("audio/recap/whoosh.wav")} volume={0.55} playbackRate={0.85} />
      </Sequence>
    </AbsoluteFill>
  );
};
