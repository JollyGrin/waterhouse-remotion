import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Captions, type CaptionWord } from "./Captions";
import { LogoRevealLayers } from "./LogoReveal";
import { AUDIO_FADE_SECONDS, CLOSE, OPEN, TAIL_SECONDS, designToFrames } from "./theme";

/**
 * A full episode built from a raw capture: the cut master, karaoke captions, and the
 * logo reveal at both ends — all in one render.
 *
 * This differs from the SessionOpen / SessionClose bookend clips, which exist for
 * sources that arrive already finished. There the middle never goes through Remotion,
 * because nothing needs compositing onto it. Here the captions have to land on every
 * frame, so a full pass is unavoidable and the bookends may as well ride along rather
 * than being rendered and joined separately.
 */

export type SessionEpisodeProps = {
  masterSrc: string;
  captions: CaptionWord[];
  /** Frames of picture, before the black tail. */
  videoDurationInFrames: number;
};

/** The episode runs at its master's rate, which is not always 60 — see theme.ts. */
export const getEpisodeDuration = (videoDurationInFrames: number, fps: number) =>
  videoDurationInFrames + Math.round(TAIL_SECONDS * fps);

export const SessionEpisode: React.FC<SessionEpisodeProps> = ({
  masterSrc,
  captions,
  videoDurationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const openFrames = designToFrames(OPEN.durationInFrames, fps);
  const closeFrames = designToFrames(CLOSE.durationInFrames, fps);

  // The close runs over the last five seconds of picture: the frame collapses into
  // the mark, which then shines and fades out as the picture ends.
  const closeStart = videoDurationInFrames - closeFrames;
  const showVideo = frame < videoDurationInFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {showVideo ? (
        <>
          <OffthreadVideo
            src={masterSrc}
            // Up under the opening reveal and down under the closing one, so the
            // episode doesn't start and stop at full level against black.
            volume={(f) =>
              Math.min(
                interpolate(f, [0, AUDIO_FADE_SECONDS * fps], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                interpolate(f, [closeStart, videoDurationInFrames], [1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              )
            }
          />
          {/* Under the reveal layers, so the captions are masked along with the
              picture rather than floating over the black card. */}
          <Captions words={captions} />
        </>
      ) : null}

      {frame < openFrames ? (
        <LogoRevealLayers mode="open" localFrame={frame} />
      ) : null}

      {frame >= closeStart && frame < videoDurationInFrames ? (
        <LogoRevealLayers mode="close" localFrame={frame - closeStart} />
      ) : null}
    </AbsoluteFill>
  );
};
