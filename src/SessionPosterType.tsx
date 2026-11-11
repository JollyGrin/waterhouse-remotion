/**
 * Type-only session cover: no artist photo.
 *
 * Every failure mode on the photo version came from the source images — portal
 * screenshots, club shots with unusable faces, small originals stretched 4x. With
 * the artwork carried entirely by type and the mark, a new cover is name + number
 * + date, and every one is identical by construction.
 *
 * Three directions, chosen with `variant`. All of them keep the header, the
 * artist name and the date exactly where the hand-made covers put them, so these
 * sit alongside the existing eleven.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { z } from "zod";
import { fitText } from "@remotion/layout-utils";
import { Grain } from "./poster/Grain";
import { MARK_PARTS, ALL_PARTS, MARK_FRAME, toPath, partBounds } from "./poster/markGeometry";
import {
  anton,
  inter,
  CAP_RATIO,
  CAP_TOP_TRIM,
  DATE_SIZE,
  DATE_TOP,
  DATE_TRACKING,
  INK,
  LOCKUP_MARK_TOP,
  LOCKUP_MARK_WIDTH,
  MARGIN,
  NAME_BASELINE,
  NAME_CAP_HEIGHT,
  NAME_INK,
  NAME_LEFT_TRIM,
  REF,
  SESSION_RIGHT,
  SESSION_TOP,
  SMALL_TEXT_SIZE,
  SMALL_TEXT_TRACKING,
  WORDMARK_TOP,
} from "./SessionPoster";

export const TYPE_VARIANTS = ["blueprint", "wall", "stencil"] as const;

export const SessionPosterTypeSchema = z.object({
  artistName: z.string(),
  sessionNumber: z.number().int().min(0).max(999),
  dateLabel: z.string(),
  variant: z.enum(TYPE_VARIANTS),
  grainOpacity: z.number().min(0).max(1),
});

export type SessionPosterTypeProps = z.infer<typeof SessionPosterTypeSchema>;

export const SessionPosterType: React.FC<SessionPosterTypeProps> = ({
  artistName,
  sessionNumber,
  dateLabel,
  variant,
  grainOpacity,
}) => {
  const { width } = useVideoConfig();
  const u = (refPx: number) => (refPx / REF) * width;
  const name = artistName.toUpperCase();
  const session = `SESSION ${String(sessionNumber).padStart(3, "0")}`;

  const idealSize = u(NAME_CAP_HEIGHT) / CAP_RATIO.anton;
  const fitted = fitText({
    text: name,
    withinWidth: width - 2 * u(MARGIN),
    fontFamily: anton,
    fontWeight: 400,
    textTransform: "uppercase",
  });
  const nameSize = Math.min(idealSize, fitted.fontSize);
  const capTop = (refCapTop: number, fontSize: number, face: string) =>
    u(refCapTop) - CAP_TOP_TRIM[face] * fontSize;

  const smallText: React.CSSProperties = {
    fontFamily: inter,
    fontWeight: 600,
    fontSize: u(SMALL_TEXT_SIZE),
    letterSpacing: `${SMALL_TEXT_TRACKING}em`,
    color: INK,
    lineHeight: 1.1,
    whiteSpace: "pre",
  };

  // The stencil variant sets the name across the mark, so it is sized to the
  // mark's width rather than the canvas's.
  const stencilSize = fitText({
    text: name,
    withinWidth: u(880) * 0.84,
    fontFamily: anton,
    fontWeight: 400,
    textTransform: "uppercase",
  }).fontSize;

  const markPath = toPath(
    ALL_PARTS.map((p) => MARK_PARTS[p]),
    1
  );
  const bounds = partBounds(ALL_PARTS);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {variant === "blueprint" ? (
        <Blueprint markPath={markPath} />
      ) : null}
      {variant === "wall" ? (
        <>
          <svg
            viewBox={`0 0 ${MARK_FRAME} ${MARK_FRAME}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          >
            <path d={markPath} fill="#151515" />
          </svg>
          <Wall name={name} u={u} width={width} />
        </>
      ) : null}
      {variant === "stencil" ? (
        <Stencil markPath={markPath} bounds={bounds} name={name} nameSize={stencilSize} />
      ) : null}

      {/* Header, identical to the photo covers. */}
      <Img
        src={staticFile("logo.svg")}
        style={{
          position: "absolute",
          left: u(MARGIN),
          top: u(LOCKUP_MARK_TOP),
          width: u(LOCKUP_MARK_WIDTH),
          filter: "invert(1) brightness(0.871)",
        }}
      />
      <div
        style={{ ...smallText, position: "absolute", left: u(MARGIN), top: capTop(WORDMARK_TOP, u(SMALL_TEXT_SIZE), "inter") }}
      >
        {"WATERHOUSE\nRADIO"}
      </div>
      <div
        style={{ ...smallText, position: "absolute", right: u(SESSION_RIGHT), top: capTop(SESSION_TOP, u(SMALL_TEXT_SIZE), "inter") }}
      >
        {session}
      </div>

      {/* Only the blueprint sets the name in the usual bottom-left slot. The wall
          builds it into the field of repeats and the stencil runs it across the
          mark, so repeating it there would just be a duplicate. */}
      {variant === "blueprint" ? (
        <div
          style={{
            position: "absolute",
            left: u(MARGIN) - NAME_LEFT_TRIM.anton * nameSize,
            top: capTop(NAME_BASELINE - NAME_CAP_HEIGHT, nameSize, "anton"),
            fontFamily: anton,
            fontSize: nameSize,
            lineHeight: 1,
            color: NAME_INK,
            whiteSpace: "pre",
          }}
        >
          {name}
        </div>
      ) : null}

      <div
        style={{
          ...smallText,
          position: "absolute",
          left: u(MARGIN),
          top: capTop(DATE_TOP, u(DATE_SIZE), "inter"),
          fontSize: u(DATE_SIZE),
          letterSpacing: `${DATE_TRACKING}em`,
        }}
      >
        {dateLabel}
      </div>

      <Grain opacity={grainOpacity} />
    </AbsoluteFill>
  );
};

