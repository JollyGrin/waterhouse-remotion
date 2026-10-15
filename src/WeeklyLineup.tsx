import React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { loadFont as loadJersey } from "@remotion/google-fonts/Jersey10";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

// Jersey 10 - brand font (pixel/blocky style matching waterhousestudios.nl)
const { fontFamily: brandFont } = loadJersey();
// Space Grotesk - readable body font for details
const { fontFamily: bodyFont } = loadGrotesk("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const ArtistEventSchema = z.object({
  artistName: z.string(),
  artistImage: z.string().nullable(),
  // "contain" letterboxes the image instead of cropping it — use it for logo
  // cards, whose wordmarks get sliced by the default "cover" framing.
  imageFit: z.enum(["cover", "contain"]).nullable().optional(),
  genre: z.string().nullable(),
  instagram: z.string().nullable(),
  website: z.string().nullable(),
  eventDate: z.string(),
  eventTime: z.string(),
  purpose: z.string(),
});

export const WeeklyLineupSchema = z.object({
  weekLabel: z.string(),
  dateRange: z.string(),
  artists: z.array(ArtistEventSchema),
  // Path under public/ (e.g. "audio/song.mp3") or a full URL.
  // When set, the song plays over the video and the outro logo pulses to its beat.
  audioTrack: z.string().nullable().optional(),
  // Seconds into the track to start playback from — use it to skip a quiet
  // intro and land the video on the good part of the song.
  audioStartFrom: z.number().optional(),
});

export type WeeklyLineupProps = z.infer<typeof WeeklyLineupSchema>;

const ARTIST_DURATION = 4 * 30;
const INTRO_DURATION = 3 * 30;
const OUTRO_DURATION = 5 * 30;
const TRANSITION_DURATION = 12;

export function getCompositionDuration(artistCount: number): number {
  const count = Math.max(artistCount, 1);
  const totalSequenceDuration =
    INTRO_DURATION + count * ARTIST_DURATION + OUTRO_DURATION;
  const totalTransitions = count + 1;
  return totalSequenceDuration - totalTransitions * TRANSITION_DURATION;
}

// --- Logo Component ---
const WaterhouseLogo: React.FC<{
  scale?: number;
  opacity?: number;
}> = ({ scale = 1, opacity = 1 }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <Img
        src={staticFile("logo.svg")}
        style={{
          width: 120,
          height: 80,
          filter: "invert(1)",
          marginBottom: 20,
        }}
      />
      <div
        style={{
          fontFamily: brandFont,
          color: "#9146FF",
          fontSize: 48,
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        TWITCH.TV/
      </div>
      <div
        style={{
          fontFamily: brandFont,
          color: "#ffffff",
          fontSize: 72,
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        WATERHOUSE
      </div>
      <div
        style={{
          fontFamily: brandFont,
          fontSize: 72,
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        <span style={{ color: "#ffffff" }}>STUDIOS</span>
        {/* <span style={{ color: "#888888" }}>.NL</span> */}
      </div>
    </div>
  );
};

// --- Intro Card ---
const IntroCard: React.FC<{ weekLabel: string; dateRange: string }> = ({
  weekLabel,
  dateRange,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSpring = spring({ frame, fps, config: { damping: 200 } });
  const weekSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
    delay: 12,
  });
  const dateSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: 20,
  });

  const lineWidth = interpolate(frame, [12, 2 * fps], [0, 500], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "#000000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      {/* Same 2x scale as the outro logo; the transform doesn't take layout
          space, so reserve room for the overflow. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 620,
        }}
      >
        <WaterhouseLogo
          scale={interpolate(logoSpring, [0, 1], [1.7, 2])}
          opacity={logoSpring}
        />
      </div>

      <div
        style={{
          width: lineWidth,
          height: 3,
          background: "#ffffff",
          marginTop: 24,
          marginBottom: 48,
        }}
      />

      <div
        style={{
          fontFamily: brandFont,
          color: "#ffffff",
          fontSize: 240,
          textAlign: "center",
          lineHeight: 1,
          opacity: weekSpring,
          transform: `translateY(${interpolate(weekSpring, [0, 1], [30, 0])}px)`,
        }}
      >
        {weekLabel}
      </div>

      <div
        style={{
          fontFamily: bodyFont,
          color: "#888888",
          fontSize: 44,
          fontWeight: 400,
          marginTop: 20,
          opacity: dateSpring,
          transform: `translateY(${interpolate(dateSpring, [0, 1], [20, 0])}px)`,
        }}
      >
        {dateRange}
      </div>
    </AbsoluteFill>
  );
};

