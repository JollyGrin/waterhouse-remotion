import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { loadFont as loadArchivoBlack } from "@remotion/google-fonts/ArchivoBlack";
import {
  CARDS,
  CENTRE_Y,
  DATE,
  FPS,
  FRAMES,
  HEIGHT,
  LOOP_FADE,
  SIGN_OFF,
  WIDTH,
} from "./showcase";
import { VoiceCard } from "./promoVoices";

const archivo = loadArchivoBlack().fontFamily;

/**
 * The date, pinned. It is the one thing the slide has to say whether or not anyone
 * swipes, so it never animates and never leaves: small, wide, and low, under the
 * lettering that does move.
 */
const PinnedDate: React.FC = () => (
  <>
    {[
      { color: "black", blur: 14, opacity: 0.7 },
      { color: "white", blur: 0, opacity: 1 },
    ].map((l) => (
      <div
        key={l.color}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 96,
          textAlign: "center",
          fontFamily: archivo,
          fontSize: 46,
          letterSpacing: "0.22em",
          textIndent: "0.22em",
          color: l.color,
          opacity: l.opacity,
          filter: l.blur ? `blur(${l.blur}px)` : undefined,
        }}
      >
        {DATE}
      </div>
    ))}
  </>
);

const BG = staticFile("fort-riddim/promo.mp4");
const cover = { width: WIDTH, height: HEIGHT, objectFit: "cover" } as const;

/**
 * The disc does not loop on its own — its last frame is nothing like its first — so the
 * picture is dissolved back onto its own opening over the last LOOP_FADE frames. The main
 * copy therefore starts LOOP_FADE frames in, so that what the dissolve arrives at is
 * exactly what frame 0 shows. On a swirl this reads as nothing at all; a hard cut back
 * reads as a jolt every time round.
 */
const LoopTail: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <OffthreadVideo
      src={BG}
      muted
      style={{
        ...cover,
        position: "absolute",
        opacity: interpolate(f, [0, LOOP_FADE - 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    />
  );
};

const Background: React.FC = () => (
  <>
    <OffthreadVideo src={BG} muted trimBefore={LOOP_FADE} style={cover} />
    <Sequence from={FRAMES - LOOP_FADE} name="loop">
      <LoopTail />
    </Sequence>
  </>
);

export const FortRiddimShowcase: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    <Background />
    {CARDS.map((card, i) => (
      <Sequence
        key={card.id}
        from={Math.round(card.start * FPS)}
        // The sign-off runs to the last frame of the composition; rounding its own end
        // left the final frames empty.
        durationInFrames={
          (i === CARDS.length - 1 ? FRAMES : Math.round(card.end * FPS)) -
          Math.round(card.start * FPS)
        }
        name={card.id}
      >
        <VoiceCard
          card={card}
          voice="weld"
          index={i}
          centreY={CENTRE_Y}
          hold={card.id === SIGN_OFF}
        />
      </Sequence>
    ))}
    <PinnedDate />
  </AbsoluteFill>
);
