import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadBarlow } from "@remotion/google-fonts/Barlow";
import {
  BEAT,
  BOOGIE_TAG,
  CAPTIONS,
  END_T,
  FPS,
  PICTURE_FRAMES,
  PLACED,
  SLAMS,
  beatPhase,
  nextBeat,
  sourceTime,
  styleOf,
  type Caption,
  type PlacedSegment,
  type Slam,
} from "./edit";

/**
 * FORT RIDDIM promo reel. A dancer looking for the party, and the party is ours.
 *
 * Everything typographic comes from the event poster, so the reel and the poster read
 * as one campaign: the liquid RIDDIM disc, the lineup lettering and the DIN-style info
 * line are cut straight out of the poster artwork (public/fort-riddim/poster/*.png,
 * white on alpha), and everything set in type — captions and 10·10·10 alike — is Barlow
 * caps on wide tracking, the nearest free match for the poster's DIN. 10·10·10 was drawn
 * in melted bubble lettering first, on the theory that it should echo the poster's title;
 * next to the captions it just read as a second typeface, so it is now the caption voice
 * at three times the size.
 *
 * Picture: every segment plays from a fisheye copy of its clip. The "live" look is the
 * mild one with a slow push, "rush" the strong one with sway and a kick on each beat;
 * speed picks between them unless a segment says otherwise. The sound
 * is built outside Remotion (scripts/fort-riddim/make.ts) and muxed on afterwards; it is
 * only referenced here so the Studio preview has sound.
 */

const { fontFamily: barlow } = loadBarlow("normal", { weights: ["500", "600"], subsets: ["latin"] });

const poster = (name: string) => staticFile(`fort-riddim/poster/${name}.png`);

/** Frames an entry or exit effect spans, by kind. */
const ENTER_FRAMES = { cut: 0, punch: 5, whip: 7, door: 10 } as const;
const EXIT_FRAMES = { cut: 0, punch: 0, whip: 6, door: 8 } as const;

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * A moving liquid distortion: fractal noise drives a displacement map, and drifting
 * the noise frequency frame by frame makes the edges crawl like the poster's lettering.
 */
const Liquid: React.FC<{ id: string; t: number; scale: number }> = ({ id, t, scale }) => (
  <svg style={{ position: "absolute", width: 0, height: 0 }}>
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency={0.011 + 0.003 * Math.sin(t * 2.1)}
        numOctaves={2}
        seed={4}
      />
      <feDisplacementMap in="SourceGraphic" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

const SegmentView: React.FC<{ s: PlacedSegment; next?: PlacedSegment }> = ({ s, next }) => {
  const f = useCurrentFrame();
  const t = (s.start + f) / FPS;
  const rush = styleOf(s) === "rush";
  const src = `fort-riddim/${s.clip}${rush ? "fx" : "m"}.mp4`;
  const srcFrame = Math.round(sourceTime(s, f) * FPS);

  // The slow push keeps a held talking shot alive; a moving shot does not need it, and
  // walkIn must not have one or it would arrive 3.5% larger than the tattoo shot it runs
  // straight into.
  let scale = rush ? 1.06 : 1 + (s.speed === 1 ? 0.035 : 0) * (f / s.frames);
  let blur = 0;
  let shiftY = 0;
  let bright = 1;
  let rotate = 0;

  if (rush || s.id === "boogie") {
    // Kick on the beat: a quick push that decays inside a sixteenth.
    scale += (rush ? 0.035 : 0.02) * Math.exp(-beatPhase(t) * 14);
  }
  if (rush) rotate = Math.sin((s.start + f) / 9) * 1.3;

  const inN = ENTER_FRAMES[s.enter];
  if (f < inN) {
    const k = ease(f / inN); // 0 -> 1
    if (s.enter === "whip") {
      blur += 28 * (1 - k);
      scale *= 1 + 0.3 * (1 - k);
      shiftY -= 16 * (1 - k);
    } else if (s.enter === "punch") {
      scale *= 1 + 0.14 * (1 - k);
      bright += 0.4 * (1 - k);
    } else if (s.enter === "door") {
      scale *= 1 + 0.45 * (1 - k);
      blur += 12 * (1 - k);
    }
  }

  const outN = next ? EXIT_FRAMES[next.enter] : 0;
  const fromEnd = s.frames - 1 - f;
  if (outN && fromEnd < outN) {
    const k = Easing.in(Easing.cubic)(1 - fromEnd / outN); // 0 -> 1
    if (next!.enter === "whip") {
      blur += 28 * k;
      scale *= 1 + 0.25 * k;
      shiftY += 16 * k;
    } else if (next!.enter === "door") {
      scale *= 1 + 0.35 * k;
      blur += 8 * k;
    }
  }

  const flash = s.enter === "whip" || s.enter === "punch"
    ? interpolate(f, [0, 3], [s.enter === "whip" ? 0.4 : 0.2, 0], clamp)
    : 0;

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      <AbsoluteFill
        style={{
          transform: `translateY(${shiftY}%) scale(${scale}) rotate(${rotate}deg)`,
          filter: [
            rush ? "" : "contrast(1.06) saturate(1.1)",
            blur > 0.1 ? `blur(${blur}px)` : "",
            bright !== 1 ? `brightness(${bright})` : "",
          ].join(" ").trim() || undefined,
        }}
      >
        {/* Time remap: offset a sequence so the video's own clock reads srcFrame. */}
        <Sequence from={f - srcFrame} layout="none">
          <OffthreadVideo
            src={staticFile(src)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Sequence>
      </AbsoluteFill>
      {flash > 0 && <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} />}
    </AbsoluteFill>
  );
};

