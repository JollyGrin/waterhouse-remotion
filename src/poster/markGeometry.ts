/**
 * Geometry of the oversized Waterhouse mark used on session posters, kept free
 * of React so the render script can frame artists against it too.
 *
 * These are the real brand mark's shapes, straight out of `public/logo.svg` —
 * the same file the small lockup in the corner uses. That is the point: the mark
 * appears twice on every poster, and both copies have to be the same logo.
 *
 * The hand-made posters stretch their background mark (whole-mark aspect 1.06
 * against the logo's 1.50; house width-to-height 0.42 against 0.53). Copying that
 * distortion was tried and is wrong — it puts a squashed logo next to a correct
 * one on the same artwork. What IS matched to the references is the mark's
 * footprint: same left edge and same width, so it doesn't read as bulkier than
 * the existing covers. It is correspondingly shorter, which is unavoidable once
 * the proportions are honest.
 */

/** The frame every coordinate in this file is expressed in. */
export const MARK_FRAME = 1254;

// --- The brand mark, in logo.svg's own 1000 x 661.5 content box -------------
const LOGO_W = 1000;
const LOGO_H = 661.543;

export type Point = [number, number];

const LOGO_HOUSE: Point[] = [
  [347.883, 0],
  [0.739, 277.589],
  [0.739, 659.145],
  [345.883, 659.145],
];
const LOGO_MIDDLE_BAR: Point[] = [
  [379.63, 44.342],
  [685.184, 144.674],
  [685.184, 283.193],
  [379.629, 200.082],
];
const LOGO_RIGHT_BAR: Point[] = [
  [722.223, 156.654],
  [1000, 248.001],
  [1000, 368.55],
  [722.223, 293.3],
];
const LOGO_STEM: Point[] = [
  [596.561, 393.633],
  [775.132, 434.439],
  [775.132, 661.543],
  [596.561, 661.543],
];

// --- Where the mark sits on the poster --------------------------------------
// Left edge is the references' (their mark starts at 0.194 of the canvas). The
// width is a little past theirs — with honest proportions the mark is shorter
// than the stretched original, and at their exact 0.630 width it left a dead
// black band above and below. 0.70 fills the gap between the header and the
// artist name without reading as bulky.
const MARK_LEFT = 243;
const MARK_WIDTH = 880;
const MARK_TOP = 340;
const MARK_HEIGHT = (MARK_WIDTH / LOGO_W) * LOGO_H;

const place = (pts: Point[]): Point[] =>
  pts.map(([x, y]) => [
    MARK_LEFT + (x / LOGO_W) * MARK_WIDTH,
    MARK_TOP + (y / LOGO_H) * MARK_HEIGHT,
  ]);

export const MARK_PARTS = {
  house: place(LOGO_HOUSE),
  middleBar: place(LOGO_MIDDLE_BAR),
  rightBar: place(LOGO_RIGHT_BAR),
  stem: place(LOGO_STEM),
};

/** Vertical span of the mark, used for the fill gradient. */
export const MARK_TOP_Y = MARK_TOP;
export const MARK_BOTTOM_Y = MARK_TOP + MARK_HEIGHT;

export type MarkPart = keyof typeof MARK_PARTS;
export const ALL_PARTS = Object.keys(MARK_PARTS) as MarkPart[];

export type Bounds = { left: number; right: number; top: number; bottom: number };

/** Bounding box of the given pieces, in the 1254 frame. */
export const partBounds = (parts: MarkPart[]): Bounds => {
  const pts = parts.flatMap((p) => MARK_PARTS[p]);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
};

/**
 * The widest uninterrupted opening across the given pieces at height `y`.
 * The house narrows towards its peak, so the usable width where a face sits is
 * not the same as the bounding box — framing against the box pushes faces into
 * the roof's diagonal.
 */
export const spanAtY = (parts: MarkPart[], y: number): { left: number; right: number } | null => {
  const intervals: Array<[number, number]> = [];
  for (const part of parts) {
    const pts = MARK_PARTS[part];
    const crossings: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      if (y < lo || y >= hi) continue;
      crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      intervals.push([crossings[i], crossings[i + 1]]);
    }
  }
  if (intervals.length === 0) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [intervals[0]];
  for (const [lo, hi] of intervals.slice(1)) {
    const last = merged[merged.length - 1];
    if (lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  const widest = merged.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  return { left: widest[0], right: widest[1] };
};

export const toPath = (parts: Point[][], scale: number) =>
  parts
    .map(
      (pts) =>
        pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x * scale},${y * scale}`).join(" ") + " Z"
    )
    .join(" ");

/**
 * A CSS `clip-path` cutting a canvas-sized element down to the given pieces of
 * the mark, so the artist photo is framed by the logo rather than laid over it.
 */
export const markClipPath = (canvasWidth: number, parts: MarkPart[]) =>
  `path("${toPath(
    parts.map((p) => MARK_PARTS[p]),
    canvasWidth / MARK_FRAME
  )}")`;
