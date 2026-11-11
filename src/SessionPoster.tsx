/**
 * Waterhouse Radio session cover — the square artwork that fronts each
 * SoundCloud mix.
 *
 * Every measurement below was taken off the existing hand-made posters (all
 * 1254 x 1254) and is expressed in that reference frame, so the layout scales
 * to any square canvas. See REF_* constants for what was measured where.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { z } from "zod";
import { fitText } from "@remotion/layout-utils";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadFjalla } from "@remotion/google-fonts/FjallaOne";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { WaterhouseMark } from "./poster/WaterhouseMark";
import { markClipPath, type MarkPart } from "./poster/markGeometry";
import { Grain } from "./poster/Grain";

const { fontFamily: anton } = loadAnton();
export { anton };
const { fontFamily: oswald } = loadOswald("normal", {
  weights: ["700"],
  subsets: ["latin"],
});
const { fontFamily: fjalla } = loadFjalla();
const { fontFamily: inter } = loadInter("normal", {
  weights: ["600"],
  subsets: ["latin"],
});
export { inter };

/** The reference posters are 1254px square; every constant below is in that frame. */
export const REF = 1254;

// --- Measured layout, in reference pixels ---------------------------------
export const MARGIN = 64; // left inset, consistent across all seven references
export const LOCKUP_MARK_WIDTH = 146; // top-left logo, uses public/logo.svg proportions
export const LOCKUP_MARK_TOP = 62;
export const WORDMARK_TOP = 193; // cap-top of "WATERHOUSE"
export const SMALL_TEXT_SIZE = 24;
export const SMALL_TEXT_TRACKING = 0.27; // em
export const SESSION_RIGHT = 40; // trailing letter-space puts the last glyph at x=1209
export const SESSION_TOP = 89; // cap-top of "SESSION 0NN"
export const NAME_BASELINE = 1171;
/**
 * Matched to DUKRI/NORBESS (session 011), the most recent hand-made cover.
 * The set is not self-consistent here: DENZO (010) sets its name at a 174px cap
 * against DUKRI's 140. Letter widths agree far better — 0.503 vs 0.457 of cap
 * per character — so the difference is size, not typeface.
 */
export const NAME_CAP_HEIGHT = 140;
export const DATE_TOP = 1192; // cap-top of the date line
export const DATE_SIZE = 27.8;
export const DATE_TRACKING = 0.18; // em

/**
 * CSS positions a text box by its em-box top, not by the cap-top we measured off
 * the references. These are the measured gaps between the two, as a fraction of
 * font size, calibrated by rendering and re-measuring (see scripts/calibrate.ts).
 */
export const CAP_TOP_TRIM: Record<string, number> = {
  inter: 0.1875,
  anton: 0.057,
  fjalla: 0.04,
  oswald: 0.09,
};

// --- Measured colours ------------------------------------------------------
export const INK = "#DEDEDE"; // lockup, wordmark, session number, date (measured ~222)
export const NAME_INK = "#C0C0C0"; // artist name (measured ~192)

/**
 * Rendered cap height as a fraction of font size. Measured off actual renders
 * rather than taken from the font's declared metrics — the two disagree, and
 * only the rendered value gets the name to the reference's 173px cap height.
 * Anton matches the reference's letter width almost exactly (2.56 vs 2.62
 * width-per-cap on "DENZO"); Fjalla One is the closest alternative.
 */
export const CAP_RATIO: Record<NameFont, number> = {
  anton: 0.871,
  fjalla: 0.887,
  oswald: 0.895,
};

/** Left sidebearing of the first glyph, as a fraction of font size. */
export const NAME_LEFT_TRIM: Record<NameFont, number> = {
  anton: 0.037,
  fjalla: 0.072,
  oswald: 0.064,
};

const NAME_FONTS = ["anton", "fjalla", "oswald"] as const;
const PHOTO_MODES = ["front", "window", "window-full"] as const;
type PhotoMode = (typeof PHOTO_MODES)[number];

/** Which pieces of the mark act as the window, per mode. */
const WINDOW_PARTS: Record<PhotoMode, MarkPart[] | null> = {
  front: null,
  window: ["house"],
  "window-full": ["house", "middleBar", "rightBar", "stem"],
};
type NameFont = (typeof NAME_FONTS)[number];

const NAME_FAMILY: Record<NameFont, string> = { anton, fjalla, oswald };

const NAME_WEIGHT: Record<NameFont, number> = {
  anton: 400, // Anton and Fjalla One each ship a single weight
  fjalla: 400,
  oswald: 700,
};

