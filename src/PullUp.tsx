import React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadJersey } from "@remotion/google-fonts/Jersey10";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { initials } from "./pullup/plan";
import { PLAYER_FRAME, type Framing } from "./pullup/framing";

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

// A shared booking - two or more artists on one night - gets one clip led by
// the event title, with everybody on the bill in the player frame. Absent or
// shorter than two entries, the clip is the plain single-artist one.
// How a photo hangs in its window. Worked out per image in the render
// script's preflight from the detected face box - see src/pullup/framing.ts.
// Absent means the historic `cover` / `center top`.
const FramingSchema = z.object({
  fit: z.enum(["cover", "contain"]),
  position: z.string(),
});

const PerformerSchema = z.object({
  name: z.string(),
  image: z.string().nullable(),
  framing: FramingSchema.optional(),
});

export type Performer = z.infer<typeof PerformerSchema>;

export const PullUpSchema = z.object({
  artistName: z.string(),
  artistImage: z.string().nullable(),
  genre: z.string().nullable(),
  eventDay: z.string(),
  eventTime: z.string(),
  eventDate: z.string(),
  avatars: z.array(AvatarSchema),
  chatLines: z.array(ChatLineSchema),
  artistFraming: FramingSchema.optional(),
  // Set only for a shared booking; `artistName` is then the event title.
  performers: z.array(PerformerSchema).optional(),
  seed: z.number().optional(),
  // Audio only - selects which bed texture plays, default "b". No visual
  // effect whatsoever.
  bedVariant: z.enum(["base", "a", "b", "c"]).optional(),
});

export type PullUpProps = z.infer<typeof PullUpSchema>;

// --- Timing (30fps, 300 frames = 10s, seamless loop) ---
//
// The headline and the ask are on screen and at rest at frame 0 and never
// leave, so the loop always restarts on the call to action. Their "slam" is
// an impact punch that starts and ends at rest, which means it re-fires on
// every loop instead of breaking the seam. Only the room - the avatar row,
// the chat and the counter - fills up and resets.
export const PULLUP_DURATION = 300;

const FRIENDS = 6; // roster avatars; the leading "YOU" circle is composition-owned
const CIRCLES = FRIENDS + 1;

const HEADLINE_PUNCH_END = 30; // 0 - 1.0s
const ASK_PUNCH_START = 30; // 1.0 - 2.2s
const ASK_PUNCH_END = 66;
const YOU_IN = 75; // 2.5s - you are the first one in the room
const FRIENDS_IN_START = 150; // 5.0s - only after your message lands
const FRIENDS_IN_STAGGER = 12; // last friend lands at frame 210 (7.0s)
// Your bubble goes up alone at 3.5s; the other two trail the arriving friends.
const CHAT_IN_FRAMES = [105, 180, 210];
const SEAM_START = 276; // 9.2s
const AV_OUT_STAGGER = 2; // reverse order: last friend leaves first, YOU last
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

// Slot 0 is YOU, slots 1..6 are the roster.
const avatarInFrame = (slot: number) =>
  slot === 0 ? YOU_IN : FRIENDS_IN_START + (slot - 1) * FRIENDS_IN_STAGGER;
const avatarOutFrame = (slot: number) =>
  SEAM_START + (CIRCLES - 1 - slot) * AV_OUT_STAGGER;
const chatInFrame = (index: number) =>
  CHAT_IN_FRAMES[index] ?? CHAT_IN_FRAMES[CHAT_IN_FRAMES.length - 1];

// Jersey 10 caps run about 0.40em wide. Shrink long headlines rather than
// letting them wrap or clip - artist names vary a lot in length.
function fitBrandSize(text: string, maxWidth: number, cap: number): number {
  if (text.length === 0) return cap;
  return Math.min(cap, maxWidth / (text.length * 0.4));
}

// Space Grotesk bold runs about 0.6em wide, plus the caption's 5px tracking.
// Three names on one bill would otherwise run past the 940px column.
function fitCaptionSize(text: string, maxWidth: number, cap: number): number {
  if (text.length === 0) return cap;
  return Math.min(cap, (maxWidth / text.length - 5) / 0.6);
}

