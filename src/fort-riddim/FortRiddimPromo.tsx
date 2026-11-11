import React from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { measureText } from "@remotion/layout-utils";
import { loadFont as loadBagel } from "@remotion/google-fonts/BagelFatOne";
import { loadFont as loadBarlow } from "@remotion/google-fonts/Barlow";
import { CARDS, FPS, HEIGHT, WIDTH, beatPhase, type Card, type Run } from "./promo";
import { VOICES, VoiceCard, type VoiceName } from "./promoVoices";

/**
 * The billing, written over Manuel's animated RIDDIM disc.
 *
 * The lettering has to match the logo, which is hand-drawn psychedelic liquid: fat strokes
 * that swell and pinch, letters flowing into each other through liquid necks, nothing quite
 * on the baseline. No stock typeface looks like that, and four rounds of trying to find one
 * — melted Luckiest Guy, Anton, Archivo, Syne, the Rubik display faces — all read as a font
 * sitting on top of the artwork rather than as part of it.
 *
 * So it is built rather than chosen, as metaballs. A very fat face is set with NEGATIVE
 * tracking so the glyphs nearly touch, then blurred and alpha-thresholded: wherever two
 * strokes come close their blurred alphas sum past the threshold and the shapes fuse, which
 * is what draws the logo's liquid necks. Slow low-frequency noise displaces the result so
 * the outline undulates in big smooth swells rather than crawling, and each letter is
 * rotated and nudged off the baseline so it reads as drawn, not set.
 */

type Face = {
  family: string;
  /** Negative, so glyphs sit close enough for the threshold to bridge them. */
  track: string;
  max: number;
  /** Goo blur as a fraction of font size — the bridging radius. */
  blurRel: number;
  /** Displacement, also relative to size, so the wobble scales with the lettering. */
  warpRel: number;
};

/**
 * Bagel Fat One, fused hard — Manuel's words for it were "spray liquidy graffiti". The
 * fusing radius was then opened one notch from the first version, which was the whole of
 * his note: RIDDIM had turned into one mass. Opened further it reads cleanly but stops
 * looking melted, so this sits between the two.
 */
const FACE: Face = {
  family: loadBagel().fontFamily,
  track: "-0.026em",
  max: 250,
  blurRel: 0.042,
  warpRel: 0.1,
};
const face = () => FACE;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Threshold placed just under half, so shapes grow a little and bridge more willingly. */
const ALPHA = 30;
const BIAS = -13.2;
/** Big, slow noise: the logo's outline swells, it does not shimmer. */
const FREQ = 0.0042;
const HALO = 13;
const CONTOUR = 6;
/** Frames the outgoing card keeps melting past its own end, beneath the incoming one. */
const TAIL = 5;
const FIT_WIDTH = 920;
const CENTRE_Y = 880;

