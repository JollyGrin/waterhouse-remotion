import React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadJersey } from "@remotion/google-fonts/Jersey10";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

// Same brand pairing as WeeklyLineup: Jersey 10 headlines, Space Grotesk body.
const { fontFamily: brandFont } = loadJersey();
const { fontFamily: bodyFont } = loadGrotesk("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const AvatarSchema = z.object({
  label: z.string(),
  image: z.string().nullable(),
});

const ChatLineSchema = z.object({
  name: z.string(),
  text: z.string(),
});

export const PullUpSchema = z.object({
  artistName: z.string(),
  artistImage: z.string().nullable(),
  genre: z.string().nullable(),
  eventDay: z.string(),
  eventTime: z.string(),
  eventDate: z.string(),
  avatars: z.array(AvatarSchema),
  chatLines: z.array(ChatLineSchema),
  seed: z.number().optional(),
});

export type PullUpProps = z.infer<typeof PullUpSchema>;

// --- Timing (30fps, 300 frames = 10s, seamless loop) ---
export const PULLUP_DURATION = 300;

const FRIENDS = 6; // avatar circles from props, plus the trailing "YOU?" circle
const CIRCLES = FRIENDS + 1;

const AV_IN_START = 45; // 1.5s
const AV_IN_STAGGER = 12; // 0.4s apart -> last lands at frame 117 (3.9s)
const CHAT_IN_START = 135; // 4.5s
const CHAT_IN_STAGGER = 15;
const ASK_START = 195; // 6.5s
const SEAM_START = 268; // ~9.0s
const AV_OUT_STAGGER = 3; // reverse order pop-out
const AV_OUT_DURATION = 10;

// Accent variants, picked deterministically from `seed`.
const ACCENTS = ["#9146FF", "#FF5C3B", "#3BE3FF", "#C6FF4A"];
// Stand-ins when fewer than six roster avatars are available.
const FALLBACK_LABELS = ["JV", "SR", "KL", "MB", "TN", "AD"];
// Palette used for initial-only avatars.
const AVATAR_COLORS = [
  "#9146FF",
  "#FF5C3B",
  "#3BE3FF",
  "#C6FF4A",
  "#FF7BD5",
  "#FFD24A",
];

const avatarInFrame = (i: number) => AV_IN_START + i * AV_IN_STAGGER;
// Last circle leaves first, so the room empties the way it filled.
const avatarOutFrame = (i: number) =>
  SEAM_START + (CIRCLES - 1 - i) * AV_OUT_STAGGER;

// --- Twitch-style viewer counter ---
const ViewerCounter: React.FC<{ count: number }> = ({ count }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(0, 0, 0, 0.6)",
        borderRadius: 12,
        padding: "10px 18px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
      }}
    >
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none">
        <path
          d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"
          stroke="#E91916"
          strokeWidth={2}
        />
        <circle cx={12} cy={12} r={3.2} fill="#E91916" />
      </svg>
      <span
        style={{
          fontFamily: bodyFont,
          fontWeight: 700,
          fontSize: 32,
          color: "#ffffff",
          minWidth: 24,
          textAlign: "right",
        }}
      >
        {count}
      </span>
    </div>
  );
};

// --- Player frame: artist alone in the stream window ---
const PlayerFrame: React.FC<{
  artistName: string;
  artistImage: string | null;
  viewers: number;
}> = ({ artistName, artistImage, viewers }) => {
  const frame = useCurrentFrame();

  // Periodic over the full 300 frames, so the seam is continuous.
  const breathe =
    1.02 + 0.02 * Math.sin((2 * Math.PI * frame) / PULLUP_DURATION);
  const liveDot = 0.55 + 0.45 * Math.sin((2 * Math.PI * frame) / 60);

  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: 90,
        width: 900,
        height: 700,
        borderRadius: 28,
        overflow: "hidden",
        border: "2px solid rgba(255, 255, 255, 0.14)",
        background: "#0b0b0b",
      }}
    >
      {artistImage ? (
        <Img
          src={artistImage}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
            transform: `scale(${breathe})`,
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#111111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 420,
              lineHeight: 1,
              color: "#222222",
              transform: `scale(${breathe})`,
            }}
          >
            {artistName.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Bottom vignette so the frame edge reads on any photo */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: "35%",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
        }}
      />

      {/* LIVE pill - top left */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 26,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#E91916",
          borderRadius: 10,
          padding: "8px 18px",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#ffffff",
            opacity: liveDot,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: bodyFont,
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: 3,
            color: "#ffffff",
          }}
        >
          LIVE
        </span>
      </div>

      {/* Viewer counter - top right */}
      <div style={{ position: "absolute", top: 26, right: 26 }}>
        <ViewerCounter count={viewers} />
      </div>
    </div>
  );
};

