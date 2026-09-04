import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadJersey } from "@remotion/google-fonts/Jersey10";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import {
  HouseWeeklySchema,
  type Badge,
  type BoardRow,
  type HouseWeeklyProps,
} from "./audience/schema";

// Same brand pairing as WeeklyLineup and PullUp: Jersey 10 headlines, Space
// Grotesk body. Plex Mono carries the data chrome - labels, ranks, substats -
// so numbers never fight the display face for attention.
const { fontFamily: brandFont } = loadJersey();
const { fontFamily: bodyFont } = loadGrotesk("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});
const { fontFamily: monoFont } = loadMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export { HouseWeeklySchema };
export type { HouseWeeklyProps };

// --- Palette ---
const BG = "#0B0B0D";
const INK = "#F1F1EE";
const INK_2 = "#C4C4CB";
const GREY = "#8F8F98";
const LINE = "#2B2B31";
const ACCENT = "#FF5C93";

// --- Timing (30fps, 750 frames = 25s) ---
//
// Five beats at absolute frame positions. They are Sequences rather than a
// TransitionSeries precisely so the ranges stay where the spec puts them:
// a crossfade would eat frames off every boundary.
export const HOUSEWEEKLY_DURATION = 750;

const WEEK_START = 0;
const WEEK_LENGTH = 90; // 0-90    the week
const BOARD_START = 90;
const BOARD_LENGTH = 240; // 90-330  the board
const BADGES_START = 330;
const BADGES_LENGTH = 150; // 330-480 badges
const HOUSE_START = 480;
const HOUSE_LENGTH = 120; // 480-600 the house line
const NEXT_START = 600;
const NEXT_LENGTH = 150; // 600-750 next week

// The glossary under the header has to be settled before anything moves under
// it, so the rows wait out its fade before the first one arrives. Seven rows
// at one per 30 frames then fills what is left of the beat exactly.
export const BOARD_ROW_CAP = 7;
const BOARD_LEAD_IN = 14;
const BOARD_ROW_STAGGER = 30;

// --- Small helpers ---

// A number ticking up to its value and stopping there. Eases out so the last
// few digits settle instead of snapping.
const countUp = (
  frame: number,
  from: number,
  to: number,
  value: number,
): number =>
  Math.round(
    interpolate(frame, [from, to], [0, value], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }),
  );