const Liquid: React.FC<{
  id: string;
  t: number;
  displace: number;
  blur: number;
  dilate?: number;
  soften?: number;
}> = ({ id, t, displace, blur, dilate, soften }) => (
  <svg style={{ position: "absolute", width: 0, height: 0 }}>
    <filter id={id} x="-35%" y="-60%" width="170%" height="220%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency={FREQ + FREQ * 0.3 * Math.sin(t * 1.5)}
        numOctaves={2}
        seed={7}
      />
      <feDisplacementMap in="SourceGraphic" scale={displace} xChannelSelector="R" yChannelSelector="G" />
      <feGaussianBlur stdDeviation={blur} />
      <feColorMatrix type="matrix" values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${ALPHA} ${BIAS}`} />
      {dilate ? <feMorphology operator="dilate" radius={dilate} /> : null}
      {soften ? <feGaussianBlur stdDeviation={soften} /> : null}
    </filter>
  </svg>
);

const REF = 100;
const lineUnit = (runs: Run[]) =>
  runs.reduce(
    (w, r) =>
      w +
      measureText({
        text: r.text,
        fontFamily: face().family,
        fontSize: REF * (r.rel ?? 1),
        fontWeight: 400,
        letterSpacing: face().track,
      }).width,
    0,
  );
const fit = (lines: Run[][]) =>
  Math.min(face().max, (FIT_WIDTH / Math.max(...lines.map(lineUnit))) * REF);

/** Deterministic jitter, so a card looks hand-drawn but never flickers. */
const wobble = (seed: number) => {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x) - 0.5;
};

/** One line, every letter in its own span so it can sit slightly off true. */
const Letters: React.FC<{ runs: Run[]; size: number; seed: number }> = ({ runs, size, seed }) => {
  let n = 0;
  return (
    <>
      {runs.map((r, i) =>
        [...r.text].map((ch, j) => {
          const k = seed * 31 + n++;
          if (ch === " ") return <span key={`${i}-${j}`}> </span>;
          return (
            <span
              key={`${i}-${j}`}
              style={{
                display: "inline-block",
                fontSize: r.rel ? size * r.rel : undefined,
                transform: `translateY(${wobble(k) * size * 0.07}px) rotate(${wobble(k + 0.7) * 7}deg)`,
              }}
            >
              {ch}
            </span>
          );
        }),
      )}
    </>
  );
};

const CardView: React.FC<{ card: Card; index: number }> = ({ card, index }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = card.start + f / fps;
  const len = Math.round((card.end - card.start) * fps);
  const size = fit(card.lines);

  // Melt through. The word gathers itself out of the swirl on the downbeat and runs back
  // into it, and the two overlap: the outgoing one keeps melting for TAIL frames past its
  // own end, underneath the incoming one, so at the change there is a single mass of
  // liquid reshaping rather than one caption fading out and another fading in.
  const kIn = interpolate(f, [0, 11], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const kOut = interpolate(f, [len - 7, len + TAIL], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });

  const warp = size * face().warpRel * (1 + 9 * (1 - kIn) + 10 * kOut);
  // It stays solid while it deforms and only comes apart at the end, so it reads as
  // melting rather than as a cross-fade.
  const gone = interpolate(kOut, [0.4, 1], [0, 1], clamp);
  const opacity = Math.min(1, kIn * 3) * (1 - gone);
  const scale = (1 + 0.05 * (1 - kIn) + 0.07 * kOut) * (1 + 0.022 * Math.exp(-beatPhase(t) * 14));

  // The bridging radius grows with the melt, so the letters run together into one body
  // before they go rather than dissolving as separate shapes.
  const blur = size * face().blurRel * (1 + 1.3 * (1 - kIn) + 1.6 * kOut);
  const ids = [0, 1, 2].map((n) => `liq-${index}-${n}`);

  const layer = (color: string, filter: string, o: number) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: CENTRE_Y,
        transform: `translateY(-50%) scale(${scale})`,
        textAlign: "center",
        whiteSpace: "nowrap",
        fontFamily: face().family,
        fontSize: size,
        lineHeight: 1.0,
        letterSpacing: face().track,
        color,
        opacity: o * opacity,
        filter: `url(#${filter})`,
      }}
    >
      {card.lines.map((runs, i) => (
        <div key={i}>
          <Letters runs={runs} size={size} seed={index * 10 + i} />
        </div>
      ))}
    </div>
  );

  return (
    <AbsoluteFill>
      <Liquid id={ids[0]} t={t} displace={warp} blur={blur} dilate={HALO} soften={14} />
      <Liquid id={ids[1]} t={t} displace={warp} blur={blur} dilate={CONTOUR} />
      <Liquid id={ids[2]} t={t} displace={warp} blur={blur} />
      {layer("black", ids[0], 0.85)}
      {layer("#0a0a0a", ids[1], 1)}
      {layer("white", ids[2], 1)}
    </AbsoluteFill>
  );
};