/** One phrase, in the poster's small-type voice: DIN-ish caps, wide tracking. */
const CaptionView: React.FC<{ c: Caption }> = ({ c }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = (c.end - c.t) * fps;
  const inK = interpolate(f, [0, 4], [0, 1], clamp);
  const out = interpolate(f, [len - 3, len], [1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 90,
        right: 90,
        top: 1330,
        transform: `translateY(calc(-50% + ${(1 - inK) * 14}px))`,
        opacity: inK * out,
        filter: inK < 1 ? `blur(${(1 - inK) * 6}px)` : undefined,
        textAlign: "center",
        fontFamily: barlow,
        fontWeight: 600,
        fontSize: 46,
        lineHeight: 1.3,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "white",
        textShadow: "0 2px 3px rgba(0,0,0,0.8), 0 0 28px rgba(0,0,0,0.65)",
      }}
    >
      {c.text}
    </div>
  );
};

/**
 * The password, in the caption voice at three times the size: same Barlow caps, same
 * tracking, so it reads as the reel's own lettering rather than a title card dropped in
 * from somewhere else. It lands slightly large and tight and opens out; textIndent cancels
 * the trailing letter-space so it stays optically centred while it does. Opening from wide
 * to narrow instead clipped both ends on the first frames.
 */
const TripleTen: React.FC<{ slam: Slam }> = ({ slam }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 14, stiffness: 190, mass: 0.6 } });
  const out = interpolate(f, [slam.d * fps - 6, slam.d * fps], [1, 0], clamp);
  const track = interpolate(pop, [0, 1], [0.1, 0.18]);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 300,
        transform: `translateY(-50%) scale(${interpolate(pop, [0, 1], [1.12, 1])})`,
        opacity: Math.min(1, pop * 3) * out,
        textAlign: "center",
        fontFamily: barlow,
        fontWeight: 600,
        fontSize: 160,
        letterSpacing: `${track}em`,
        textIndent: `${track}em`,
        color: "white",
        filter: `blur(${interpolate(pop, [0, 1], [9, 0])}px)`,
        textShadow: "0 3px 6px rgba(0,0,0,0.85), 0 0 46px rgba(0,0,0,0.6)",
      }}
    >
      10·10·10
    </div>
  );
};

const fadeInOut = (f: number, fps: number, d: number) =>
  interpolate(f, [0, 8, d * fps - 8, d * fps], [0, 1, 1, 0], clamp);

const BoogieTag: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const x = interpolate(spring({ frame: f, fps, config: { damping: 14 } }), [0, 1], [-460, 0]);
  return (
    <div
      style={{
        position: "absolute",
        top: 250,
        left: 72,
        transform: `translateX(${x}px)`,
        opacity: fadeInOut(f, fps, BOOGIE_TAG.d),
        filter: "drop-shadow(0 3px 14px rgba(0,0,0,0.7))",
      }}
    >
      <div
        style={{
          fontFamily: barlow,
          fontWeight: 500,
          fontSize: 30,
          letterSpacing: "0.3em",
          color: "white",
          marginBottom: 10,
        }}
      >
        ON THE DECKS
      </div>
      <Img src={poster("boogie")} style={{ width: 420, display: "block" }} />
    </div>
  );
};