// --- One avatar circle in the "room" row ---
const AvatarCircle: React.FC<{
  index: number;
  label: string;
  image: string | null;
  isYou: boolean;
  accent: string;
}> = ({ index, label, image, isYou, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inAt = avatarInFrame(index);
  const outAt = avatarOutFrame(index);

  const enter = spring({
    frame,
    fps,
    delay: inAt,
    config: { damping: 12, stiffness: 140, mass: 0.6 },
  });
  const exit = interpolate(frame, [outAt, outAt + AV_OUT_DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = enter * exit;

  // The "YOU?" circle pulses once shortly after it lands.
  const pulse = isYou
    ? interpolate(frame, [inAt + 20, inAt + 30, inAt + 44], [1, 1.16, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const color = isYou ? accent : AVATAR_COLORS[index % AVATAR_COLORS.length];

  // The slot always reserves its space so the row never reflows mid-arrival.
  return (
    <div
      style={{
        width: 108,
        height: 108,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 108,
          height: 108,
          borderRadius: "50%",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isYou ? "transparent" : "#141414",
          border: isYou ? `4px dashed ${color}` : `3px solid ${color}`,
          transform: `scale(${scale * pulse})`,
          opacity: Math.min(scale, 1),
        }}
      >
        {image && !isYou ? (
          <Img
            src={image}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span
            style={{
              fontFamily: brandFont,
              fontSize: isYou ? 52 : 58,
              lineHeight: 1,
              color: isYou ? color : "#ffffff",
            }}
          >
            {isYou ? "YOU?" : label.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
};

// --- Chat bubble ---
const ChatBubble: React.FC<{
  index: number;
  name: string;
  text: string;
  accent: string;
}> = ({ index, name, text, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inAt = CHAT_IN_START + index * CHAT_IN_STAGGER;
  const enter = spring({
    frame,
    fps,
    delay: inAt,
    config: { damping: 16, stiffness: 110, mass: 0.7 },
  });
  const exit = interpolate(frame, [SEAM_START, SEAM_START + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = enter * exit;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        alignSelf: "flex-start",
        background: "rgba(255, 255, 255, 0.06)",
        border: "1px solid rgba(255, 255, 255, 0.09)",
        borderRadius: 20,
        padding: "16px 28px",
        opacity,
        transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px)`,
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: AVATAR_COLORS[(index + 2) % AVATAR_COLORS.length],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: brandFont,
          fontSize: 30,
          color: "#000000",
          flexShrink: 0,
        }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span
        style={{
          fontFamily: bodyFont,
          fontWeight: 700,
          fontSize: 32,
          color: accent,
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: bodyFont,
          fontSize: 32,
          color: "#eeeeee",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
};

// --- The ask ---
const AskBlock: React.FC<{
  artistName: string;
  eventDay: string;
  eventTime: string;
  accent: string;
}> = ({ artistName, eventDay, eventTime, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headline = spring({
    frame,
    fps,
    delay: ASK_START,
    config: { damping: 15, stiffness: 80 },
  });
  const sub = spring({
    frame,
    fps,
    delay: ASK_START + 10,
    config: { damping: 200 },
  });
  const details = spring({
    frame,
    fps,
    delay: ASK_START + 20,
    config: { damping: 200 },
  });
  const exit = interpolate(frame, [SEAM_START, SEAM_START + 20], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 1120,
        left: 70,
        width: 940,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: exit,
      }}
    >
      <div
        style={{
          width: interpolate(headline, [0, 1], [0, 120]),
          height: 4,
          background: accent,
          marginBottom: 24,
        }}
      />

      <div
        style={{
          fontFamily: brandFont,
          fontSize: 128,
          lineHeight: 0.92,
          color: "#ffffff",
          textAlign: "center",
          opacity: headline,
          transform: `translateY(${interpolate(headline, [0, 1], [40, 0])}px)`,
        }}
      >
        COME HANG FOR A BIT.
      </div>

      <div
        style={{
          fontFamily: bodyFont,
          fontSize: 38,
          color: "#8a8a8a",
          textAlign: "center",
          marginTop: 18,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [20, 0])}px)`,
        }}
      >
        muted is fine. stay if it&apos;s good.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginTop: 34,
          opacity: details,
          transform: `translateY(${interpolate(details, [0, 1], [20, 0])}px)`,
        }}
      >
        <span
          style={{
            fontFamily: brandFont,
            fontSize: 64,
            lineHeight: 1,
            color: "#ffffff",
          }}
        >
          {artistName.toUpperCase()}
        </span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#555555",
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: bodyFont,
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: 2,
            color: "#8a8a8a",
          }}
        >
          {eventDay.toUpperCase()} {eventTime}
        </span>
      </div>

      <div
        style={{
          fontFamily: brandFont,
          fontSize: 56,
          lineHeight: 1,
          marginTop: 22,
          opacity: details,
        }}
      >
        <span style={{ color: "#9146FF" }}>TWITCH.TV/</span>
        <span style={{ color: "#ffffff" }}>WATERHOUSESTUDIOS</span>
      </div>
    </div>
  );
};

// --- Main composition ---
export const PullUp: React.FC<PullUpProps> = ({
  artistName,
  artistImage,
  genre,
  eventDay,
  eventTime,
  avatars,
  chatLines,
  seed = 0,
}) => {
  const frame = useCurrentFrame();

  const accent = ACCENTS[Math.abs(Math.round(seed)) % ACCENTS.length];

  // Pad/trim to exactly FRIENDS entries so the row and counter stay in sync.
  const friends: Array<{ label: string; image: string | null }> = [];
  for (let i = 0; i < FRIENDS; i++) {
    const a = avatars[i];
    friends.push(a ? a : { label: FALLBACK_LABELS[i], image: null });
  }

  // Viewer count = circles currently in the room. A leaving circle stops
  // counting halfway through its pop-out, so the number tracks what you see.
  let viewers = 0;
  for (let i = 0; i < CIRCLES; i++) {
    const leftAt = avatarOutFrame(i) + AV_OUT_DURATION / 2;
    if (frame >= avatarInFrame(i) && frame < leftAt) {
      viewers++;
    }
  }

  const caption = genre
    ? `${eventDay.toUpperCase()} ${eventTime} · ${genre.toUpperCase()}`
    : `${eventDay.toUpperCase()} ${eventTime}`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <PlayerFrame
        artistName={artistName}
        artistImage={artistImage}
        viewers={viewers}
      />

      {/* Caption under the player */}
      <div
        style={{
          position: "absolute",
          top: 852,
          left: 90,
          width: 900,
          textAlign: "center",
          fontFamily: bodyFont,
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: 5,
          color: "#8a8a8a",
        }}
      >
        {caption}
      </div>

      {/* The room fills up */}
      <div
        style={{
          position: "absolute",
          top: 940,
          left: 70,
          width: 940,
          height: 116,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
        }}
      >
        {friends.map((a, i) => (
          <AvatarCircle
            key={i}
            index={i}
            label={a.label}
            image={a.image}
            isYou={false}
            accent={accent}
          />
        ))}
        <AvatarCircle
          index={FRIENDS}
          label="YOU?"
          image={null}
          isYou
          accent={accent}
        />
      </div>

      <AskBlock
        artistName={artistName}
        eventDay={eventDay}
        eventTime={eventTime}
        accent={accent}
      />

      {/* Logo watermark - constant, so it never disturbs the loop seam */}
      <div
        style={{ position: "absolute", bottom: 30, right: 56, opacity: 0.38 }}
      >
        <Img
          src={staticFile("logo.svg")}
          style={{ width: 76, height: 52, filter: "invert(1)" }}
        />
      </div>

      {/* Chat wakes up */}
      <div
        style={{
          position: "absolute",
          bottom: 76,
          left: 70,
          width: 940,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        {chatLines.slice(0, 3).map((c, i) => (
          <ChatBubble
            key={i}
            index={i}
            name={c.name}
            text={c.text}
            accent={accent}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