/**
 * Architectural drawing: the mark as a wireframe over a measured grid.
 *
 * Two grid weights, the heavier every fourth line, which is how a real plan is
 * ruled — and it also survives being scaled down to a feed thumbnail, where a
 * single uniform grid turns to mush. Crop marks sit on the same 64px margin the
 * rest of the layout uses, so they read as registration rather than decoration.
 */
const GRID_STEP = MARK_FRAME / 18;

const Blueprint: React.FC<{ markPath: string }> = ({ markPath }) => {
  const lines = Array.from({ length: 19 }, (_, i) => i);
  const isMajor = (i: number) => i % 4 === 0;
  // Outside the 64px content margin, so they never crowd the lockup or the date.
  const tick = 22;
  const m = 34;
  const far = MARK_FRAME - m;
  return (
    <svg
      viewBox={`0 0 ${MARK_FRAME} ${MARK_FRAME}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <g>
        {lines.map((i) => (
          <line
            key={`v${i}`}
            x1={i * GRID_STEP}
            y1={0}
            x2={i * GRID_STEP}
            y2={MARK_FRAME}
            stroke={isMajor(i) ? "#2E3338" : "#1D2023"}
            strokeWidth={isMajor(i) ? 1.6 : 1}
          />
        ))}
        {lines.map((i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={i * GRID_STEP}
            x2={MARK_FRAME}
            y2={i * GRID_STEP}
            stroke={isMajor(i) ? "#2E3338" : "#1D2023"}
            strokeWidth={isMajor(i) ? 1.6 : 1}
          />
        ))}
      </g>
      {/* Registration marks, set outside the content margin. */}
      <g stroke="#4A5055" strokeWidth="2">
        <line x1={m} y1={m - tick} x2={m} y2={m} />
        <line x1={m - tick} y1={m} x2={m} y2={m} />
        <line x1={far} y1={m - tick} x2={far} y2={m} />
        <line x1={far + tick} y1={m} x2={far} y2={m} />
        <line x1={m} y1={far + tick} x2={m} y2={far} />
        <line x1={m - tick} y1={far} x2={m} y2={far} />
        <line x1={far} y1={far + tick} x2={far} y2={far} />
        <line x1={far + tick} y1={far} x2={far} y2={far} />
      </g>
      {/* A faint wash inside the outline keeps the mark reading as a solid object
          at small sizes, where a hairline alone disappears. */}
      <path d={markPath} fill="#D2D2D2" opacity="0.06" />
      <path d={markPath} fill="none" stroke="#D8D8D8" strokeWidth="3.4" strokeLinejoin="miter" />
    </svg>
  );
};

/** Rave-flyer wall: the name repeated until it becomes a texture. */
const Wall: React.FC<{
  name: string;
  u: (n: number) => number;
  width: number;
}> = ({ name, u, width }) => {
  const rowCap = u(96);
  const size = rowCap / CAP_RATIO.anton;
  const step = rowCap * 1.28;
  const rows = Math.ceil((u(1040) - u(300)) / step);
  const hero = Math.floor(rows * 0.62);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: u(MARGIN) - NAME_LEFT_TRIM.anton * size,
            top: u(300) + i * step,
            fontFamily: anton,
            fontSize: size,
            lineHeight: 1,
            whiteSpace: "pre",
            color: i === hero ? NAME_INK : "#1C1C1C",
            width: width * 2,
          }}
        >
          {name}
        </div>
      ))}
    </div>
  );
};

/**
 * Screen-print inversion: one line of type runs straight across the mark. Where
 * it crosses the solid it is punched out to black; where it runs off onto the
 * background it flips to light. Two layers with complementary masks.
 */
const Stencil: React.FC<{
  markPath: string;
  bounds: { left: number; right: number; top: number; bottom: number };
  name: string;
  nameSize: number;
}> = ({ markPath, bounds, name, nameSize }) => {
  const cx = (bounds.left + bounds.right) / 2;
  const cy = bounds.top + (bounds.bottom - bounds.top) * 0.62;
  const size = nameSize / (2000 / MARK_FRAME);
  const label = (extra: React.SVGProps<SVGTextElement>) => (
    <text
      x={cx}
      y={cy}
      fontFamily={anton}
      fontSize={size}
      textAnchor="middle"
      dominantBaseline="central"
      {...extra}
    >
      {name}
    </text>
  );
  return (
    <svg
      viewBox={`0 0 ${MARK_FRAME} ${MARK_FRAME}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <defs>
        <mask id="wh-cut">
          <rect width={MARK_FRAME} height={MARK_FRAME} fill="white" />
          {label({ fill: "black" })}
        </mask>
        <mask id="wh-outside">
          <rect width={MARK_FRAME} height={MARK_FRAME} fill="white" />
          <path d={markPath} fill="black" />
        </mask>
      </defs>
      <path d={markPath} fill="#C4C4C4" mask="url(#wh-cut)" />
      <g mask="url(#wh-outside)">{label({ fill: NAME_INK })}</g>
    </svg>
  );
};
