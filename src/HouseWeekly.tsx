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
// Grotesk body. Plex Mono carries the data chrome - labels, ranks, rates -
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
const PANEL = "#1B1B1F";
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

// Eight rows at one per 30 frames fills the board beat exactly. Past eight,
// the whole board still has to land inside the same window, so the stagger
// tightens instead of the board losing anyone.
//
// The legend under the header has to be settled before anything moves under
// it, so the rows wait out its fade before the first one arrives.
const BOARD_LEAD_IN = 14;
const BOARD_ROW_WINDOW = BOARD_LENGTH - BOARD_LEAD_IN - 30;
const BOARD_ROW_ANIM = 30;
export const boardRowStagger = (rowCount: number): number =>
  Math.min(
    BOARD_ROW_ANIM,
    Math.floor(BOARD_ROW_WINDOW / Math.max(1, rowCount - 1)),
  );

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

// --- Frame chrome: eyebrow at the top, watermark at the foot ---
const Frame: React.FC<{
  label: string;
  left: string;
  right: string;
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
        <span>{right}</span>
      </div>
    </AbsoluteFill>
  );
};

// --- Beat 1 (0-90): the week ---
const TheWeek: React.FC<
  Pick<
    HouseWeeklyProps,
    "rangeLabel" | "weekLabel" | "shows" | "uniques" | "pulled"
  >
> = ({ rangeLabel, weekLabel, shows, uniques, pulled }) => {
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
              fontSize: 340,
              lineHeight: 0.82,
              color: INK,
            }}
          >
            {countUp(frame, 6, 40, shows)}
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
            margin: "56px 0",
            width: interpolate(frame, [10, 46], [0, 936], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            }),
          }}
        />

        <div style={fadeUp(frame, 24)}>
          <div
            style={{
              fontFamily: brandFont,
              fontSize: 240,
              lineHeight: 0.82,
              color: INK,
            }}
          >
            {countUp(frame, 26, 62, uniques)}
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

        <div style={{ ...fadeUp(frame, 46), marginTop: 44 }}>
          <div
            style={{
              fontFamily: bodyFont,
              fontSize: 52,
              fontWeight: 700,
              color: ACCENT,
            }}
          >
            {countUp(frame, 48, 82, pulled)} new to the house
          </div>
        </div>
      </div>
    </Frame>
  );
};

// --- Beat 2 (90-330): the board ---
const BoardRowLine: React.FC<{
  row: BoardRow;
  rank: number;
  delay: number;
  rowHeight: number;
}> = ({ row, rank, delay, rowHeight }) => {
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

  const nameSize = Math.min(50, rowHeight * 0.46);
  const pulledSize = Math.min(88, rowHeight * 0.82);

  return (
    <div
      style={{
        height: rowHeight,
        display: "flex",
        alignItems: "center",
        gap: 18,
        borderBottom: `1px solid ${LINE}`,
        opacity: enter,
        transform: `translateX(${interpolate(enter, [0, 1], [70, 0])}px)`,
      }}
    >
      <div
        style={{
          width: 48,
          flexShrink: 0,
          fontFamily: monoFont,
          fontSize: Math.min(30, rowHeight * 0.28),
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
          width: 110,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: brandFont,
          fontSize: pulledSize,
          lineHeight: 0.9,
          color: row.pulled > 0 ? ACCENT : GREY,
        }}
      >
        {row.pulled}
      </div>

      {/* Peak is context, not a score - we rank on pulled on purpose, so this
          stays a quiet grey number rather than competing with the accent. */}
      <div
        style={{
          width: 90,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: monoFont,
          fontSize: Math.min(28, rowHeight * 0.26),
          color: GREY,
        }}
      >
        {row.peak}
      </div>

      <div
        style={{
          width: 150,
          flexShrink: 0,
          height: Math.min(14, rowHeight * 0.13),
          background: PANEL,
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(1, row.holdRate)) * bar * 100}%`,
            height: "100%",
            background: INK,
          }}
        />
      </div>

      <div
        style={{
          width: 72,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: monoFont,
          fontSize: Math.min(28, rowHeight * 0.26),
          color: INK_2,
          opacity: bar,
        }}
      >
        {pct(row.holdRate)}
      </div>
    </div>
  );
};

const TheBoard: React.FC<Pick<HouseWeeklyProps, "rows">> = ({ rows }) => {
  const frame = useCurrentFrame();
  const stagger = boardRowStagger(rows.length);
  const anyShared = rows.some((r) => r.shared);

  // The rows own the vertical space between the column header and the
  // footnote. Height per row shrinks so a twelve-artist week still fits.
  const rowHeight = Math.min(140, Math.floor(1150 / Math.max(1, rows.length)));

  // Two column headings are not self-explanatory to someone opening this on a
  // phone on a Monday. The legend says what they mean in the artist's own
  // terms, and lands before the board starts moving under it.
  const legendIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Frame label="Ranked by pulled · hold" left="Pulled" right="Hold">
      <div
        style={{
          marginTop: 36,
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          fontFamily: monoFont,
          fontSize: 26,
          lineHeight: 1.5,
          color: GREY,
          opacity: legendIn,
        }}
      >
        <div>
          <span style={{ color: INK }}>PULLED</span> — new faces. People who
          hadn&apos;t watched any Waterhouse stream in the past 30 days. You
          brought them.
        </div>
        <div>
          <span style={{ color: INK }}>HOLD</span> — who stuck around. The share
          of your viewers who stayed for a real stretch of the set, not just a
          drop-in.
        </div>
        <div>
          <span style={{ color: INK }}>PEAK</span> — most people watching at
          once.
        </div>
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
            display: "flex",
            gap: 18,
            paddingBottom: 14,
            borderBottom: `2px solid ${INK}`,
            fontFamily: monoFont,
            fontSize: 24,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: GREY,
            opacity: interpolate(frame, [0, 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <span style={{ width: 48, flexShrink: 0 }}>#</span>
          <span style={{ flex: 1 }}>Artist</span>
          <span style={{ width: 110, flexShrink: 0, textAlign: "right" }}>
            Pulled
          </span>
          <span style={{ width: 90, flexShrink: 0, textAlign: "right" }}>
            Peak
          </span>
          <span
            style={{ width: 150 + 18 + 72, flexShrink: 0, textAlign: "right" }}
          >
            Hold
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((row, i) => (
            <BoardRowLine
              key={`${row.artistName}-${i}`}
              row={row}
              rank={i + 1}
              delay={BOARD_LEAD_IN + i * stagger}
              rowHeight={rowHeight}
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
const BADGE_LABELS: { key: Badge; label: string }[] = [
  { key: "most-pulled", label: "Most pulled" },
  { key: "held-the-room", label: "Held the room" },
  { key: "best-comeback", label: "Best comeback" },
  { key: "stickiest", label: "Stickiest" },
];

// A badge nobody earned still gets its row - the shape of the week is part of
// the information. It reads "—", never an excuse.
const badgeWinner = (rows: BoardRow[], key: Badge): string => {
  const row = rows.find((r) => r.badges.includes(key));
  if (!row) return "—";
  if (key === "best-comeback" && row.deltaUniques !== null) {
    return `${row.artistName} +${row.deltaUniques}`;
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
        padding: "34px 34px",
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
  const winners = new Set(
    rows.filter((r) => r.badges.length > 0).map((r) => r.artistName),
  );

  return (
    <Frame
      label="This week's"
      left="Badges"
      right={`${winners.size} of ${rows.length} win`}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 30,
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
