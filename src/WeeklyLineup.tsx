import { z } from "zod";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const ArtistEventSchema = z.object({
  artistName: z.string(),
  artistImage: z.string().nullable(),
  genre: z.string().nullable(),
  eventDate: z.string(),
  eventTime: z.string(),
  purpose: z.string(),
});

export const WeeklyLineupSchema = z.object({
  weekLabel: z.string(),
  dateRange: z.string(),
  artists: z.array(ArtistEventSchema),
});

export type WeeklyLineupProps = z.infer<typeof WeeklyLineupSchema>;

const ARTIST_DURATION = 4 * 30; // 4 seconds at 30fps
const INTRO_DURATION = 3 * 30; // 3 seconds
const OUTRO_DURATION = 2.5 * 30; // 2.5 seconds
const TRANSITION_DURATION = 12; // frames

export function getCompositionDuration(artistCount: number): number {
  const count = Math.max(artistCount, 1);
  const totalSequenceDuration =
    INTRO_DURATION + count * ARTIST_DURATION + OUTRO_DURATION;
  const totalTransitions = count + 1; // intro->artists, between artists, artists->outro
  return totalSequenceDuration - totalTransitions * TRANSITION_DURATION;
}

// --- Intro Card ---
const IntroCard: React.FC<{ weekLabel: string; dateRange: string }> = ({
  weekLabel,
  dateRange,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({ frame, fps, config: { damping: 200 } });
  const dateSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: 8,
  });

  const lineWidth = interpolate(frame, [0, 1.5 * fps], [0, 600], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(160deg, #0a0a0a 0%, #1a1a2e 100%)",
        fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      <div
        style={{
          color: "#e0e0e0",
          fontSize: 32,
          letterSpacing: 12,
          textTransform: "uppercase",
          opacity: interpolate(titleSpring, [0, 1], [0, 0.7]),
          transform: `translateY(${interpolate(titleSpring, [0, 1], [20, 0])}px)`,
          marginBottom: 24,
        }}
      >
        WATERHOUSE STUDIOS
      </div>

      <div
        style={{
          width: lineWidth,
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #ff6b35, transparent)",
          marginBottom: 40,
        }}
      />

      <div
        style={{
          color: "#ffffff",
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -2,
          textAlign: "center",
          lineHeight: 1.1,
          opacity: titleSpring,
          transform: `translateY(${interpolate(titleSpring, [0, 1], [40, 0])}px)`,
        }}
      >
        {weekLabel}
      </div>

      <div
        style={{
          color: "#ff6b35",
          fontSize: 44,
          fontWeight: 700,
          marginTop: 32,
          opacity: dateSpring,
          transform: `translateY(${interpolate(dateSpring, [0, 1], [30, 0])}px)`,
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
  genre: string | null;
  eventDate: string;
  eventTime: string;
  purpose: string;
  index: number;
}> = ({ artistName, artistImage, genre, eventDate, eventTime, purpose, index }) => {
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

  // Subtle zoom on the image
  const imageScale = interpolate(frame, [0, durationInFrames], [1.05, 1.15], {
    extrapolateRight: "clamp",
  });

  // Accent colors that rotate per artist
  const accents = ["#ff6b35", "#00d4aa", "#7c5cfc", "#ff3d7f", "#ffd93d"];
  const accent = accents[index % accents.length];

  return (
    <AbsoluteFill
      style={{
        background: "#0a0a0a",
        fontFamily,
      }}
    >
      {/* Artist Image */}
      {artistImage ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "70%",
            overflow: "hidden",
            opacity: enterSpring,
          }}
        >
          <Img
            src={artistImage}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center top",
              transform: `scale(${imageScale})`,
            }}
          />
          {/* Gradient overlay */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: "60%",
              background:
                "linear-gradient(to top, #0a0a0a 0%, transparent 100%)",
            }}
          />
        </div>
      ) : (
        /* Placeholder when no image */
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "70%",
            background: `linear-gradient(160deg, #1a1a2e 0%, ${accent}33 100%)`,
            opacity: enterSpring,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 200,
              color: accent,
              opacity: 0.3,
              fontWeight: 700,
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
              height: "60%",
              background:
                "linear-gradient(to top, #0a0a0a 0%, transparent 100%)",
            }}
          />
        </div>
      )}

      {/* Bottom info section */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          padding: "0 64px 120px 64px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Accent line */}
        <div
          style={{
            width: interpolate(nameSpring, [0, 1], [0, 120]),
            height: 4,
            backgroundColor: accent,
            marginBottom: 24,
            borderRadius: 2,
          }}
        />

        {/* Artist name */}
        <div
          style={{
            color: "#ffffff",
            fontSize: 80,
            fontWeight: 700,
            lineHeight: 1.1,
            opacity: nameSpring,
            transform: `translateY(${interpolate(nameSpring, [0, 1], [40, 0])}px)`,
          }}
        >
          {artistName}
        </div>

        {/* Genre tag */}
        {genre && (
          <div
            style={{
              marginTop: 16,
              opacity: detailSpring,
              transform: `translateY(${interpolate(detailSpring, [0, 1], [20, 0])}px)`,
            }}
          >
            <span
              style={{
                color: accent,
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
            color: "#b0b0b0",
            fontSize: 30,
            marginTop: 20,
            opacity: detailSpring,
            transform: `translateY(${interpolate(detailSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          {purpose}
        </div>

        {/* Date & Time */}
        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 24,
            opacity: detailSpring,
            transform: `translateY(${interpolate(detailSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          <div
            style={{
              color: "#ffffff",
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            {eventDate}
          </div>
          <div
            style={{
              color: accent,
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            {eventTime}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// --- Outro Card ---
const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSpring = spring({ frame, fps, config: { damping: 200 } });
  const ctaSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: 10,
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(160deg, #0a0a0a 0%, #1a1a2e 100%)",
        fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      <div
        style={{
          color: "#ffffff",
          fontSize: 64,
          fontWeight: 700,
          textAlign: "center",
          opacity: logoSpring,
          transform: `scale(${interpolate(logoSpring, [0, 1], [0.8, 1])})`,
        }}
      >
        WATERHOUSE
      </div>
      <div
        style={{
          color: "#ff6b35",
          fontSize: 28,
          letterSpacing: 10,
          textTransform: "uppercase",
          marginTop: 12,
          opacity: logoSpring,
        }}
      >
        STUDIOS
      </div>

      <div
        style={{
          width: 80,
          height: 2,
          background: "#ff6b35",
          marginTop: 48,
          marginBottom: 48,
          opacity: ctaSpring,
        }}
      />

      <div
        style={{
          color: "#b0b0b0",
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

// --- Main Composition ---
export const WeeklyLineup: React.FC<WeeklyLineupProps> = ({
  weekLabel,
  dateRange,
  artists,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <TransitionSeries>
        {/* Intro */}
        <TransitionSeries.Sequence durationInFrames={INTRO_DURATION}>
          <IntroCard weekLabel={weekLabel} dateRange={dateRange} />
        </TransitionSeries.Sequence>

        {/* Artist cards */}
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
                genre={artist.genre}
                eventDate={artist.eventDate}
                eventTime={artist.eventTime}
                purpose={artist.purpose}
                index={i}
              />
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}

        {/* Outro */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION}>
          <OutroCard />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

// Need React in scope for JSX fragments
import React from "react";