const fadeUp = (frame: number, delay: number, distance = 28) => {
  const t = interpolate(frame, [delay, delay + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * distance}px)`,
  };
};

const pct = (holdRate: number) => `${Math.round(holdRate * 100)}%`;

// Spoke is the one substat that can be missing: chat capture only exists from
// the day it shipped, and Twitch keeps no history before it.
const spoke = (row: BoardRow) =>
  row.chat ? `${row.chat.chatters}/${row.uniques}` : "—";

const substatLine = (row: BoardRow) =>
  `pulled ${row.pulled} · hold ${pct(row.holdRate)} · peak ${row.peak} · follows ${row.follows} · spoke ${spoke(row)}`;

// --- Frame chrome: eyebrow at the top, watermark at the foot ---
const Frame: React.FC<{
  label: string;
  left: string;
  right?: string;
  children: React.ReactNode;
}> = ({ label, left, right, children }) => {
  const frame = useCurrentFrame();
  const chrome = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        padding: "104px 72px 84px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontFamily: monoFont,
          fontSize: 30,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: GREY,
          opacity: chrome,
        }}
      >
        {label}
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {children}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: monoFont,
          fontSize: 24,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: GREY,
          opacity: chrome * 0.85,
        }}
      >
        <span>{left}</span>
        {right ? <span>{right}</span> : null}
      </div>
    </AbsoluteFill>
  );
};

// --- Beat 1 (0-90): the week ---
const TheWeek: React.FC<
  Pick<
    HouseWeeklyProps,
    "rangeLabel" | "weekLabel" | "shows" | "uniques" | "pulled" | "follows"
  >
> = ({ rangeLabel, weekLabel, shows, uniques, pulled, follows }) => {
  const frame = useCurrentFrame();

  return (
    <Frame label={rangeLabel} left="Waterhouse" right={weekLabel}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={fadeUp(frame, 4)}>
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 320,
              lineHeight: 0.82,
              color: INK,
            }}
          >
            {countUp(frame, 6, 36, shows)}
          </div>
          <div
            style={{
              fontFamily: bodyFont,
              fontSize: 44,
              color: INK_2,
              marginTop: 8,
            }}
          >
            shows
          </div>
        </div>

        <div
          style={{
            height: 2,
            background: LINE,
            margin: "52px 0",
            width: interpolate(frame, [10, 46], [0, 936], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            }),
          }}
        />

        <div style={fadeUp(frame, 22)}>
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 230,
              lineHeight: 0.82,
              color: INK,
            }}
          >
            {countUp(frame, 24, 56, uniques)}
          </div>
          <div
            style={{
              fontFamily: bodyFont,
              fontSize: 44,
              color: INK_2,
              marginTop: 8,
            }}
          >
            people in the room
          </div>
        </div>

        <div style={{ ...fadeUp(frame, 40), marginTop: 40 }}>
          <div
            style={{
              fontFamily: bodyFont,
              fontSize: 52,
              fontWeight: 700,
              color: ACCENT,
            }}
          >
            {countUp(frame, 42, 72, pulled)} new to the house
          </div>
        </div>

        <div style={{ ...fadeUp(frame, 56), marginTop: 16 }}>
          <div
            style={{
              fontFamily: bodyFont,
              fontSize: 46,
              fontWeight: 700,
              color: INK_2,
            }}
          >
            {countUp(frame, 58, 86, follows)} new follows
          </div>
        </div>
      </div>
    </Frame>
  );
};

// --- Beat 2 (90-330): the board ---

// One glossary line per number on the board. Nobody reading this on a phone
// on a Monday has a reason to know the house vocabulary.
const GLOSSARY: { term: string; rest: string }[] = [
  {
    term: "CROWD",
    rest: " — the room you brought: new faces plus your own returning people.",
  },
  {
    term: "PULLED",
    rest: " — new faces. Hadn't watched any Waterhouse stream in the past 30 days.",
  },
  {
    term: "HOLD",
    rest: " — share of your viewers who stuck around, not just a drop-in.",
  },
  { term: "PEAK", rest: " — most people watching at once." },
  { term: "FOLLOWS", rest: " — new follows during your set." },
  { term: "SPOKE", rest: " — how many people chatted, out of everyone there." },
];

const BoardRowLine: React.FC<{
  row: BoardRow;
  rank: number;
  delay: number;
  rowHeight: number;
  maxCrowd: number;
}> = ({ row, rank, delay, rowHeight, maxCrowd }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
    durationInFrames: 22,
  });
  const bar = interpolate(frame, [delay + 8, delay + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const nameSize = Math.min(50, rowHeight * 0.3);
  const crowdSize = Math.min(88, rowHeight * 0.52);
  const metaSize = Math.min(24, rowHeight * 0.15);

  // The bar is scaled against the top of the board, so the leader fills it and
  // everyone else is read against them. Pulled first, then returning.
  const share = (n: number) => (maxCrowd > 0 ? (n / maxCrowd) * bar * 100 : 0);

  return (
    <div
      style={{
        height: rowHeight,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 12,
        borderBottom: `1px solid ${LINE}`,
        opacity: enter,
        transform: `translateX(${interpolate(enter, [0, 1], [70, 0])}px)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 48,
            flexShrink: 0,
            fontFamily: monoFont,
            fontSize: Math.min(30, rowHeight * 0.17),
            color: GREY,
          }}
        >
          {rank}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: bodyFont,
            fontSize: nameSize,
            fontWeight: 700,
            color: INK,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.artistName}
          {row.shared ? <span style={{ color: GREY }}>*</span> : null}
        </div>

        <div
          style={{
            width: 90,
            flexShrink: 0,
            textAlign: "right",
            fontFamily: brandFont,
            fontSize: crowdSize,
            lineHeight: 0.9,
            color: row.crowd > 0 ? ACCENT : GREY,
          }}
        >
          {row.crowd}
        </div>

        <div
          style={{
            width: 300,
            flexShrink: 0,
            height: Math.min(18, rowHeight * 0.1),
            background: LINE,
            display: "flex",
          }}
        >
          <div style={{ width: `${share(row.pulled)}%`, background: ACCENT }} />
          <div style={{ width: `${share(row.returning)}%`, background: INK }} />
        </div>
      </div>

      <div
        style={{
          marginLeft: 48 + 18,
          fontFamily: monoFont,
          fontSize: metaSize,
          color: GREY,
          whiteSpace: "nowrap",
          opacity: bar,
        }}
      >
        {substatLine(row)}
      </div>
    </div>
  );
};

