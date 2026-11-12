import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, COPY, FONT_DISPLAY, FONT_MONO, rand } from "./brand";
import { Grain, Logo } from "./common";

/**
 * DEADPAN — a deadpan text bump in the brand's own type.
 * Typed mono lines on paper → browser-style selection in the sites' ::selection
 * yellow → DELETE → black frame → SLAM title card → caret, select-all, DELETE →
 * transparent (the interview shows through).
 */

export const DEADPAN_FRAMES = 144;

// ---- Timeline (frames @30) ------------------------------------------------
const T = {
  line1Start: 3,
  line2Start: 45, // after the deadpan pause
  selectStart: 86, // drag-select across both lines
  selectFrames: 6,
  delete1: 96, // text gone, caret alone
  flash: 97, // 1 frame black
  slam: 98, // title card
  caretBack: 114, // caret reappears after SESSIONS
  selectAll: 125, // flood wipe, 4 frames
  selectAllFrames: 4,
  delete2: 131, // everything gone; caret lingers 2 frames
  clear: 133, // fully transparent from here
};

const LINE1 = "it's tuesday.";
const LINE2 = "denzo has questions.";

// Type timing with human jitter: ~1.6 f/char, longer after spaces/punctuation.
const typeTimes = (text: string, start: number, seed: number): number[] => {
  const out: number[] = [];
  let t = start;
  for (let i = 0; i < text.length; i++) {
    out.push(Math.round(t));
    const ch = text[i];
    let step = 1.25 + rand(seed + i * 7.31) * 0.9;
    if (ch === " ") step += 0.6;
    if (ch === "'") step += 0.4;
    t += step;
  }
  return out;
};
const T1 = typeTimes(LINE1, T.line1Start, 11);
const T2 = typeTimes(LINE2, T.line2Start, 29);
const LAST_KEY_1 = T1[T1.length - 1];
const LAST_KEY_2 = T2[T2.length - 1];

// ---- Type metrics -----------------------------------------------------------
// JetBrains Mono: advance 600/1000 em, cap height 730/1000 em, ascent 1020, descent 300.
const FS = 68;
const CW = FS * 0.6;
const CAP = FS * 0.73;
const LINE_H = Math.round(FS * 1.32); // selection boxes butt together, like a browser
const X0 = 104;
const Y_LINE1 = 830; // top of line box 1

/** Blink on a strict 15-frame cycle (8 on / 7 off), phase-locked to the last keystroke. */
const blinkOn = (frame: number, since: number) => ((frame - since) % 15) < 8;

const Caret: React.FC<{ x: number; baselineY: number; cap: number; w: number }> = ({ x, baselineY, cap, w }) => (
  <div style={{ position: "absolute", left: x, top: baselineY - cap, width: w, height: cap, background: C.ink }} />
);

// Text line laid out on the mono grid (each char absolutely placed so the grid is exact).
const MonoLine: React.FC<{ text: string; n: number; top: number }> = ({ text, n, top }) => (
  <div
    style={{
      position: "absolute",
      left: X0,
      top,
      height: LINE_H,
      lineHeight: `${LINE_H}px`,
      fontFamily: FONT_MONO,
      fontWeight: 500,
      fontSize: FS,
      color: C.ink,
      whiteSpace: "pre",
      letterSpacing: 0,
      fontFeatureSettings: '"liga" 0, "calt" 0',
    }}
  >
    {text.slice(0, n)}
  </div>
);

// Baseline inside a line box: half-leading + ascent. Content area = 1.32em, so baseline ≈ top + 1.02em.
const baselineOf = (top: number) => top + (LINE_H - FS * 1.32) / 2 + FS * 1.02;