/** A poster piece that arrives on a given beat of the end card. */
const Piece: React.FC<{
  src: string;
  beat: number;
  first: number;
  width: number;
  centreY: number;
  melt?: boolean;
}> = ({ src, beat, first, width, centreY, melt }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = f - Math.round((first + beat * BEAT) * fps);
  if (local < 0) return null;
  const s = spring({ frame: local, fps, config: { damping: 14, stiffness: 200, mass: 0.7 } });
  const id = `piece-${beat}`;
  const meltScale = interpolate(local, [0, 14], [110, 6], { ...clamp, easing: Easing.out(Easing.cubic) });
  const blur = interpolate(s, [0, 1], [8, 0]);
  return (
    <>
      {melt && <Liquid id={id} t={f / fps} scale={meltScale} />}
      <Img
        src={src}
        style={{
          position: "absolute",
          width,
          left: (1080 - width) / 2,
          top: centreY,
          transform: `translateY(-50%) scale(${interpolate(s, [0, 1], [melt ? 0.7 : 1.08, 1])})`,
          opacity: Math.min(1, s * 2.5),
          filter: melt ? `url(#${id})` : blur > 0.2 ? `blur(${blur}px)` : undefined,
        }}
      />
    </>
  );
};

/**
 * The poster, rebuilt for 9:16 and assembled on the beat: disc, title, lineup, date
 * line, then the Waterhouse mark. Everything sits above y1500, clear of Instagram's
 * caption block.
 */
const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const first = nextBeat(END_T) - END_T;
  const t = END_T + f / fps;
  const pulse = 1 + 0.012 * Math.exp(-beatPhase(t) * 12);
  const fadeOut = interpolate(f, [durationInFrames - 12, durationInFrames], [1, 0], clamp);
  const flash = interpolate(f, [0, 4], [0.35, 0], clamp);
  const logoIn = spring({ frame: f - Math.round((first + 4 * BEAT) * fps), fps, config: { damping: 16 } });

  return (
    <AbsoluteFill style={{ backgroundColor: "black", opacity: fadeOut }}>
      <AbsoluteFill style={{ transform: `scale(${pulse})` }}>
        <AbsoluteFill style={{ transform: `rotate(${Math.sin(f / 40) * 1.5}deg)`, transformOrigin: "50% 42%" }}>
          <Piece src={poster("disc")} beat={0} first={first} width={740} centreY={800} melt />
        </AbsoluteFill>
        <Piece src={poster("top")} beat={1} first={first} width={600} centreY={370} />
        <Piece src={poster("lineup")} beat={2} first={first} width={600} centreY={1265} />
        <Piece src={poster("info")} beat={3} first={first} width={1000} centreY={1458} />
        <Img
          src={staticFile("fort-riddim/logo-white.png")}
          style={{
            position: "absolute",
            width: 150,
            left: (1080 - 150) / 2,
            top: 120,
            opacity: Math.max(0, logoIn),
            transform: `translateY(${(1 - logoIn) * -20}px)`,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} />
    </AbsoluteFill>
  );
};

export const FortRiddim: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {PLACED.map((s, i) => (
        <Sequence key={s.id} from={s.start} durationInFrames={s.frames} name={s.id}>
          <SegmentView s={s} next={PLACED[i + 1]} />
        </Sequence>
      ))}

      {CAPTIONS.map((c) => (
        <Sequence key={c.t} from={Math.round(c.t * fps)} durationInFrames={Math.max(1, Math.round((c.end - c.t) * fps))}>
          <CaptionView c={c} />
        </Sequence>
      ))}
      {SLAMS.map((slam) => (
        <Sequence key={slam.t} from={Math.round(slam.t * fps)} durationInFrames={Math.round(slam.d * fps)}>
          <TripleTen slam={slam} />
        </Sequence>
      ))}
      <Sequence from={Math.round(BOOGIE_TAG.t * fps)} durationInFrames={Math.round(BOOGIE_TAG.d * fps)}>
        <BoogieTag />
      </Sequence>

      <Sequence from={PICTURE_FRAMES} durationInFrames={durationInFrames - PICTURE_FRAMES} name="endCard">
        <EndCard />
      </Sequence>

      <Audio src={staticFile("fort-riddim/soundtrack.wav")} />
    </AbsoluteFill>
  );
};