const TheBoard: React.FC<Pick<HouseWeeklyProps, "rows">> = ({ rows }) => {
  const frame = useCurrentFrame();

  const shown = rows.slice(0, BOARD_ROW_CAP);
  const anyShared = shown.some((r) => r.shared);
  const maxCrowd = Math.max(1, ...shown.map((r) => r.crowd));

  // Two-line rows, so the height per row is roughly double what a flat board
  // needed. Seven of them still clear the footnote.
  const rowHeight = Math.min(180, Math.floor(1330 / Math.max(1, shown.length)));

  const glossaryIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Frame label="Ranked by crowd" left="Crowd" right="Substats">
      <div
        style={{
          marginTop: 30,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontFamily: monoFont,
          fontSize: 20,
          lineHeight: 1.45,
          color: GREY,
          whiteSpace: "nowrap",
          opacity: glossaryIn,
        }}
      >
        {GLOSSARY.map((entry) => (
          <div key={entry.term}>
            <span style={{ color: INK }}>{entry.term}</span>
            {entry.rest}
          </div>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            height: 2,
            background: INK,
            opacity: glossaryIn,
          }}
        />

        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.map((row, i) => (
            <BoardRowLine
              key={`${row.artistName}-${i}`}
              row={row}
              rank={i + 1}
              delay={BOARD_LEAD_IN + i * BOARD_ROW_STAGGER}
              rowHeight={rowHeight}
              maxCrowd={maxCrowd}
            />
          ))}
        </div>

        {anyShared ? (
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 24,
              color: GREY,
              marginTop: 20,
              ...fadeUp(frame, 20, 12),
            }}
          >
            * shared slot
          </div>
        ) : null}
      </div>
    </Frame>
  );
};

// --- Beat 3 (330-480): badges ---
//
// One badge per substat, so every behaviour the house wants to see has a
// weekly winner and most artists take something home.
const BADGE_LABELS: { key: Badge; label: string }[] = [
  { key: "most-pulled", label: "Most pulled" },
  { key: "held-the-room", label: "Held the room" },
  { key: "most-follows", label: "Most follows" },
  { key: "loudest-room", label: "Loudest room" },
  { key: "best-comeback", label: "Best comeback" },
];

// A badge nobody earned still gets its row - the shape of the week is part of
// the information. It reads "—", never an excuse.
const badgeWinner = (rows: BoardRow[], key: Badge): string => {
  const row = rows.find((r) => r.badges.includes(key));
  if (!row) return "—";
  if (key === "best-comeback" && row.deltaCrowd !== null) {
    return `${row.artistName} +${row.deltaCrowd}`;
  }
  return row.artistName;
};

