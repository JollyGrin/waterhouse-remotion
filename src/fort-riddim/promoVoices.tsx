import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { measureText } from "@remotion/layout-utils";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadArchivoBlack } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadBigShoulders } from "@remotion/google-fonts/BigShoulders";
import { loadFont as loadBungee } from "@remotion/google-fonts/Bungee";
import { loadFont as loadRubikMono } from "@remotion/google-fonts/RubikMonoOne";
import { loadFont as loadSairaStencil } from "@remotion/google-fonts/SairaStencilOne";
import { loadFont as loadUnbounded } from "@remotion/google-fonts/Unbounded";
import { BEAT, SYLLABLES, type Card, type Run } from "./promo";

/**
 * Candidate lettering voices for the promo card, between the two Manuel has already seen:
 * the metaball Bagel Fat One read "Halloweenish", plain Barlow caps read "too basic". The
 * target he described is Outlook / Dimensions — warehouse, sound-system, drum and bass —
 * but with some play in it.
 *
 * They are all the same card on the same beat grid; only the letterforms and the way the
 * dark backing is built change, so they can be compared on one sheet.
 */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const REF = 100;
const FIT_WIDTH = 900;
const CENTRE_Y = 880;

type Kind =
  /** Hard black copy offset behind the face: screenprint, flyer, sticker. */
  | "offset"
  /** Face knocked out of a thick black outline. */
  | "outline"
  /** Stepped copies receding, so the word stands off the picture in 3D. */
  | "extrude"
  /** Blur + alpha threshold, so near strokes fuse — graffiti, but on serious letterforms. */
  | "fuse";

type Voice = {
  label: string;
  family: string;
  weight: number;
  track: string;
  max: number;
  kind: Kind;
  /** Horizontal stretch, for faces that want to be wider than they are drawn. */
  scaleX?: number;
  skew?: number;
  lineHeight?: number;
  /** offset/extrude distance in px at a 200px size. */
  depth?: number;
  /** outline thickness, same reference size. */
  stroke?: number;
  /** fuse only: bridging radius as a fraction of the size. */
  blurRel?: number;
  /** Reveal the word letter by letter on the beat grid instead of landing it whole. */
  stepped?: boolean;
};

const anton = loadAnton().fontFamily;
const archivo = loadArchivoBlack().fontFamily;
const shoulders = loadBigShoulders("normal", { weights: ["800"], subsets: ["latin"] }).fontFamily;
const bungee = loadBungee().fontFamily;
const rubikMono = loadRubikMono().fontFamily;
const stencilFamily = loadSairaStencil().fontFamily;
const unbounded = loadUnbounded("normal", { weights: ["800"], subsets: ["latin"] }).fontFamily;

export const VOICES: Record<string, Voice> = {
  // Tall, condensed, nothing decorative — the festival-poster voice. The weight does the
  // talking and the picture stays visible around it.
  tower: {
    label: "TOWER — Big Shoulders 800, knocked out of a black outline",
    family: shoulders,
    weight: 800,
    track: "0.01em",
    max: 420,
    lineHeight: 0.86,
    kind: "outline",
    stroke: 7,
  },
  // Anton, stretched wide and leaning, with a hard offset behind it: a photocopied
  // warehouse flyer. The most straightforwardly underground of the set.
  press: {
    label: "PRESS — Anton, stretched and leaning, hard offset",
    family: anton,
    weight: 400,
    track: "-0.005em",
    max: 300,
    scaleX: 1.12,
    skew: -6,
    lineHeight: 0.95,
    kind: "offset",
    depth: 11,
    stroke: 4,
  },
  // Archivo Black, fused just enough that the strokes grow into each other. The graffiti
  // idea from the version he liked, carried on letterforms that are not cartoon.
  weld: {
    label: "WELD — Archivo Black, lightly fused (graffiti on serious letters)",
    family: archivo,
    weight: 400,
    track: "-0.055em",
    max: 230,
    lineHeight: 1.0,
    kind: "fuse",
    blurRel: 0.036,
    stepped: true,
  },
  // Stencil: crates, flight cases, sound-system culture. Reads serious immediately.
  crate: {
    label: "CRATE — Saira Stencil One",
    family: stencilFamily,
    weight: 400,
    track: "0.04em",
    max: 250,
    lineHeight: 1.05,
    kind: "outline",
    stroke: 5,
  },
  // Bungee is American sign painting — fat, square, built for vertical signs. Playful
  // without being childish, and it holds up on a busy picture.
  sign: {
    label: "SIGN — Bungee, hard offset",
    family: bungee,
    weight: 400,
    track: "0.0em",
    max: 210,
    lineHeight: 1.1,
    kind: "offset",
    depth: 12,
    stroke: 3,
  },
  // Rubik Mono One extruded: chunky, mechanical, the classic jungle / dnb flyer block.
  block: {
    label: "BLOCK — Rubik Mono One, extruded",
    family: rubikMono,
    weight: 400,
    track: "-0.01em",
    max: 200,
    lineHeight: 1.1,
    kind: "extrude",
    depth: 26,
    stroke: 3,
  },
  // Unbounded: the current festival-branding voice — geometric, a bit odd, confident.
  modern: {
    label: "MODERN — Unbounded 800, offset",
    family: unbounded,
    weight: 800,
    track: "-0.01em",
    max: 215,
    lineHeight: 1.05,
    kind: "offset",
    depth: 9,
    stroke: 4,
  },
};