// ---- Act 1: typing ----------------------------------------------------------
const TypingAct: React.FC<{ frame: number }> = ({ frame }) => {
  const n1 = T1.filter((t) => t <= frame).length;
  const n2 = T2.filter((t) => t <= frame).length;
  const top1 = Y_LINE1;
  const top2 = Y_LINE1 + LINE_H;
  const onLine2 = frame >= T.line2Start - 1; // caret drops a line just before typing resumes

  // Selection: drag from line1 start to line2 end; chars selected in reading order.
  const total = LINE1.length + LINE2.length;
  const selProg = frame < T.selectStart ? 0 : Math.min(1, (frame - T.selectStart + 1) / T.selectFrames);
  const selN = Math.round(selProg * total);
  const sel1 = Math.min(selN, LINE1.length);
  const sel2 = Math.max(0, selN - LINE1.length);
  const selecting = selN > 0;
  const deleted = frame >= T.delete1;

  // Caret position & visibility
  let caret: { x: number; top: number } | null = null;
  if (!selecting) {
    if (onLine2) {
      const since = n2 > 0 ? T2[n2 - 1] : T.line2Start - 1;
      const typing = frame <= LAST_KEY_2;
      if (typing || blinkOn(frame, since)) caret = { x: X0 + n2 * CW, top: top2 };
    } else {
      const since = n1 > 0 ? T1[n1 - 1] : 0;
      const typing = frame >= T.line1Start && frame <= LAST_KEY_1;
      if (typing || blinkOn(frame, since)) caret = { x: X0 + n1 * CW, top: top1 };
    }
  }
  if (deleted) caret = { x: X0, top: top1 };

  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {!deleted && sel1 > 0 && (
        <div style={{ position: "absolute", left: X0, top: top1, width: (sel1 + (sel2 > 0 ? 1 : 0)) * CW, height: LINE_H, background: C.yellow }} />
      )}
      {!deleted && sel2 > 0 && (
        <div
          style={{
            position: "absolute",
            left: X0,
            top: top2,
            // browsers extend the selection past the line end by one space on wrapped lines; keep exact here
            width: sel2 * CW,
            height: LINE_H,
            background: C.yellow,
          }}
        />
      )}
      {!deleted && <MonoLine text={LINE1} n={n1} top={top1} />}
      {!deleted && <MonoLine text={LINE2} n={n2} top={top2} />}
      {caret && <Caret x={caret.x} baselineY={baselineOf(caret.top)} cap={CAP} w={CW} />}
      <Grain />
    </AbsoluteFill>
  );
};

// ---- Act 2: SLAM title card -------------------------------------------------
// Rubik Mono One: monospaced, advance ≈ 0.86em (measured), cap height ≈ 0.70em.
const RUBIK_ADV = 0.86;
const RUBIK_CAP = 0.7;
const TRACK = -0.04; // em, tight like the sites' font-display (-0.01em at small sizes, tighter at poster size)
const M = 64; // side margin
const TITLE_W = 1080 - M * 2;
const fitSize = (n: number) => TITLE_W / (n * (RUBIK_ADV + TRACK) - TRACK);
const FS_A = fitSize(COPY.title1.length);
const FS_B = fitSize(COPY.title2.length);

// Card geometry
const CARD = { x: M, y: 400, w: TITLE_W, h: 560 };
const SHADOW_PX = 22;
const BORDER_PX = 8;
const TITLE_A_TOP = CARD.y + CARD.h + SHADOW_PX + 56;
const GAP = 22;
const TITLE_B_TOP = TITLE_A_TOP + FS_A * RUBIK_CAP + GAP;
const TITLE_B_BASE = TITLE_B_TOP + FS_B * RUBIK_CAP;
// the same caret as act 1, back on the empty line under the title
const CARET2_BASE = TITLE_B_BASE + 150;

const Title: React.FC<{ text: string; size: number; capTop: number }> = ({ text, size, capTop }) => (
  <div
    style={{
      position: "absolute",
      left: M,
      // place the cap top exactly: line box = 1em, cap top sits at ascent - capHeight from box top
      top: capTop - size * (RUBIK_ASC - RUBIK_CAP),
      height: size,
      lineHeight: `${size}px`,
      fontFamily: FONT_DISPLAY,
      fontSize: size,
      letterSpacing: `${TRACK}em`,
      color: C.ink,
      whiteSpace: "pre",
    }}
  >
    {text}
  </div>
);
// Rubik Mono One vertical metrics (normalised to a 1em line box): baseline ≈ 0.80em from top
const RUBIK_ASC = 0.8;