/**
 * The other voice: the reel's own captions. Barlow 600 caps with wide tracking, white with
 * a dark glow under it — the same type that says WHAT'S THE PASSWORD? in the 10·10·10 reel,
 * and the same type the poster uses for its small print. Nothing liquid: the card lands
 * slightly large and tight on the downbeat, opens its tracking out and resolves out of a
 * blur, which is exactly what 10·10·10 does in the reel.
 *
 * Over this background white alone would not hold, so each card is drawn twice: a soft
 * black halo of the same lettering underneath, then the white face on top.
 */
const { fontFamily: barlow } = loadBarlow("normal", { weights: ["600"], subsets: ["latin"] });

const CAP_TRACK = "0.16em";
const CAP_MAX = 196;
const CAP_FIT = 880;

const capUnit = (runs: Run[]) =>
  runs.reduce(
    (w, r) =>
      w +
      measureText({
        text: r.text,
        fontFamily: barlow,
        fontSize: REF * (r.rel ?? 1),
        fontWeight: 600,
        letterSpacing: CAP_TRACK,
      }).width,
    0,
  );
const capFit = (lines: Run[][]) =>
  Math.min(CAP_MAX, (CAP_FIT / Math.max(...lines.map(capUnit))) * REF);

const CaptionCard: React.FC<{ card: Card }> = ({ card }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = card.start + f / fps;
  const len = Math.round((card.end - card.start) * fps);
  const size = capFit(card.lines);

  const pop = spring({ frame: f, fps, config: { damping: 14, stiffness: 190, mass: 0.6 } });
  const out = interpolate(f, [len - 5, len], [1, 0], clamp);
  // Wide to narrow would clip both ends on the first frames; textIndent cancels the
  // trailing letter-space so it stays optically centred while the tracking opens.
  const track = interpolate(pop, [0, 1], [0.1, 0.18]);
  const kick = 1 + 0.016 * Math.exp(-beatPhase(t) * 14);
  const scale = interpolate(pop, [0, 1], [1.12, 1]) * kick;
  const opacity = Math.min(1, pop * 3) * out;

  const layer = (color: string, blur: number, o: number) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: CENTRE_Y,
        transform: `translateY(-50%) scale(${scale})`,
        textAlign: "center",
        whiteSpace: "nowrap",
        fontFamily: barlow,
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1.1,
        letterSpacing: `${track}em`,
        textIndent: `${track}em`,
        color,
        opacity: o * opacity,
        filter: blur ? `blur(${blur}px)` : undefined,
        textShadow: color === "white" ? "0 3px 6px rgba(0,0,0,0.85)" : undefined,
      }}
    >
      {card.lines.map((runs, i) => (
        <div key={i}>
          {runs.map((r, j) => (
            <span key={j} style={{ fontSize: r.rel ? size * r.rel : undefined }}>
              {r.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );

  const resolve = interpolate(pop, [0, 1], [9, 0]);
  return (
    <AbsoluteFill>
      {layer("black", 26 + resolve, 0.8)}
      {layer("black", 9 + resolve, 0.85)}
      {layer("white", resolve, 1)}
    </AbsoluteFill>
  );
};

export type Voice = "liquid" | "caption" | VoiceName;

export const FortRiddimPromo: React.FC<{ voice?: Voice }> = ({ voice = "liquid" }) => {
  const tail = voice === "liquid" ? TAIL : 0;
  if (voice !== "liquid" && voice !== "caption" && !VOICES[voice]) {
    throw new Error(`unknown voice ${voice}`);
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo
        src={staticFile("fort-riddim/promo.mp4")}
        muted
        style={{ width: WIDTH, height: HEIGHT, objectFit: "cover" }}
      />
      {CARDS.map((card, i) => (
        <Sequence
          key={card.id}
          from={Math.round(card.start * FPS)}
          durationInFrames={
            Math.round((card.end - card.start) * FPS) + (i === CARDS.length - 1 ? 0 : tail)
          }
          name={card.id}
        >
          {voice === "liquid" ? (
            <CardView card={card} index={i} />
          ) : voice === "caption" ? (
            <CaptionCard card={card} />
          ) : (
            <VoiceCard card={card} voice={voice} index={i} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