// An impact: at rest, hit, overshoot, settle back to rest. Zero deviation at
// both ends, so it is safe to run across the loop seam.
function punch(frame: number, start: number, end: number, amount: number) {
  const span = end - start;
  return interpolate(
    frame,
    [start, start + span * 0.16, start + span * 0.45, end],
    [1, 1 + amount, 1 - amount * 0.22, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

// --- Photos that are allowed to fail ---
//
// Roster photos point wherever an artist last uploaded one, and some hosts
// answer a plain fetch while blocking the request Chromium makes during a
// render (imgproxy.ra.co behind Cloudflare is the one that bit us). A bare
// <Img> calls that fatal and kills the whole render, so every remote photo
// goes through here instead: the initials fallback is painted underneath,
// and the first load error drops the <img> for good. Unmounting it also
// releases the delayRender() handle the image was holding, so the frame
// continues rather than timing out.
//
// Failures are remembered per src for the life of the page, so a remount
// does not walk the retry ladder again.
const failedSrcs = new Set<string>();

const SafeImg: React.FC<{
  src: string;
  style: React.CSSProperties;
  fallback: React.ReactNode;
}> = ({ src, style, fallback }) => {
  const [failed, setFailed] = React.useState(() => failedSrcs.has(src));

  const onError = React.useCallback(() => {
    failedSrcs.add(src);
    setFailed(true);
  }, [src]);

  return (
    <>
      {fallback}
      {failed ? null : (
        <Img
          src={src}
          // Report the first error instead of retrying twice with backoff:
          // a host that blocks Chromium will not answer the retries either,
          // and each one holds the frame open for seconds.
          maxRetries={0}
          onError={onError}
          style={{ position: "absolute", inset: 0, ...style }}
        />
      )}
    </>
  );
};

// A photo hung in its window the way the preflight worked out: normally a
// `cover` crop slid onto the face, and for a headshot too tight to crop, the
// whole photo `contain`ed over a blurred, darkened copy of itself.
const Photo: React.FC<{
  src: string;
  framing: Framing | null | undefined;
  breathe: number;
  fallback: React.ReactNode;
}> = ({ src, framing, breathe, fallback }) => {
  const position = framing?.position ?? "center top";

  if (framing?.fit === "contain") {
    return (
      <>
        {fallback}
        {/* The backdrop does the breathing, so the photo itself never moves
            and nothing can drift out of frame. */}
        <SafeImg
          src={src}
          fallback={null}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            filter: "blur(30px) brightness(0.4) saturate(0.85)",
            transform: `scale(${1.2 * breathe})`,
          }}
        />
        <SafeImg
          src={src}
          fallback={null}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: position,
          }}
        />
      </>
    );
  }

  return (
    <SafeImg
      src={src}
      fallback={fallback}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: position,
        transform: `scale(${breathe})`,
      }}
    />
  );
};

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

// --- Player frame ---

// The big washed-out letter behind a missing or unreachable photo.
const PhotoFallback: React.FC<{
  label: string;
  size: number;
  scale: number;
}> = ({ label, size, scale }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: "#111111",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        fontFamily: brandFont,
        fontSize: size,
        lineHeight: 1,
        color: "#222222",
        transform: `scale(${scale})`,
      }}
    >
      {label}
    </div>
  </div>
);

// Bottom-up fade, so a name reads over any photo.
const Vignette: React.FC = () => (
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
);

// One half of a two-artist bill: their photo, their name across the bottom.
const PerformerPanel: React.FC<{ performer: Performer; breathe: number }> = ({
  performer,
  breathe,
}) => {
  const name = performer.name.toUpperCase();
  const fallback = (
    <PhotoFallback
      label={initials(performer.name)}
      size={220}
      scale={breathe}
    />
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        height: "100%",
        overflow: "hidden",
        background: "#0b0b0b",
      }}
    >
      {performer.image ? (
        <Photo
          src={performer.image}
          framing={performer.framing}
          breathe={breathe}
          fallback={fallback}
        />
      ) : (
        fallback
      )}
      <Vignette />
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 12,
          right: 12,
          textAlign: "center",
          fontFamily: brandFont,
          fontSize: fitBrandSize(name, 380, 76),
          lineHeight: 1,
          color: "#ffffff",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </div>
    </div>
  );
};

