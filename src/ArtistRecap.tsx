import React from "react";
import {
  AbsoluteFill,
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
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import {
  ArtistRecapPropsSchema,
  type ArtistRecapProps,
  type Quadrant,
  type SessionAudience,
  type Viewer,
} from "./audience/schema";

// Same brand pairing as PullUp / WeeklyLineup - Jersey 10 headlines, Space
// Grotesk body - plus a mono face, because every number in this video is meant
// to be compared with the number under it.
const { fontFamily: brandFont } = loadJersey();
const { fontFamily: bodyFont } = loadGrotesk("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});
const { fontFamily: monoFont } = loadMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export const ArtistRecapSchema = ArtistRecapPropsSchema;
export type { ArtistRecapProps };

// --- Palette (the spec's dark tokens, on the black PullUp ground) ---
const BG = "#0A0A0C";
const INK = "#F1F1EE";
const INK_2 = "#C4C4CB";
const GREY = "#8F8F98";
const LINE = "#2B2B31";
const PANEL = "#1B1B1F";
const ACCENT = "#FF5C93";

// Fill by kind: new faces (accent), your returning people (ink), house (grey).
const KIND_COLOR: Record<Viewer["kind"], string> = {
  pulled: ACCENT,
  returning: INK,
  regular: GREY,
};

// --- Timing (30 fps, 600 frames = 20s) ---
export const ARTIST_RECAP_DURATION = 600;

const HOOK_FROM = 0;
const HOOK_LEN = 75; // 0-75    hook
const BARS_FROM = 75;
const BARS_LEN = 180; // 75-255  who showed up
const TREND_FROM = 255;
const TREND_LEN = 120; // 255-375 the trend
const SHAPE_FROM = 375;
const SHAPE_LEN = 120; // 375-495 the shape
const ASK_FROM = 495;
const ASK_LEN = 105; // 495-600 the ask

// Beyond this the rows stop being readable at story size; the rest collapse.
const MAX_ROWS = 14;

const PAD = 70;
const W = 1080;
const CONTENT_W = W - PAD * 2;

// --- Small helpers ---

// Jersey 10 caps run about 0.40em wide. Shrink long headlines rather than
// letting them wrap or clip - artist names vary a lot in length.
function fitBrandSize(text: string, maxWidth: number, cap: number): number {
  if (text.length === 0) return cap;
  return Math.min(cap, maxWidth / (text.length * 0.4));
}

// An impact: at rest, hit, overshoot, settle back to rest. Zero deviation at
// both ends, so the beat it lives in always ends still.
function punch(frame: number, start: number, end: number, amount: number) {
  const span = end - start;
  return interpolate(
    frame,
    [start, start + span * 0.16, start + span * 0.45, end],
    [1, 1 + amount, 1 - amount * 0.22, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

const fadeIn = (frame: number, start: number, len = 12) =>
  interpolate(frame, [start, start + len], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const pct = (rate: number) => Math.round(rate * 100);

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

// "1:30" - elapsed into the set. Clock times would need a timezone the props
// do not carry, and elapsed is what the bars are measured against anyway.
function elapsedLabel(min: number): string {
  const m = min % 60;
  return `${Math.floor(min / 60)}:${m < 10 ? "0" : ""}${m}`;
}

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}

const EMPTY_SESSION: SessionAudience = {
  start: "",
  end: "",
  durationMin: 60,
  slotLabel: "",
  dateLabel: "",
  peak: 0,
  uniques: 0,
  pulled: 0,
  returning: 0,
  regulars: 0,
  crowd: 0,
  holdRate: 0,
  follows: 0,
  chat: null,
  quadrant: "quiet",
  shared: false,
  viewers: [],
};

const COACHING: Record<Quadrant, string> = {
  "packed-held": "Do it again. Ask them to follow.",
  "hype-cliff": "Ask 3 friends to stay 20 min.",
  "small-loyal": "Tell 3 more people.",
  quiet: "Post the slot twice this week.",
};

const QUADRANT_LABEL: Record<Quadrant, string> = {
  "small-loyal": "Small but loyal",
  "packed-held": "Packed and held",
  quiet: "Quiet night",
  "hype-cliff": "Hype then cliff",
};

// Reading order of the 2x2: x = crowd (small -> big), y = held (held on top).
const QUADRANT_GRID: Quadrant[] = [
  "small-loyal",
  "packed-held",
  "quiet",
  "hype-cliff",
];

// --- Shared frame chrome: eyebrow up top, watermark down bottom ---
const Chrome: React.FC<{
  eyebrow: string;
  left: string;
  right: string;
  children: React.ReactNode;
}> = ({ eyebrow, left, right, children }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <div
        style={{
          position: "absolute",
          top: 76,
          left: PAD,
          width: CONTENT_W,
          fontFamily: monoFont,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: GREY,
        }}
      >
        {eyebrow}
      </div>

      {children}

      <div
        style={{
          position: "absolute",
          bottom: 62,
          left: PAD,
          width: CONTENT_W,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: monoFont,
          fontSize: 24,
          letterSpacing: 4,
          color: GREY,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Img
            src={staticFile("logo.svg")}
            style={{ width: 44, height: 30, filter: "invert(1)", opacity: 0.5 }}
          />
          {left}
        </span>
        <span>{right}</span>
      </div>
    </AbsoluteFill>
  );
};

// --- Beat 1 · Hook (0-75) -------------------------------------------------
const Hook: React.FC<{
  artistName: string;
  artistImage: string | null;
  showCount: number;
  dateLabel: string;
}> = ({ artistName, artistImage, showCount, dateLabel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The name slams in the PullUp way: oversized, then settles.
  const slam = spring({
    frame,
    fps,
    config: { damping: 13, stiffness: 190, mass: 0.7 },
  });
  const scale = interpolate(slam, [0, 1], [1.55, 1]);
  const nameOpacity = fadeIn(frame, 0, 5);
  const subOpacity = fadeIn(frame, 26, 12);
  const subLift = interpolate(subOpacity, [0, 1], [26, 0]);

  const headline = artistName.toUpperCase();
  const showLine = showCount === 1 ? "1 show." : `${showCount} shows.`;

  return (
    <Chrome eyebrow="Artist" left="WATERHOUSE" right={dateLabel.toUpperCase()}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            width: 230,
            height: 230,
            borderRadius: "50%",
            overflow: "hidden",
            border: `3px solid ${LINE}`,
            background: PANEL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 48,
            opacity: nameOpacity,
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
              }}
            />
          ) : (
            <span
              style={{
                fontFamily: brandFont,
                fontSize: 130,
                lineHeight: 1,
                color: ACCENT,
              }}
            >
              {initialsOf(artistName)}
            </span>
          )}
        </div>

        <div
          style={{
            fontFamily: brandFont,
            fontSize: fitBrandSize(headline, CONTENT_W, 200),
            lineHeight: 1,
            color: INK,
            whiteSpace: "nowrap",
            transform: `scale(${scale})`,
            opacity: nameOpacity,
          }}
        >
          {headline}
        </div>

        <div
          style={{
            marginTop: 54,
            fontFamily: bodyFont,
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.25,
            color: INK_2,
            textAlign: "center",
            opacity: subOpacity,
            transform: `translateY(${subLift}px)`,
          }}
        >
          {showLine}
          <br />
          <span style={{ color: INK }}>Here&apos;s who showed up.</span>
        </div>
      </AbsoluteFill>
    </Chrome>
  );
};

// --- Beat 2 · Who showed up (75-255) -------------------------------------

type BarRow = {
  label: string;
  color: string;
  fromMin: number;
  toMin: number;
  faded: boolean;
};

// Cap at MAX_ROWS. Everyone you pulled or brought back keeps their own bar;
// the house crowd collapses into a single "+k more" row at the bottom.
export function buildRows(session: SessionAudience): {
  rows: BarRow[];
  collapsed: number;
} {
  const viewers = session.viewers;
  if (viewers.length <= MAX_ROWS) {
    return {
      rows: viewers.map((v) => ({
        label: v.initials,
        color: KIND_COLOR[v.kind],
        fromMin: v.arrivedMin,
        toMin: v.leftMin,
        faded: false,
      })),
      collapsed: 0,
    };
  }

  const slots = MAX_ROWS - 1; // last row is the "+k more" bar
  const kept: Viewer[] = [];
  for (const v of viewers) {
    if (v.kind !== "regular" && kept.length < slots) kept.push(v);
  }
  for (const v of viewers) {
    if (v.kind === "regular" && kept.length < slots) kept.push(v);
  }
  const keptSet = new Set(kept);
  const shown = viewers.filter((v) => keptSet.has(v));
  const rest = viewers.filter((v) => !keptSet.has(v));

  const rows: BarRow[] = shown.map((v) => ({
    label: v.initials,
    color: KIND_COLOR[v.kind],
    fromMin: v.arrivedMin,
    toMin: v.leftMin,
    faded: false,
  }));
  rows.push({
    label: `+${rest.length} more`,
    color: GREY,
    fromMin: Math.min(...rest.map((v) => v.arrivedMin)),
    toMin: Math.max(...rest.map((v) => v.leftMin)),
    faded: true,
  });
  return { rows, collapsed: rest.length };
}

type Chunk = { text: string; color: string };

// Types the count line out chunk by chunk, so "3 pulled" can carry the accent.
const TypedLine: React.FC<{
  chunks: Chunk[];
  revealed: number;
  fontSize: number;
}> = ({ chunks, revealed, fontSize }) => {
  let used = 0;
  return (
    <div
      style={{
        fontFamily: monoFont,
        fontSize,
        fontWeight: 500,
        lineHeight: 1.5,
        whiteSpace: "pre",
      }}
    >
      {chunks.map((c, i) => {
        const take = Math.max(0, Math.min(c.text.length, revealed - used));
        used += c.text.length;
        return (
          <span key={i} style={{ color: c.color }}>
            {c.text.slice(0, take)}
          </span>
        );
      })}
    </div>
  );
};

const CHART_LEFT = PAD + 108;
const CHART_RIGHT = W - PAD;
const CHART_WIDTH = CHART_RIGHT - CHART_LEFT;
const CHART_TOP = 645;
const CHART_BOTTOM = 1540;
const COUNT_LINE_TOP = 1660;
const GLOSSARY_TOP = 150;
// ~40 mono chars at 26px, which is where both entries break to three lines.
const GLOSSARY_WIDTH = 630;

// The two words the artist meets in every recap and on the weekly board.
// Spelled out here verbatim as HouseWeekly spells them, so the two videos
// teach the same vocabulary.
const GLOSSARY: { term: string; text: string }[] = [
  {
    term: "PULLED",
    text: " \u2014 new faces. Hadn't watched any Waterhouse stream in the past 30 days. You brought them.",
  },
  {
    term: "YOURS",
    text: " \u2014 people who came for you: new faces plus your own regulars. House regulars who watch every show are not counted.",
  },
  {
    term: "HOLD",
    text: " \u2014 share of everyone watching who stuck around, not just a drop-in.",
  },
];

const SWEEP_START = 12;
const SWEEP_END = 116;
const TYPE_START = 126;
const TYPE_END = 168;

const WhoShowedUp: React.FC<{ session: SessionAudience }> = ({ session }) => {
  const frame = useCurrentFrame();
  const { rows } = buildRows(session);
  const dur = Math.max(session.durationMin, 1);

  const sweep = interpolate(frame, [SWEEP_START, SWEEP_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const playheadX = CHART_LEFT + sweep * CHART_WIDTH;
  const playheadOpacity = interpolate(
    frame,
    [SWEEP_START, SWEEP_START + 6, SWEEP_END - 4, SWEEP_END + 8],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Fill the plot height with however many rows there are: ten bars at 87px
  // read as a room, ten bars at 62px read as a spreadsheet.
  const rowH = Math.min(
    96,
    (CHART_BOTTOM - CHART_TOP) / Math.max(rows.length, 1),
  );
  const barH = Math.max(14, rowH * 0.5);

  // 30-minute gridlines across the set.
  const ticks: number[] = [];
  for (let m = 30; m < dur; m += 30) ticks.push(m);

  const dot: Chunk = { text: " · ", color: GREY };
  const line1: Chunk[] = [
    { text: `${session.uniques} in the room`, color: INK },
    dot,
    { text: `${session.crowd} yours`, color: INK },
    dot,
    { text: `${session.pulled} new`, color: ACCENT },
    dot,
    { text: `held ${pct(session.holdRate)}%`, color: INK_2 },
  ];
  // Chat is out of the videos until there is data to show. The nullable `chat`
  // field stays in the schema, but no beat reads it. Follows keeps its line
  // even at zero, phrased label-first so it reads the same as the trend beat's
  // "Follows 0 -> 1".
  const line2: Chunk[] = [{ text: `follows ${session.follows}`, color: INK_2 }];
  const len = (cs: Chunk[]) => cs.reduce((n, c) => n + c.text.length, 0);
  const total = len(line1) + len(line2);
  // The crowd line runs to ~43 characters; shrink rather than wrap it.
  const line1Size = Math.min(40, CONTENT_W / (len(line1) * 0.6));
  const typed = Math.floor(
    interpolate(frame, [TYPE_START, TYPE_END], [0, total], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const empty = rows.length === 0;

  return (
    <Chrome
      eyebrow={`${session.dateLabel} · ${session.slotLabel}`}
      left="PRESENCE"
      right={durationLabel(session.durationMin)}
    >
      {/* Settles before the first bar is drawn, so nothing competes for the
          eye while the playhead runs. */}
      <div
        style={{
          position: "absolute",
          top: GLOSSARY_TOP,
          left: PAD,
          width: GLOSSARY_WIDTH,
          opacity: fadeIn(frame, 0, 10),
        }}
      >
        {GLOSSARY.map((g, i) => (
          <div
            key={g.term}
            style={{
              fontFamily: monoFont,
              fontSize: 26,
              lineHeight: 1.5,
              color: GREY,
              marginTop: i === 0 ? 0 : 26,
            }}
          >
            <span style={{ color: INK, fontWeight: 600 }}>{g.term}</span>
            {g.text}
          </div>
        ))}
      </div>

      {empty ? (
        <div
          style={{
            position: "absolute",
            top: CHART_TOP,
            left: PAD,
            width: CONTENT_W,
            height: CHART_BOTTOM - CHART_TOP,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: fadeIn(frame, SWEEP_START, 18),
          }}
        >
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 130,
              lineHeight: 1,
              color: INK,
              textAlign: "center",
            }}
          >
            NOBODY WE
            <br />
            COULD COUNT
          </div>
          <div
            style={{
              marginTop: 30,
              fontFamily: bodyFont,
              fontSize: 34,
              color: GREY,
            }}
          >
            after the house account and bots came out
          </div>
        </div>
      ) : (
        <>
          {/* Time axis - elapsed, so no timezone can lie about it. */}
          <div
            style={{
              position: "absolute",
              top: CHART_TOP - 46,
              left: CHART_LEFT,
              width: CHART_WIDTH,
              height: 30,
              fontFamily: monoFont,
              fontSize: 22,
              color: GREY,
            }}
          >
            {ticks.map((m) => (
              <span
                key={m}
                style={{
                  position: "absolute",
                  left: (m / dur) * CHART_WIDTH,
                  transform: "translateX(-50%)",
                }}
              >
                {elapsedLabel(m)}
              </span>
            ))}
          </div>

          <div
            style={{
              position: "absolute",
              top: CHART_TOP,
              left: CHART_LEFT,
              width: CHART_WIDTH,
              height: rows.length * rowH,
            }}
          >
            {ticks.map((m) => (
              <div
                key={m}
                style={{
                  position: "absolute",
                  left: (m / dur) * CHART_WIDTH,
                  top: -14,
                  bottom: -14,
                  width: 2,
                  background: LINE,
                }}
              />
            ))}

            {rows.map((r, i) => {
              const x0 = r.fromMin / dur;
              const x1 = Math.max(r.toMin / dur, x0 + 0.008);
              const drawn = Math.max(0, Math.min(sweep, x1) - x0);
              const appear = interpolate(
                sweep,
                [x0 - 0.015, x0 + 0.01],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                },
              );
              return (
                <div key={i}>
                  <div
                    style={{
                      position: "absolute",
                      left: -158,
                      top: i * rowH,
                      width: 140,
                      height: barH,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      fontFamily: monoFont,
                      fontSize: r.faded ? 22 : 26,
                      fontWeight: 500,
                      color: r.faded ? GREY : INK_2,
                      opacity: appear,
                    }}
                  >
                    {r.label}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: x0 * CHART_WIDTH,
                      top: i * rowH,
                      width: drawn * CHART_WIDTH,
                      height: barH,
                      background: r.color,
                      opacity: r.faded ? 0.55 : 1,
                    }}
                  />
                </div>
              );
            })}

            <div
              style={{
                position: "absolute",
                left: playheadX - CHART_LEFT,
                top: -22,
                height: rows.length * rowH + 30,
                width: 3,
                background: ACCENT,
                opacity: playheadOpacity,
              }}
            />
          </div>

          {/* Legend - the fill is the whole message, so it gets named. */}
          <div
            style={{
              position: "absolute",
              top: CHART_TOP + rows.length * rowH + 34,
              left: CHART_LEFT,
              width: CHART_WIDTH,
              display: "flex",
              gap: 34,
              alignItems: "center",
              fontFamily: monoFont,
              fontSize: 24,
              color: GREY,
              opacity: fadeIn(frame, SWEEP_END - 20, 16),
            }}
          >
            {(
              [
                ["New faces", ACCENT],
                ["Your regulars", INK],
                ["House regulars", GREY],
              ] as const
            ).map(([label, color]) => (
              <span
                key={label}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <i
                  style={{
                    display: "inline-block",
                    width: 26,
                    height: 12,
                    background: color,
                  }}
                />
                {label}
              </span>
            ))}
          </div>
        </>
      )}

      <div
        style={{
          position: "absolute",
          top: COUNT_LINE_TOP,
          left: PAD,
          width: CONTENT_W,
        }}
      >
        <TypedLine chunks={line1} revealed={typed} fontSize={line1Size} />
        <TypedLine chunks={line2} revealed={typed - len(line1)} fontSize={34} />
      </div>
    </Chrome>
  );
};

// --- Beat 3 · The trend (255-375) ----------------------------------------
const TREND_BASE = 1240;
const TREND_MAX_H = 620;
const BAR_IN = 8;
const BAR_STAGGER = 7;

const Trend: React.FC<{
  sessions: SessionAudience[];
  bestCrowd: number;
}> = ({ sessions, bestCrowd }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const n = Math.max(sessions.length, 1);
  // Uniques set the scale, since the faint room bar is always the taller one.
  const maxU = Math.max(1, ...sessions.map((s) => s.uniques));
  const newest = sessions[sessions.length - 1] ?? EMPTY_SESSION;
  const prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;
  // A drop lands flat. Never punch a regression.
  const rose = prev ? newest.crowd >= prev.crowd : true;

  const gap = 28;
  const barW = Math.min(240, (CONTENT_W - gap * (n - 1)) / n);
  const rowW = barW * n + gap * (n - 1);
  const rowLeft = PAD + (CONTENT_W - rowW) / 2;

  const lastIn = BAR_IN + (n - 1) * BAR_STAGGER;
  const newestPunch = rose ? punch(frame, lastIn + 12, lastIn + 44, 0.07) : 1;

  const holdText = prev
    ? `Hold ${pct(prev.holdRate)} → ${pct(newest.holdRate)}% · ` +
      `Follows ${prev.follows} → ${newest.follows}`
    : `Hold ${pct(newest.holdRate)}% · Follows ${newest.follows}`;
  const isBest = sessions.length > 1 && newest.crowd >= bestCrowd;

  return (
    <Chrome
      eyebrow={`Your crowd · last ${n} ${n === 1 ? "show" : "shows"}`}
      left="TREND"
      right={`N = ${n}`}
    >
      {sessions.map((s, i) => {
        const grow = spring({
          frame: frame - (BAR_IN + i * BAR_STAGGER),
          fps,
          config: { damping: 16, stiffness: 130, mass: 0.8 },
        });
        const isNewest = i === sessions.length - 1;
        const roomH = Math.max(10, (s.uniques / maxU) * TREND_MAX_H) * grow;
        const h = Math.max(6, (s.crowd / maxU) * TREND_MAX_H) * grow;
        const x = rowLeft + i * (barW + gap);
        return (
          <div key={i}>
            {/* The whole room, faint: the crowd bar is a share of it. */}
            <div
              style={{
                position: "absolute",
                left: x,
                top: TREND_BASE - roomH,
                width: barW,
                height: roomH,
                background: PANEL,
                borderTop: `2px solid ${LINE}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x,
                top: TREND_BASE - h,
                width: barW,
                height: h,
                background: isNewest ? ACCENT : GREY,
                transformOrigin: "bottom center",
                transform: isNewest ? `scaleY(${newestPunch})` : undefined,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x,
                top: TREND_BASE - roomH - 78,
                width: barW,
                textAlign: "center",
                fontFamily: monoFont,
                fontSize: 52,
                fontWeight: 600,
                color: isNewest ? ACCENT : INK_2,
                opacity: grow,
              }}
            >
              {s.crowd}
            </div>
            {/* Every bar carries its slot. A drop with a time under it is
                information; a drop alone is shame. */}
            <div
              style={{
                position: "absolute",
                left: x - 10,
                top: TREND_BASE + 18,
                width: barW + 20,
                textAlign: "center",
                fontFamily: monoFont,
                fontSize: 24,
                color: isNewest ? INK_2 : GREY,
                opacity: fadeIn(frame, BAR_IN + i * BAR_STAGGER, 12),
              }}
            >
              {s.slotLabel}
              <br />
              <span style={{ fontSize: 21, color: GREY }}>{s.dateLabel}</span>
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: TREND_BASE + 12,
          width: CONTENT_W,
          height: 3,
          background: LINE,
        }}
      />

      {/* Names the two-tone bar, so the faint one is never mistaken for a
          number the artist is being judged on. */}
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 1345,
          width: CONTENT_W,
          fontFamily: monoFont,
          fontSize: 22,
          color: GREY,
          opacity: fadeIn(frame, BAR_IN + 6, 14),
        }}
      >
        pink/white = your crowd · faint = everyone watching
      </div>

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: 1450,
          width: CONTENT_W,
        }}
      >
        {isBest ? (
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 92,
              lineHeight: 1,
              color: ACCENT,
              opacity: fadeIn(frame, 76, 14),
            }}
          >
            BEST SO FAR.
          </div>
        ) : null}
        <div
          style={{
            marginTop: 16,
            fontFamily: monoFont,
            fontSize: 44,
            fontWeight: 500,
            color: INK,
            opacity: fadeIn(frame, 64, 14),
          }}
        >
          {holdText}
        </div>
      </div>
    </Chrome>
  );
};

// --- Beat 4 · The shape (375-495) ----------------------------------------
const GRID_TOP = 470;
const GRID_GAP = 14;
const CELL = (CONTENT_W - GRID_GAP) / 2;

const Shape: React.FC<{ session: SessionAudience }> = ({ session }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = session.quadrant;
  const idx = QUADRANT_GRID.indexOf(active);
  const col = idx % 2;
  const row = Math.floor(idx / 2);
  const targetX = PAD + col * (CELL + GRID_GAP) + CELL / 2;
  const targetY = GRID_TOP + row * (CELL + GRID_GAP) + CELL / 2;
  const startX = PAD + CONTENT_W / 2;
  const startY = GRID_TOP + CELL * 2 + GRID_GAP + 150;

  const travel = spring({
    frame: frame - 10,
    fps,
    config: { damping: 18, stiffness: 90, mass: 1 },
  });
  const dotX = interpolate(travel, [0, 1], [startX, targetX]);
  const dotY = interpolate(travel, [0, 1], [startY, targetY]);
  const fill = interpolate(frame, [58, 74], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dotOpacity = interpolate(frame, [56, 70], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const numbers = fadeIn(frame, 74, 14);

  return (
    <Chrome eyebrow="This night was" left="SHAPE" right="1 OF 4">
      {QUADRANT_GRID.map((q, i) => {
        const on = q === active;
        const x = PAD + (i % 2) * (CELL + GRID_GAP);
        const y = GRID_TOP + Math.floor(i / 2) * (CELL + GRID_GAP);
        return (
          <div
            key={q}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: CELL,
              height: CELL,
              background: on ? `rgba(255, 92, 147, ${fill})` : PANEL,
              border: `2px solid ${on ? ACCENT : LINE}`,
              padding: 30,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
            }}
          >
            <div
              style={{
                fontFamily: bodyFont,
                fontSize: 40,
                fontWeight: 700,
                lineHeight: 1.15,
                color: on ? interpolateColorInk(fill) : GREY,
              }}
            >
              {QUADRANT_LABEL[q]}
            </div>
            {on ? (
              <div
                style={{
                  marginTop: 34,
                  fontFamily: monoFont,
                  fontSize: 40,
                  fontWeight: 600,
                  lineHeight: 1.45,
                  color: "#17070E",
                  opacity: numbers,
                }}
              >
                {session.crowd} yours
                <br />
                {pct(session.holdRate)}% stayed
              </div>
            ) : null}
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: dotX - 26,
          top: dotY - 26,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: ACCENT,
          border: `4px solid ${BG}`,
          boxShadow: "0 0 0 3px rgba(255, 92, 147, 0.5)",
          opacity: dotOpacity,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: GRID_TOP + CELL * 2 + GRID_GAP + 40,
          width: CONTENT_W,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: monoFont,
          fontSize: 26,
          letterSpacing: 3,
          color: GREY,
        }}
      >
        <span>↑ HELD</span>
        <span>CROWD →</span>
      </div>

      <div
        style={{
          position: "absolute",
          left: PAD,
          top: GRID_TOP + CELL * 2 + GRID_GAP + 110,
          width: CONTENT_W,
          fontFamily: bodyFont,
          fontSize: 38,
          color: INK_2,
        }}
      >
        {session.dateLabel}
        {session.slotLabel ? ` · ${session.slotLabel}` : ""}
        {session.shared ? " · shared slot" : ""}
      </div>
    </Chrome>
  );
};

// The active box fills from the panel grey to accent; its label has to cross
// from grey to near-black in step or it goes unreadable half way.
function interpolateColorInk(t: number): string {
  const from = [143, 143, 152];
  const to = [23, 7, 14];
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// --- Beat 5 · The ask (495-600) ------------------------------------------
const Ask: React.FC<{
  nextSlot: ArtistRecapProps["nextSlot"];
  bestCrowd: number;
  quadrant: Quadrant;
}> = ({ nextSlot, bestCrowd, quadrant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slotIn = spring({
    frame: frame - 4,
    fps,
    config: { damping: 15, stiffness: 150, mass: 0.8 },
  });
  const slotScale = interpolate(slotIn, [0, 1], [1.3, 1]);
  const beatPunch = punch(frame, 30, 66, 0.09);
  const target = bestCrowd + 1;
  const beatText = `BEAT ${target}`;

  const slotHeadline = nextSlot
    ? `${nextSlot.dayLabel.toUpperCase()} ${nextSlot.time}`
    : "NEXT SLOT: TBA";

  return (
    <Chrome eyebrow="Next slot" left="WATERHOUSE" right="LINK IN BIO">
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            fontFamily: brandFont,
            fontSize: fitBrandSize(slotHeadline, CONTENT_W, 170),
            lineHeight: 1,
            color: INK,
            whiteSpace: "nowrap",
            transform: `scale(${slotScale})`,
            opacity: fadeIn(frame, 0, 6),
          }}
        >
          {slotHeadline}
        </div>
        {nextSlot ? (
          <div
            style={{
              marginTop: 12,
              fontFamily: monoFont,
              fontSize: 32,
              letterSpacing: 4,
              color: GREY,
              opacity: fadeIn(frame, 8, 10),
            }}
          >
            {nextSlot.dateLabel.toUpperCase()}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 70,
            fontFamily: bodyFont,
            fontSize: 46,
            color: INK_2,
            opacity: fadeIn(frame, 20, 12),
          }}
        >
          Your best crowd is {bestCrowd}.
        </div>

        <div
          style={{
            marginTop: 10,
            fontFamily: brandFont,
            fontSize: fitBrandSize(beatText, CONTENT_W, 300),
            lineHeight: 1,
            color: ACCENT,
            whiteSpace: "nowrap",
            transform: `scale(${beatPunch})`,
            opacity: fadeIn(frame, 28, 8),
          }}
        >
          {beatText}
        </div>

        <div
          style={{
            marginTop: 56,
            fontFamily: bodyFont,
            fontSize: 48,
            fontWeight: 700,
            color: INK,
            textAlign: "center",
            maxWidth: CONTENT_W,
            opacity: fadeIn(frame, 50, 14),
          }}
        >
          {COACHING[quadrant]}
        </div>
      </AbsoluteFill>
    </Chrome>
  );
};

// --- Composition ---------------------------------------------------------
export const ArtistRecap: React.FC<ArtistRecapProps> = ({
  artistName,
  artistImage,
  sessions,
  bestCrowd,
  nextSlot,
}) => {
  const newest =
    sessions.length > 0 ? sessions[sessions.length - 1] : EMPTY_SESSION;

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Sequence from={HOOK_FROM} durationInFrames={HOOK_LEN}>
        <Hook
          artistName={artistName}
          artistImage={artistImage}
          showCount={sessions.length}
          dateLabel={newest.dateLabel}
        />
      </Sequence>

      <Sequence from={BARS_FROM} durationInFrames={BARS_LEN}>
        <WhoShowedUp session={newest} />
      </Sequence>

      <Sequence from={TREND_FROM} durationInFrames={TREND_LEN}>
        <Trend sessions={sessions} bestCrowd={bestCrowd} />
      </Sequence>

      <Sequence from={SHAPE_FROM} durationInFrames={SHAPE_LEN}>
        <Shape session={newest} />
      </Sequence>

      <Sequence from={ASK_FROM} durationInFrames={ASK_LEN}>
        <Ask
          nextSlot={nextSlot}
          bestCrowd={bestCrowd}
          quadrant={newest.quadrant}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