// --- Artist Card ---
const ArtistCard: React.FC<{
  artistName: string;
  artistImage: string | null;
  imageFit?: "cover" | "contain" | null;
  genre: string | null;
  instagram: string | null;
  website: string | null;
  eventDate: string;
  eventTime: string;
  purpose: string;
  index: number;
}> = ({
  artistName,
  artistImage,
  imageFit,
  genre,
  instagram,
  website,
  eventDate,
  eventTime,
  purpose,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enterSpring = spring({ frame, fps, config: { damping: 200 } });
  const nameSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
    delay: 6,
  });
  const detailSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: 14,
  });
  const pillSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 100 },
    delay: 10,
  });

  // Logo cards letterbox and stay under 1x, so the wordmark can never be pushed
  // out of frame by the Ken-Burns zoom; photos keep the original crop-and-push-in.
  const isContain = imageFit === "contain";
  const imageScale = interpolate(
    frame,
    [0, durationInFrames],
    isContain ? [0.74, 0.82] : [1.05, 1.15],
    { extrapolateRight: "clamp" },
  );

  // Monochrome accent rotation - keeps brand feel
  const accents = ["#ffffff", "#cccccc", "#ffffff", "#aaaaaa", "#ffffff"];
  const accent = accents[index % accents.length];

  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      {/* Artist Image */}
      {artistImage ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "72%",
            overflow: "hidden",
            opacity: enterSpring,
          }}
        >
          <Img
            src={artistImage}
            style={{
              width: "100%",
              height: "100%",
              objectFit: isContain ? "contain" : "cover",
              // Sit a contained logo high enough to clear the bottom gradient.
              objectPosition: isContain ? "center 12%" : "center top",
              transform: `scale(${imageScale})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: "50%",
              background:
                "linear-gradient(to top, #000000 0%, #00000088 50%, transparent 100%)",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "72%",
            background: "#111111",
            opacity: enterSpring,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 280,
              color: "#222222",
            }}
          >
            {artistName.charAt(0).toUpperCase()}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: "50%",
              background:
                "linear-gradient(to top, #000000 0%, #00000088 50%, transparent 100%)",
            }}
          />
        </div>
      )}

      {/* Floating date/time pill - top right */}
      <div
        style={{
          position: "absolute",
          top: 160,
          right: 40,
          zIndex: 10,
          opacity: pillSpring,
          transform: `translateX(${interpolate(pillSpring, [0, 1], [30, 0])}px)`,
        }}
      >
        <div
          style={{
            background: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderRadius: 20,
            padding: "20px 32px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div
            style={{
              fontFamily: bodyFont,
              color: "#ffffff",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 1,
              whiteSpace: "nowrap",
            }}
          >
            {eventDate.toUpperCase()}
          </div>
          <div
            style={{
              fontFamily: bodyFont,
              color: "rgba(255, 255, 255, 0.5)",
              fontSize: 30,
              fontWeight: 400,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "rgba(255, 255, 255, 0.35)",
                display: "inline-block",
              }}
            />
            {eventTime}
          </div>
        </div>
      </div>

      {/* Bottom info */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          padding: "0 64px 100px 64px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Accent line */}
        <div
          style={{
            width: interpolate(nameSpring, [0, 1], [0, 100]),
            height: 4,
            backgroundColor: accent,
            marginBottom: 20,
          }}
        />

        {/* Artist name - brand font */}
        <div
          style={{
            fontFamily: brandFont,
            color: "#ffffff",
            fontSize: 96,
            lineHeight: 1,
            opacity: nameSpring,
            transform: `translateY(${interpolate(nameSpring, [0, 1], [40, 0])}px)`,
          }}
        >
          {artistName.toUpperCase()}
        </div>

        {/* Instagram & Website - directly under name */}
        {(instagram || website) && (
          <div
            style={{
              fontFamily: bodyFont,
              display: "flex",
              gap: 24,
              marginTop: 12,
              opacity: nameSpring,
              transform: `translateY(${interpolate(nameSpring, [0, 1], [40, 0])}px)`,
            }}
          >
            {instagram && (
              <div style={{ color: "#aaaaaa", fontSize: 32 }}>@{instagram}</div>
            )}
            {website && (
              <div style={{ color: "#aaaaaa", fontSize: 32 }}>
                {website.replace(/^https?:\/\//, "")}
              </div>
            )}
          </div>
        )}

        {/* Genre tag */}
        {genre && (
          <div
            style={{
              fontFamily: bodyFont,
              marginTop: 16,
              opacity: detailSpring,
              transform: `translateY(${interpolate(detailSpring, [0, 1], [20, 0])}px)`,
            }}
          >
            <span
              style={{
                color: "#888888",
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            >
              {genre}
            </span>
          </div>
        )}

        {/* Event purpose */}
        <div
          style={{
            fontFamily: bodyFont,
            color: "#666666",
            fontSize: 30,
            marginTop: 20,
            opacity: detailSpring,
            transform: `translateY(${interpolate(detailSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          {purpose}
        </div>

      </div>

      {/* Small logo watermark bottom-right */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 40,
          opacity: interpolate(detailSpring, [0, 1], [0, 0.3]),
        }}
      >
        <Img
          src={staticFile("logo.svg")}
          style={{ width: 40, height: 27, filter: "invert(1)" }}
        />
      </div>
    </AbsoluteFill>
  );
};

// --- Beat-reactive logo (outro) ---
// Samples the song's low frequencies at the current frame and maps the
// kick energy onto brightness, glow and a small scale pulse.
const BeatLogo: React.FC<{
  audioSrc: string;
  audioOffsetFrames: number;
  scale: number;
  opacity: number;
}> = ({ audioSrc, audioOffsetFrames, scale, opacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(audioSrc);

  let beat = 0;
  if (audioData) {
    const freq = visualizeAudio({
      audioData,
      frame: frame + audioOffsetFrames,
      fps,
      numberOfSamples: 32,
    });
    // Low bins = kick/bass energy
    const bass = (freq[0] + freq[1] + freq[2] + freq[3]) / 4;
    beat = interpolate(bass, [0.1, 0.5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  return (
    <div
      style={{
        filter: `brightness(${1 + beat * 0.9}) drop-shadow(0 0 ${beat * 45}px rgba(255, 255, 255, ${0.35 + beat * 0.45}))`,
      }}
    >
      <WaterhouseLogo scale={scale * (1 + beat * 0.05)} opacity={opacity} />
    </div>
  );
};

// --- Outro Card ---
const OutroCard: React.FC<{
  audioTrack?: string | null;
  audioOffsetFrames: number;
}> = ({ audioTrack, audioOffsetFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSpring = spring({ frame, fps, config: { damping: 200 } });
  const ctaSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: 12,
  });

  const logoScale = interpolate(logoSpring, [0, 1], [1.7, 2]);

  return (
    <AbsoluteFill
      style={{
        background: "#000000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      {/* The logo is scaled with a transform, which doesn't take layout
          space — reserve room for the 2x overflow so it can't collide
          with the divider and CTA below. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 640,
        }}
      >
        {audioTrack ? (
          <BeatLogo
            audioSrc={resolveAudioSrc(audioTrack)}
            audioOffsetFrames={audioOffsetFrames}
            scale={logoScale}
            opacity={logoSpring}
          />
        ) : (
          <WaterhouseLogo scale={logoScale} opacity={logoSpring} />
        )}
      </div>

      <div
        style={{
          width: 60,
          height: 2,
          background: "#444444",
          marginTop: 56,
          marginBottom: 56,
          opacity: ctaSpring,
        }}
      />

      <div
        style={{
          fontFamily: bodyFont,
          color: "#666666",
          fontSize: 32,
          opacity: ctaSpring,
          transform: `translateY(${interpolate(ctaSpring, [0, 1], [20, 0])}px)`,
        }}
      >
        See you there.
      </div>
    </AbsoluteFill>
  );
};

// Resolve an audioTrack prop to a playable src: full URLs pass through,
// anything else is treated as a path under public/.
function resolveAudioSrc(track: string): string {
  return /^(https?:|data:)/.test(track) ? track : staticFile(track);
}

// --- Main Composition ---
export const WeeklyLineup: React.FC<WeeklyLineupProps> = ({
  weekLabel,
  dateRange,
  artists,
  audioTrack,
  audioStartFrom,
}) => {
  const { fps } = useVideoConfig();
  const totalDuration = getCompositionDuration(artists.length);
  const outroStart = totalDuration - OUTRO_DURATION;
  const trimFrames = Math.round((audioStartFrom ?? 0) * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {audioTrack ? (
        <Audio
          src={resolveAudioSrc(audioTrack)}
          trimBefore={trimFrames}
          volume={(f) =>
            interpolate(
              f,
              [0, 15, totalDuration - 45, totalDuration - 5],
              [0, 1, 1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )
          }
        />
      ) : null}
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={INTRO_DURATION}>
          <IntroCard weekLabel={weekLabel} dateRange={dateRange} />
        </TransitionSeries.Sequence>

        {artists.map((artist, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Transition
              presentation={slide({ direction: "from-right" })}
              timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
            />
            <TransitionSeries.Sequence durationInFrames={ARTIST_DURATION}>
              <ArtistCard
                artistName={artist.artistName}
                artistImage={artist.artistImage}
                imageFit={artist.imageFit}
                genre={artist.genre}
                instagram={artist.instagram}
                website={artist.website}
                eventDate={artist.eventDate}
                eventTime={artist.eventTime}
                purpose={artist.purpose}
                index={i}
              />
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION}>
          <OutroCard
            audioTrack={audioTrack}
            audioOffsetFrames={outroStart + trimFrames}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