const BadgeCard: React.FC<{ label: string; value: string; delay: number }> = ({
  label,
  value,
  delay,
}) => {
  const frame = useCurrentFrame();
  const earned = value !== "—";

  return (
    <div
      style={{
        border: `3px solid ${earned ? INK : LINE}`,
        padding: "30px 34px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        ...fadeUp(frame, delay),
      }}
    >
      <span
        style={{
          fontFamily: monoFont,
          fontSize: 32,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: GREY,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: bodyFont,
          fontSize: 46,
          fontWeight: 700,
          color: earned ? INK : GREY,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
};

const Badges: React.FC<Pick<HouseWeeklyProps, "rows">> = ({ rows }) => {
  return (
    <Frame label="This week's" left={`Badges · ${BADGE_LABELS.length}`}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 28,
        }}
      >
        {BADGE_LABELS.map((badge, i) => (
          <BadgeCard
            key={badge.key}
            label={badge.label}
            value={badgeWinner(rows, badge.key)}
            delay={10 + i * 18}
          />
        ))}
      </div>
    </Frame>
  );
};

// --- Beat 4 (480-600): the house line ---
const HouseLine: React.FC<Pick<HouseWeeklyProps, "houseSeries">> = ({
  houseSeries,
}) => {
  const frame = useCurrentFrame();

  const width = 936;
  const height = 560;
  const padX = 26;
  const padTop = 140;
  const padBottom = 60;

  const values = houseSeries.map((p) => p.pulled);
  const max = Math.max(1, ...values);
  const points = houseSeries.map((p, i) => {
    const x =
      houseSeries.length > 1
        ? padX + (i / (houseSeries.length - 1)) * (width - padX * 2)
        : width / 2;
    const y =
      height - padBottom - (p.pulled / max) * (height - padTop - padBottom);
    return { x, y };
  });

  const draw = interpolate(frame, [10, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const dotIn = interpolate(frame, [76, 92], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const last = points[points.length - 1];
  const lastValue = houseSeries[houseSeries.length - 1]?.pulled ?? 0;
  const firstLabel = houseSeries[0]?.weekLabel ?? "";
  const lastLabel = houseSeries[houseSeries.length - 1]?.weekLabel ?? "";

  return (
    <Frame
      label="New to the house · 8 weeks"
      left="House"
      right={firstLabel && lastLabel ? `${firstLabel}–${lastLabel}` : "House"}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <line
            x1={0}
            y1={height - padBottom}
            x2={width}
            y2={height - padBottom}
            stroke={LINE}
            strokeWidth={2}
          />
          {points.length > 1 ? (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={INK}
              strokeWidth={6}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
          ) : null}
          {last ? (
            <>
              <circle cx={last.x} cy={last.y} r={14 * dotIn} fill={ACCENT} />
              <text
                x={last.x}
                y={last.y - 34}
                textAnchor="end"
                fontFamily={brandFont}
                fontSize={96}
                fill={ACCENT}
                opacity={dotIn}
              >
                {lastValue}
              </text>
            </>
          ) : null}
          <text
            x={0}
            y={height - 16}
            fontFamily={monoFont}
            fontSize={26}
            fill={GREY}
          >
            {firstLabel}
          </text>
          <text
            x={width}
            y={height - 16}
            textAnchor="end"
            fontFamily={monoFont}
            fontSize={26}
            fill={GREY}
          >
            {lastLabel}
          </text>
        </svg>

        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 48,
            color: INK,
            marginTop: 56,
            ...fadeUp(frame, 84),
          }}
        >
          The house grows when you promote.
        </div>
      </div>
    </Frame>
  );
};

// --- Beat 5 (600-750): next week ---
const NextWeek: React.FC<Pick<HouseWeeklyProps, "nextWeek">> = ({
  nextWeek,
}) => {
  const frame = useCurrentFrame();
  const stagger = Math.min(18, Math.floor(90 / Math.max(1, nextWeek.length)));

  return (
    <Frame label="Next week" left="Waterhouse" right="Link in bio">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {nextWeek.length === 0 ? (
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 128,
              lineHeight: 0.9,
              color: INK,
              ...fadeUp(frame, 10),
            }}
          >
            Next week&apos;s lineup drops soon.
          </div>
        ) : (
          nextWeek.map((slot, i) => (
            <div
              key={`${slot.dayLabel}-${slot.time}-${i}`}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 24,
                padding: "26px 0",
                borderBottom: `1px solid ${LINE}`,
                ...fadeUp(frame, 10 + i * stagger),
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 20,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 38,
                    color: GREY,
                    whiteSpace: "nowrap",
                  }}
                >
                  {slot.dayLabel} {slot.time}
                </span>
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: 52,
                    fontWeight: 700,
                    color: INK,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {slot.artistName}
                </span>
              </span>
              {slot.beat !== null ? (
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 36,
                    color: ACCENT,
                    whiteSpace: "nowrap",
                  }}
                >
                  beat {slot.beat}
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Frame>
  );
};

// --- Main composition ---
export const HouseWeekly: React.FC<HouseWeeklyProps> = ({
  weekLabel,
  rangeLabel,
  shows,
  uniques,
  pulled,
  follows,
  rows,
  houseSeries,
  nextWeek,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Sequence from={WEEK_START} durationInFrames={WEEK_LENGTH}>
        <TheWeek
          rangeLabel={rangeLabel}
          weekLabel={weekLabel}
          shows={shows}
          uniques={uniques}
          pulled={pulled}
          follows={follows}
        />
      </Sequence>

      <Sequence from={BOARD_START} durationInFrames={BOARD_LENGTH}>
        <TheBoard rows={rows} />
      </Sequence>

      <Sequence from={BADGES_START} durationInFrames={BADGES_LENGTH}>
        <Badges rows={rows} />
      </Sequence>

      <Sequence from={HOUSE_START} durationInFrames={HOUSE_LENGTH}>
        <HouseLine houseSeries={houseSeries} />
      </Sequence>

      <Sequence from={NEXT_START} durationInFrames={NEXT_LENGTH}>
        <NextWeek nextWeek={nextWeek} />
      </Sequence>
    </AbsoluteFill>
  );
};