// Three or more names do not fit as panels, so the bill becomes a row of
// chips: the photo where it loads, initials where it does not.
const PerformerChips: React.FC<{
  performers: Performer[];
  breathe: number;
}> = ({ performers, breathe }) => {
  // Fit the whole row inside the window: past three names, the chips shrink
  // rather than running off both ends.
  const gap = 24;
  const column = Math.floor(
    (PLAYER_FRAME.width - 64 - gap * (performers.length - 1)) /
      performers.length,
  );
  const size = Math.min(200, column);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#0b0b0b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap,
        padding: "0 32px",
      }}
    >
      {performers.map((p, i) => {
        const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
        const name = p.name.toUpperCase();
        const chipInitials = (
          <span
            style={{
              fontFamily: brandFont,
              fontSize: size * 0.42,
              lineHeight: 1,
              color: "#ffffff",
            }}
          >
            {initials(p.name)}
          </span>
        );
        return (
          <div
            key={`${p.name}-${i}`}
            style={{
              width: column,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
            }}
          >
            <div
              style={{
                position: "relative",
                width: size,
                height: size,
                borderRadius: "50%",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#141414",
                border: `3px solid ${color}`,
                transform: `scale(${breathe})`,
                flexShrink: 0,
              }}
            >
              {p.image ? (
                <SafeImg
                  src={p.image}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  fallback={chipInitials}
                />
              ) : (
                chipInitials
              )}
            </div>
            <div
              style={{
                fontFamily: brandFont,
                fontSize: fitBrandSize(name, column, 46),
                lineHeight: 1,
                color: "#ffffff",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const PlayerFrame: React.FC<{
  artistName: string;
  artistImage: string | null;
  artistFraming: Framing | undefined;
  performers: Performer[] | null;
  viewers: number;
}> = ({ artistName, artistImage, artistFraming, performers, viewers }) => {
  const frame = useCurrentFrame();

  // Periodic over the full 300 frames, so the seam is continuous.
  const breathe =
    1.02 + 0.02 * Math.sin((2 * Math.PI * frame) / PULLUP_DURATION);
  const liveDot = 0.55 + 0.45 * Math.sin((2 * Math.PI * frame) / 60);

  const soloFallback = (
    <PhotoFallback
      label={artistName.charAt(0).toUpperCase()}
      size={340}
      scale={breathe}
    />
  );

  let body: React.ReactNode;
  if (performers && performers.length >= 3) {
    body = <PerformerChips performers={performers} breathe={breathe} />;
  } else if (performers && performers.length === 2) {
    body = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          // The gap shows the container through as a hairline divider.
          gap: 2,
          background: "rgba(255, 255, 255, 0.14)",
        }}
      >
        {performers.map((p, i) => (
          <PerformerPanel
            key={`${p.name}-${i}`}
            performer={p}
            breathe={breathe}
          />
        ))}
      </div>
    );
  } else {
    body = (
      <>
        {artistImage ? (
          <Photo
            src={artistImage}
            framing={artistFraming}
            breathe={breathe}
            fallback={soloFallback}
          />
        ) : (
          soloFallback
        )}

        {/* Bottom vignette so the frame edge reads on any photo */}
        <Vignette />
      </>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 258,
        left: 130,
        width: PLAYER_FRAME.width,
        height: PLAYER_FRAME.height,
        borderRadius: 26,
        overflow: "hidden",
        border: "2px solid rgba(255, 255, 255, 0.14)",
        background: "#0b0b0b",
      }}
    >
      {body}

      {/* LIVE pill - top left */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: 24,
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
      <div style={{ position: "absolute", top: 24, right: 24 }}>
        <ViewerCounter count={viewers} />
      </div>
    </div>
  );
};

// --- One avatar circle. Slot 0 is YOU, and arrives first. ---
const AvatarCircle: React.FC<{
  slot: number;
  label: string;
  image: string | null;
  isYou: boolean;
  accent: string;
}> = ({ slot, label, image, isYou, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inAt = avatarInFrame(slot);
  const outAt = avatarOutFrame(slot);

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

  // YOU gets a single pulse once it has landed.
  const pulse = isYou
    ? interpolate(frame, [inAt + 20, inAt + 30, inAt + 46], [1, 1.18, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const color = isYou
    ? accent
    : AVATAR_COLORS[(slot - 1) % AVATAR_COLORS.length];

  const chipLabel = (
    <span
      style={{
        fontFamily: brandFont,
        fontSize: 56,
        lineHeight: 1,
        color: isYou ? "#000000" : "#ffffff",
      }}
    >
      {isYou ? "YOU" : label.slice(0, 2).toUpperCase()}
    </span>
  );

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
          position: "relative",
          width: 108,
          height: 108,
          borderRadius: "50%",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isYou ? color : "#141414",
          border: `3px solid ${color}`,
          transform: `scale(${scale * pulse})`,
          opacity: Math.min(scale, 1),
        }}
      >
        {image && !isYou ? (
          <SafeImg
            src={image}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            fallback={chipLabel}
          />
        ) : (
          chipLabel
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

  const isYou = name.toLowerCase() === "you";
  const enter = spring({
    frame,
    fps,
    delay: chatInFrame(index),
    config: { damping: 16, stiffness: 110, mass: 0.7 },
  });
  const exit = interpolate(frame, [SEAM_START, SEAM_START + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dotColor = isYou
    ? accent
    : AVATAR_COLORS[(index + 2) % AVATAR_COLORS.length];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        alignSelf: "flex-start",
        background: isYou
          ? "rgba(255, 255, 255, 0.1)"
          : "rgba(255, 255, 255, 0.06)",
        border: `1px solid ${isYou ? `${accent}66` : "rgba(255, 255, 255, 0.09)"}`,
        borderRadius: 20,
        padding: "14px 26px",
        opacity: enter * exit,
        transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px)`,
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: dotColor,
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
          color: dotColor,
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

// --- Sound ---------------------------------------------------------------
//
// Environmental, never musical: the same clip ships for every artist and
// genre, so there is no key, melody, tempo or percussion that could clash
// with a DJ's set. See scripts/gen-audio.ts for how the wavs are made.
//
// bed.wav and presence.wav are both exactly 300 frames long and wrap onto
// themselves, so neither needs looping and neither clicks at the seam.

const sfx = (name: string) => staticFile(`audio/pullup/${name}.wav`);

/**
 * Continuous version of the viewer counter, 0..1. Drives the room presence
 * swell: silent in an empty room, full with all seven in. Zero at frame 0
 * and zero again by frame 298, so the audio wraps as cleanly as the video.
 */
function roomLevel(frame: number): number {
  let level = 0;
  for (let slot = 0; slot < CIRCLES; slot++) {
    const inAt = avatarInFrame(slot);
    const outAt = avatarOutFrame(slot);
    const rise = interpolate(frame, [inAt, inAt + 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const fall = interpolate(frame, [outAt, outAt + AV_OUT_DURATION], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    level += Math.min(rise, fall);
  }
  return level / CIRCLES;
}

const PullUpAudio: React.FC<{ bedVariant: "base" | "a" | "b" | "c" }> = ({
  bedVariant,
}) => {
  const bed = bedVariant && bedVariant !== "base" ? `bed-${bedVariant}` : "bed";
  return (
    <>
      {/* Room tone. Texture only - no tonal component anywhere in the bed. */}
      <Audio src={sfx(bed)} />

      {/* Room presence, following the counter 0 -> 7 -> 0. */}
      <Audio src={sfx("presence")} volume={(f) => roomLevel(f)} />

      {/* Impact under the headline/ask punch - fires on every loop. */}
      <Sequence durationInFrames={17}>
        <Audio src={sfx("thud")} />
      </Sequence>

      {/* You arrive first. */}
      <Sequence from={YOU_IN} durationInFrames={8}>
        <Audio src={sfx("pop-you")} />
      </Sequence>
      <Sequence from={YOU_IN} durationInFrames={2}>
        <Audio src={sfx("click")} />
      </Sequence>

      {/* Then the roster, each blip a little lower than the last. */}
      {Array.from({ length: FRIENDS }).map((_, i) => (
        <React.Fragment key={i}>
          <Sequence from={avatarInFrame(i + 1)} durationInFrames={8}>
            <Audio src={sfx(`pop-friend-${i}`)} />
          </Sequence>
          <Sequence from={avatarInFrame(i + 1)} durationInFrames={2}>
            <Audio src={sfx("click")} />
          </Sequence>
        </React.Fragment>
      ))}

      {/* Chat ticks - your message, then the two trailing ones. */}
      {CHAT_IN_FRAMES.map((f, i) => (
        <Sequence key={i} from={f} durationInFrames={10}>
          <Audio src={sfx("msg")} />
        </Sequence>
      ))}

      {/* The room empties: a downward band sweep ending at silence. */}
      <Sequence
        from={SEAM_START}
        durationInFrames={PULLUP_DURATION - SEAM_START}
      >
        <Audio src={sfx("whoosh")} />
      </Sequence>
    </>
  );
};

// --- Main composition ---
export const PullUp: React.FC<PullUpProps> = ({
  artistName,
  artistImage,
  eventDay,
  eventTime,
  avatars,
  chatLines,
  performers,
  artistFraming,
  seed = 0,
  // B (pre-show venue) is the shipped bed; A, C and the synthesised "base"
  // stay selectable through this prop.
  bedVariant = "b",
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

  // A shared booking leads with the night; the caption carries the bill.
  const bill = performers && performers.length >= 2 ? performers : null;

  const day = eventDay.toUpperCase();
  const artist = artistName.toUpperCase();
  const headlineText = `COME WATCH ${artist} LIVE`;
  const streamingText = `STREAMING ${day} ${eventTime}`;
  const captionText = `${day} ${eventTime} \u00b7 ${
    bill ? bill.map((p) => p.name.toUpperCase()).join(" \u00d7 ") : artist
  }`;

  const headlinePunch = punch(frame, 0, HEADLINE_PUNCH_END, 0.1);
  const askPunch = punch(frame, ASK_PUNCH_START, ASK_PUNCH_END, 0.06);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <PullUpAudio bedVariant={bedVariant} />

      {/* Hook - where to watch. On screen from frame 0, slams on every loop. */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 70,
          width: 940,
          height: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${headlinePunch})`,
        }}
      >
        <div
          style={{
            fontFamily: brandFont,
            fontSize: fitBrandSize(headlineText, 940, 124),
            lineHeight: 1,
            color: "#ffffff",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {headlineText}
        </div>
        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: 2,
            marginTop: 14,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "#9146FF" }}>TWITCH.TV/WATERHOUSESTUDIOS</span>
          <span style={{ color: "#666666" }}> · </span>
          <span style={{ color: "#cccccc" }}>
            {day} {eventTime}
          </span>
        </div>
      </div>

      <PlayerFrame
        artistName={artistName}
        artistImage={artistImage}
        artistFraming={artistFraming}
        performers={bill}
        viewers={viewers}
      />

      {/* Caption under the player */}
      <div
        style={{
          position: "absolute",
          top: 836,
          left: 70,
          width: 940,
          height: 42,
          textAlign: "center",
          fontFamily: bodyFont,
          fontSize: fitCaptionSize(captionText, 940, 32),
          fontWeight: 700,
          letterSpacing: 5,
          color: "#8a8a8a",
          whiteSpace: "nowrap",
        }}
      >
        {captionText}
      </div>

      {/* The ask - on screen from frame 0, never leaves */}
      <div
        style={{
          position: "absolute",
          top: 900,
          left: 70,
          width: 940,
          height: 380,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 120,
            height: 4,
            background: accent,
            marginBottom: 18,
          }}
        />

        <div
          style={{
            fontFamily: brandFont,
            fontSize: fitBrandSize(streamingText, 940, 124),
            lineHeight: 1,
            color: "#ffffff",
            whiteSpace: "nowrap",
            transform: `scale(${askPunch})`,
          }}
        >
          {streamingText}
        </div>

        <div
          style={{
            fontFamily: brandFont,
            fontSize: 92,
            lineHeight: 1,
            marginTop: 8,
            color: accent,
            whiteSpace: "nowrap",
          }}
        >
          COME HANG FOR A BIT.
        </div>

        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 32,
            lineHeight: 1.35,
            color: "#8a8a8a",
            textAlign: "center",
            marginTop: 18,
            maxWidth: 820,
          }}
        >
          every viewer helps more people find the set.
          <br />
          muted is fine, stay if it&apos;s good.
        </div>
      </div>

      {/* The room fills up around the ask - you first, then the roster.
          Left-aligned to the chat column, so YOU alone reads as the head of
          a queue rather than an orphaned circle. */}
      <div
        style={{
          position: "absolute",
          top: 1300,
          left: 70,
          width: 940,
          height: 116,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 14,
        }}
      >
        <AvatarCircle slot={0} label="YOU" image={null} isYou accent={accent} />
        {friends.map((a, i) => (
          <AvatarCircle
            key={i}
            slot={i + 1}
            label={a.label}
            image={a.image}
            isYou={false}
            accent={accent}
          />
        ))}
      </div>

      {/* Logo watermark - constant, so it never disturbs the loop seam */}
      <div
        style={{ position: "absolute", bottom: 26, right: 50, opacity: 0.38 }}
      >
        <Img
          src={staticFile("logo.svg")}
          style={{ width: 76, height: 52, filter: "invert(1)" }}
        />
      </div>

      {/* Chat - your message first, the others trail the arriving friends */}
      <div
        style={{
          position: "absolute",
          bottom: 96,
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