export const SessionPosterSchema = z.object({
  artistName: z.string(),
  sessionNumber: z.number().int().min(0).max(999),
  /** Rendered verbatim, e.g. "30.7.2026". */
  dateLabel: z.string(),
  /** Path inside public/, e.g. "artists/timo-feyman.png". Expects a cut-out PNG. */
  photo: z.string(),
  /** Subject height as a fraction of the canvas. */
  photoScale: z.number().min(0.1).max(2),
  /** Nudges, as fractions of the canvas. Positive is right / down. */
  photoOffsetX: z.number(),
  photoOffsetY: z.number(),
  /**
   * How the photo meets the mark.
   *  - "front":  artist over the mark, the way the hand-made posters do it.
   *  - "window": artist seen only through the house, bars left solid.
   *  - "window-full": artist seen only through the house and both bars.
   */
  photoMode: z.enum(PHOTO_MODES).default("front"),
  /**
   * Fade the bottom of the photo out over this fraction of its height. A crop
   * that stops above the canvas edge otherwise ends on a hard horizontal line —
   * the reference posters never show one, because their subjects run off the
   * bottom of the frame.
   */
  photoBottomFade: z.number().min(0).max(1).default(0),
  nameFont: z.enum(NAME_FONTS),
  grainOpacity: z.number().min(0).max(1),
  /** Calibration aid: drop the mark, photo and grain so type can be measured. */
  typeOnly: z.boolean().optional(),
});

export type SessionPosterProps = z.infer<typeof SessionPosterSchema>;

export const SessionPoster: React.FC<SessionPosterProps> = ({
  artistName,
  sessionNumber,
  dateLabel,
  photo,
  photoScale,
  photoOffsetX,
  photoOffsetY,
  photoMode = "front",
  photoBottomFade = 0,
  nameFont,
  grainOpacity,
  typeOnly = false,
}) => {
  const { width, height } = useVideoConfig();
  /** Reference pixels -> canvas pixels. */
  const u = (refPx: number) => (refPx / REF) * width;

  const windowParts = WINDOW_PARTS[photoMode];
  const name = artistName.toUpperCase();
  const family = NAME_FAMILY[nameFont];
  const weight = NAME_WEIGHT[nameFont];

  // Hold the measured cap height unless the name is too long to fit, in which
  // case shrink to the margins. The references never needed this — DUKRI/NORBESS
  // at 13 characters only just fits — but longer billings exist.
  const idealSize = u(NAME_CAP_HEIGHT) / CAP_RATIO[nameFont];
  const fitted = fitText({
    text: name,
    withinWidth: width - 2 * u(MARGIN),
    fontFamily: family,
    fontWeight: weight,
    textTransform: "uppercase",
  });
  const nameSize = Math.min(idealSize, fitted.fontSize);

  /** Turn a measured cap-top into the `top` CSS a text box needs. */
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

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {typeOnly ? null : (
        <AbsoluteFill>
          <WaterhouseMark />
        </AbsoluteFill>
      )}

      {/* The clip lives on a canvas-sized wrapper, so its coordinates are the
          poster's rather than the photo element's. */}
      <AbsoluteFill
        style={{
          clipPath: windowParts ? markClipPath(width, windowParts) : undefined,
        }}
      >
        <Img
          src={staticFile(photo)}
          hidden={typeOnly}
          style={{
            position: "absolute",
            height: photoScale * height,
            left: "50%",
            bottom: -photoOffsetY * height,
            transform: `translateX(calc(-50% + ${photoOffsetX * width}px))`,
            // Desaturate only. No contrast or brightness curve: the artist's own
            // photo should reach the poster with its pixels untouched, and every
            // reference photo is already black and white.
            filter: "grayscale(1)",
            maskImage: photoBottomFade
              ? `linear-gradient(to bottom, #000 ${(1 - photoBottomFade) * 100}%, transparent 100%)`
              : undefined,
          }}
        />
      </AbsoluteFill>

      {/* Top-left lockup. logo.svg is solid black, so invert it to the measured ink. */}
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
        style={{
          ...smallText,
          position: "absolute",
          left: u(MARGIN),
          top: capTop(WORDMARK_TOP, u(SMALL_TEXT_SIZE), "inter"),
        }}
      >
        {"WATERHOUSE\nRADIO"}
      </div>

      <div
        style={{
          ...smallText,
          position: "absolute",
          right: u(SESSION_RIGHT),
          top: capTop(SESSION_TOP, u(SMALL_TEXT_SIZE), "inter"),
        }}
      >
        {`SESSION ${String(sessionNumber).padStart(3, "0")}`}
      </div>

      <div
        style={{
          position: "absolute",
          left: u(MARGIN) - NAME_LEFT_TRIM[nameFont] * nameSize,
          top: capTop(NAME_BASELINE - NAME_CAP_HEIGHT, nameSize, nameFont),
          fontFamily: family,
          fontWeight: weight,
          fontSize: nameSize,
          lineHeight: 1,
          color: NAME_INK,
          whiteSpace: "pre",
        }}
      >
        {name}
      </div>

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

      <Grain opacity={typeOnly ? 0 : grainOpacity} />
    </AbsoluteFill>
  );
};
