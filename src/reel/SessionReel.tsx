import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import type { CaptionWord } from "../session/Captions";
import { WhMark, MARK_ASPECT } from "../session/WhMark";
import { ReelCaptions } from "./ReelCaptions";
import {
  BUG,
  END_CARD_SECONDS,
  FPS,
  HEIGHT,
  PUSH,
  SHOTS,
  SOURCE,
  WIDTH,
  type ShotName,
} from "./theme";

export type ReelSegment = {
  /** First frame of this segment on the reel timeline. */
  fromFrame: number;
  durationInFrames: number;
  shot: ShotName;
};

export type SessionReelProps = {
  /** The concatenated cut — still 16:9, still the full two-shot. */
  cutSrc: string;
  segments: ReelSegment[];
  /** Word timings already rebased onto the reel timeline. */
  captions: CaptionWord[];
  /** Frames of picture, before the end card. */
  pictureFrames: number;
  artist: string;
  episodeLabel: string;
  cta: string;
};

export const END_CARD_FRAMES = Math.round(END_CARD_SECONDS * FPS);

export const getReelDuration = (pictureFrames: number) =>
  pictureFrames + END_CARD_FRAMES;

/**
 * The crop for a given frame: which window into the source is on screen, and how far
 * through its push it is. Segments are contiguous and cover the whole picture, so the
 * fallback only matters on the very last frame.
 */
const frameCrop = (frame: number, segments: ReelSegment[]) => {
  const segment =
    segments.find(
      (s) => frame >= s.fromFrame && frame < s.fromFrame + s.durationInFrames,
    ) ?? segments[segments.length - 1];

  const shot = SHOTS[segment.shot];
  const progress = interpolate(
    frame,
    [segment.fromFrame, segment.fromFrame + segment.durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Scale so the crop window exactly fills the canvas, then push in a little.
  const scale = (WIDTH / shot.width) * interpolate(progress, [0, 1], [1, PUSH]);

  // Put the centre of the crop window at the centre of the canvas.
  const centreX = shot.x + shot.width / 2;
  const centreY = shot.y + shot.height / 2;

  return {
    width: SOURCE.width * scale,
    height: SOURCE.height * scale,
    left: WIDTH / 2 - centreX * scale,
    top: HEIGHT / 2 - centreY * scale,
  };
};

const EndCard: React.FC<{
  localFrame: number;
  artist: string;
  episodeLabel: string;
  cta: string;
}> = ({ localFrame, artist, episodeLabel, cta }) => {
  const appear = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "black",
        alignItems: "center",
        justifyContent: "center",
        gap: 56,
        opacity: appear,
        fontFamily: "Inter, system-ui, sans-serif",
        color: "white",
        textAlign: "center",
      }}
    >
      <div style={{ width: 420, height: 420 / MARK_ASPECT }}>
        <WhMark />
      </div>
      <div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: "0.22em",
            opacity: 0.75,
          }}
        >
          {episodeLabel}
        </div>
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: "0.02em" }}>
          {artist}
        </div>
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "0.2em",
          opacity: 0.6,
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};

export const SessionReel: React.FC<SessionReelProps> = ({
  cutSrc,
  segments,
  captions,
  pictureFrames,
  artist,
  episodeLabel,
  cta,
}) => {
  const frame = useCurrentFrame();
  const showPicture = frame < pictureFrames;
  const crop = frameCrop(Math.min(frame, pictureFrames - 1), segments);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {showPicture ? (
        <>
          {/* One video element for the whole reel — the cuts are changes of crop, not
              of source, so seeking per segment would only add hitches. */}
          <AbsoluteFill style={{ overflow: "hidden" }}>
            <OffthreadVideo
              src={cutSrc}
              style={{
                position: "absolute",
                width: crop.width,
                height: crop.height,
                left: crop.left,
                top: crop.top,
                maxWidth: "none",
              }}
              volume={(f) =>
                interpolate(f, [pictureFrames - 12, pictureFrames], [1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              }
            />
          </AbsoluteFill>

          {/* A soft floor under the captions so white type never lands on a pale
              wall or a bare leg and disappears. */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0) 52%, rgba(0,0,0,0.55) 68%, rgba(0,0,0,0.75) 100%)",
            }}
          />

          <ReelCaptions words={captions} />

          <div
            style={{
              position: "absolute",
              top: BUG.top,
              left: BUG.left,
              width: BUG.width,
              height: BUG.width / MARK_ASPECT,
              opacity: BUG.opacity,
              filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.6))",
            }}
          >
            <WhMark />
          </div>
        </>
      ) : (
        <EndCard
          localFrame={frame - pictureFrames}
          artist={artist}
          episodeLabel={episodeLabel}
          cta={cta}
        />
      )}
    </AbsoluteFill>
  );
};