const SlamCard: React.FC<{ frame: number }> = ({ frame }) => {
  const f = frame - T.slam;
  // 2-frame overshoot, then settle
  const scale = f === 0 ? 1.08 : f === 1 ? 0.98 : 1;
  // heavy shake decaying over ~6 frames
  const amp = f < 7 ? 46 * Math.pow(1 - f / 7, 1.6) : 0;
  const sx = (rand(f * 3.1 + 1) - 0.5) * 2 * amp;
  const sy = (rand(f * 5.7 + 2) - 0.5) * 2 * amp;
  const rot = (rand(f * 2.3 + 9) - 0.5) * 2 * amp * 0.03;

  // Caret after SESSIONS, blinks once, then select-all floods
  const caretOn = frame >= T.caretBack && frame < T.selectAll && blinkOn(frame, T.caretBack);
  const floodP = frame < T.selectAll ? 0 : Math.min(1, (frame - T.selectAll + 1) / T.selectAllFrames);

  return (
    <AbsoluteFill style={{ background: C.paper, overflow: "hidden" }}>
      {/* select-all flood: grows top→bottom like a drag over the whole doc */}
      {floodP > 0 && (
        <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: `${floodP * 100}%`, background: C.yellow }} />
      )}
      <AbsoluteFill
        style={{
          transform: `translate(${sx}px, ${sy}px) rotate(${rot}deg) scale(${scale})`,
          transformOrigin: "50% 45%",
        }}
      >
        {/* corner bug */}
        <div style={{ position: "absolute", left: M, top: 272, display: "flex", gap: 16 }}>
          <div
            style={{
              background: C.yellow,
              border: `5px solid ${C.ink}`,
              fontFamily: FONT_MONO,
              fontWeight: 800,
              fontSize: 36,
              letterSpacing: "0.15em",
              padding: "6px 10px 6px 16px",
              color: C.ink,
            }}
          >
            TUE
          </div>
          <div
            style={{
              background: C.ink,
              border: `5px solid ${C.ink}`,
              fontFamily: FONT_MONO,
              fontWeight: 700,
              fontSize: 36,
              letterSpacing: "0.15em",
              padding: "6px 10px 6px 16px",
              color: C.yellow,
            }}
          >
            {COPY.host}
          </div>
        </div>

        {/* yellow brutal card with the mark */}
        <div
          style={{
            position: "absolute",
            left: CARD.x,
            top: CARD.y,
            width: CARD.w,
            height: CARD.h,
            background: C.yellow,
            border: `${BORDER_PX}px solid ${C.ink}`,
            boxShadow: `${SHADOW_PX}px ${SHADOW_PX}px 0 0 ${C.ink}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Logo width={CARD.w - 170} />
        </div>

        <Title text={COPY.title1} size={FS_A} capTop={TITLE_A_TOP} />
        <Title text={COPY.title2} size={FS_B} capTop={TITLE_B_TOP} />

        {caretOn && <Caret x={M} baselineY={CARET2_BASE} cap={CAP} w={CW} />}
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

// ---- Sound -------------------------------------------------------------------
const Sfx: React.FC<{ at: number; src: string; volume?: number; dur?: number }> = ({ at, src, volume = 1, dur = 30 }) => (
  <Sequence from={at} durationInFrames={dur} layout="none">
    <Audio src={staticFile(src)} volume={volume} />
  </Sequence>
);

const Sound: React.FC = () => (
  <>
    {[...T1, ...T2].map((t, i) => (
      <Sfx key={`k${i}`} at={t} src={i % 3 === 1 ? "audio/bumper/led-click.wav" : "audio/recap/tick.wav"} volume={0.28 + rand(i * 1.7) * 0.14} dur={4} />
    ))}
    {/* return key */}
    <Sfx at={T.line2Start - 1} src="audio/bumper/clack.wav" volume={0.35} dur={4} />
    {/* drag-select */}
    <Sfx at={T.selectStart} src="audio/pullup/click.wav" volume={0.5} dur={4} />
    {/* delete */}
    <Sfx at={T.delete1} src="audio/bumper/relay.wav" volume={0.55} dur={4} />
    {/* SLAM */}
    <Sfx at={T.slam} src="audio/recap/slam.wav" volume={1} dur={12} />
    <Sfx at={T.slam} src="audio/bumper/thump.wav" volume={0.9} dur={24} />
    <Sfx at={T.slam} src="audio/pullup/thud.wav" volume={0.6} dur={8} />
    {/* select-all + delete */}
    <Sfx at={T.selectAll} src="audio/pullup/click.wav" volume={0.55} dur={4} />
    <Sfx at={T.delete2} src="audio/bumper/relay.wav" volume={0.7} dur={4} />
    <Sfx at={T.delete2} src="audio/recap/pop.wav" volume={0.45} dur={4} />
  </>
);

// ---- Composition -------------------------------------------------------------
export const Deadpan: React.FC = () => {
  const frame = useCurrentFrame();
  let body: React.ReactNode = null;
  if (frame < T.flash) body = <TypingAct frame={frame} />;
  else if (frame === T.flash) body = <AbsoluteFill style={{ background: C.ink }} />;
  else if (frame < T.delete2) body = <SlamCard frame={frame} />;
  else if (frame < T.clear) {
    // the caret lingers over the content for 2 frames, then it too is gone
    body = <Caret x={M} baselineY={CARET2_BASE} cap={CAP} w={CW} />;
  }
  return (
    <AbsoluteFill>
      {body}
      <Sound />
    </AbsoluteFill>
  );
};