export type VoiceName = keyof typeof VOICES;

const unit = (v: Voice) => (runs: Run[]) =>
  runs.reduce(
    (w, r) =>
      w +
      measureText({
        text: r.text,
        fontFamily: v.family,
        fontSize: REF * (r.rel ?? 1),
        fontWeight: v.weight,
        letterSpacing: v.track,
      }).width,
    0,
  );

const fit = (v: Voice, lines: Run[][]) => {
  const widest = Math.max(...lines.map(unit(v))) * (v.scaleX ?? 1);
  return Math.min(v.max, (FIT_WIDTH / widest) * REF);
};

/** Blur + alpha threshold: where two strokes come close, their blurred alphas fuse. */
const Fuse: React.FC<{ id: string; blur: number; dilate?: number; soften?: number }> = ({
  id,
  blur,
  dilate,
  soften,
}) => (
  <svg style={{ position: "absolute", width: 0, height: 0 }}>
    <filter id={id} x="-30%" y="-50%" width="160%" height="200%">
      <feGaussianBlur stdDeviation={blur} />
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13.2" />
      {dilate ? <feMorphology operator="dilate" radius={dilate} /> : null}
      {soften ? <feGaussianBlur stdDeviation={soften} /> : null}
    </filter>
  </svg>
);

export const VoiceCard: React.FC<{
  card: Card;
  voice: VoiceName;
  index: number;
  /** Where the lettering sits; the promo is a taller frame than the showcase post. */
  centreY?: number;
  /** A sign-off card: it stays up instead of melting away for the next one. */
  hold?: boolean;
}> = ({ card, voice, index, centreY = CENTRE_Y, hold = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = VOICES[voice];
  const len = Math.round((card.end - card.start) * fps);
  const size = fit(v, card.lines);
  const k = size / 200;

  const stepped = v.stepped ?? false;
  const pop = stepped
    ? 1
    : spring({ frame: f, fps, config: { damping: 15, stiffness: 200, mass: 0.6 } });
  // It runs back into the swirl rather than cutting: the fusing radius opens over the last
  // few frames, so the letters flow together into one mass and that mass fades.
  const melt = hold
    ? 0
    : interpolate(f, [len - 7, len], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const out = interpolate(melt, [0.45, 1], [1, 0], clamp);
  const land = interpolate(pop, [0, 1], [1.1, 1], { easing: Easing.out(Easing.quad) });
  const opacity = Math.min(1, pop * 3) * out;
  const resolve = interpolate(pop, [0, 1], [7, 0]);
  // The offset and the extrusion swing out from under the word as it lands, which is what
  // gives it the snap on the downbeat.
  const depth = (v.depth ?? 0) * k * interpolate(pop, [0, 1], [2.2, 1], clamp);

  // Letters arrive one after another, alternating from above and below, and the fusing
  // pulls them into one body as they settle — the word gathers itself rather than
  // appearing. Transforms on inline-block spans do not reflow, so the line stays where
  // the fit put it however far the letters swing.
  // The word writes itself one syllable at a time, each hit placed against the bar by ear
  // (see SYLLABLES) rather than on an even grid — that is what gives it phrasing instead
  // of a machine spelling the name out. Nothing bounces and nothing drifts: once a letter
  // is up it is still until the card melts away.
  const chars = card.lines.reduce(
    (a, runs) => a + runs.reduce((b, r) => b + r.text.replace(/ /g, "").length, 0),
    0,
  );
  const hits = SYLLABLES[card.id];
  const beatsIn = (n: number) => {
    if (!hits) return Math.floor(n / Math.max(1, Math.ceil(chars / 6))) * 0.5;
    let seen = 0;
    for (const h of hits) {
      seen += h.n;
      if (n < seen) return h.at;
    }
    return hits[hits.length - 1].at;
  };
  const charIn = (n: number) => {
    if (!stepped) return 1;
    const at = beatsIn(n) * BEAT * fps;
    return interpolate(f, [at, at + 3], [0, 1], clamp);
  };

  const text = (color: string, extra: React.CSSProperties) => {
    let n = 0;
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: centreY,
          textAlign: "center",
          whiteSpace: "nowrap",
          fontFamily: v.family,
          fontWeight: v.weight,
          fontSize: size,
          lineHeight: v.lineHeight ?? 1.05,
          letterSpacing: v.track,
          textTransform: "uppercase",
          color,
          ...extra,
        }}
      >
        {card.lines.map((runs, i) => (
          <div key={i}>
            {runs.map((r, j) =>
              !stepped ? (
                <span key={j} style={{ fontSize: r.rel ? size * r.rel : undefined }}>
                  {r.text}
                </span>
              ) : (
                [...r.text].map((ch, c) => {
                  const idx = n++;
                  if (ch === " ") return <span key={`${j}-${c}`}> </span>;
                  const a = charIn(idx);
                  return (
                    <span
                      key={`${j}-${c}`}
                      style={{
                        display: "inline-block",
                        fontSize: r.rel ? size * r.rel : undefined,
                        opacity: a,
                        transform: `scale(${1 + (1 - a) * 0.09})`,
                      }}
                    >
                      {ch}
                    </span>
                  );
                })
              ),
            )}
          </div>
        ))}
      </div>
    );
  };

  const place = (dx: number, dy: number): React.CSSProperties => ({
    transform: `translateY(-50%) translate(${dx}px, ${dy}px) scale(${land}) scaleX(${
      v.scaleX ?? 1
    }) skewX(${v.skew ?? 0}deg)`,
    transformOrigin: "center",
    opacity,
    filter: resolve > 0.05 ? `blur(${resolve}px)` : undefined,
  });

  const stroke = (v.stroke ?? 0) * k;
  const layers: React.ReactNode[] = [];

  // A soft dark bloom under everything: the picture is white in places and no flat
  // treatment survives all of it.
  layers.push(
    <div key="bloom">
      {text("black", { ...place(0, 0), filter: `blur(${11 * k + resolve}px)`, opacity: opacity * 0.6 })}
    </div>,
  );

  if (v.kind === "extrude") {
    for (let i = 8; i >= 1; i--) {
      const d = (depth * i) / 8;
      layers.push(
        <div key={`e${i}`}>{text(i === 8 ? "#000" : "#3a3a3a", place(-d * 0.55, d))}</div>,
      );
    }
  } else if (v.kind === "offset") {
    layers.push(<div key="off">{text("#000", place(depth * 0.45, depth))}</div>);
  }

  if (v.kind === "fuse") {
    const id = `vf-${voice}-${index}`;
    const b = size * (v.blurRel ?? 0.03) * (1 + 0.7 * (1 - pop) + 2.2 * melt);
    layers.push(<Fuse key="f1" id={`${id}-h`} blur={b} dilate={11 * k} soften={12 * k} />);
    layers.push(<Fuse key="f2" id={`${id}-f`} blur={b} />);
    layers.push(
      <div key="halo">
        {text("black", { ...place(0, 0), filter: `url(#${id}-h)`, opacity: opacity * 0.9 })}
      </div>,
    );
    layers.push(
      <div key="face">{text("white", { ...place(0, 0), filter: `url(#${id}-f)` })}</div>,
    );
  } else {
    layers.push(
      <div key="face">
        {text("white", {
          ...place(0, 0),
          WebkitTextStroke: stroke ? `${stroke}px #000` : undefined,
          paintOrder: "stroke fill",
        } as React.CSSProperties)}
      </div>,
    );
  }

  return <AbsoluteFill>{layers}</AbsoluteFill>;
};
