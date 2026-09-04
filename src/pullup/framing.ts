/**
 * Face-aware framing for the stream window.
 *
 * The window is 16:9-ish while artist photos are mostly portrait, so a plain
 * `cover` crop has to throw away most of the height. Anchoring at `center
 * top` works for a full-body or waist-up shot and fails badly for a tight
 * headshot - Denzo's profile photo rendered as forehead and glasses with the
 * eyes cut off.
 *
 * Given a detected face box (scripts/face-detect.ts, or none at all) this
 * works out how to hang the photo in the window:
 *
 *   - the face plus headroom fits inside the cover crop -> `cover` with the
 *     crop slid onto the face,
 *   - it does not fit -> `contain`, so nothing is cut, over a blurred and
 *     darkened copy of the same photo,
 *   - no face detected -> `center top`, exactly as before.
 *
 * Pure maths, no image decoding: the composition and `bun test` both use it.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Framing {
  fit: "cover" | "contain";
  /** A CSS object-position, always in `X% Y%` form. */
  position: string;
}

/** The stream window in src/PullUp.tsx. Shared so the two cannot drift. */
export const PLAYER_FRAME = { width: 820, height: 560 };
/** Its two halves when a shared booking puts a bill side by side (2px rule). */
export const PANEL_FRAME = { width: (PLAYER_FRAME.width - 2) / 2, height: 560 };

export const PLAYER_ASPECT = PLAYER_FRAME.width / PLAYER_FRAME.height;
export const PANEL_ASPECT = PANEL_FRAME.width / PANEL_FRAME.height;

// Breathing room around the detected box, as a share of the face's own size.
// A detector's box lands on the eyes-to-lips region: it cuts hair, forehead
// and usually part of the chin, so keeping only the box still looks cropped.
export const HEADROOM = 0.15;
export const CHINROOM = 0.1;
export const SIDEROOM = 0.06;

// What the composition does when it is handed no framing at all.
export const DEFAULT_FRAMING: Framing = { fit: "cover", position: "50% 0%" };

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** The face box grown by the margins above, clipped to the image. */
export function safeBox(
  face: Box,
  imageWidth: number,
  imageHeight: number,
): Box {
  const left = clamp(face.x - face.width * SIDEROOM, 0, imageWidth);
  const right = clamp(face.x + face.width * (1 + SIDEROOM), 0, imageWidth);
  const top = clamp(face.y - face.height * HEADROOM, 0, imageHeight);
  const bottom = clamp(face.y + face.height * (1 + CHINROOM), 0, imageHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The part of the source image an `object-fit` box actually shows, in source
 * pixels. `contain` shows all of it; `cover` shows the largest sub-rectangle
 * of the target's aspect, slid by `position`.
 */
export function visibleSourceBox(
  framing: Framing,
  imageWidth: number,
  imageHeight: number,
  targetAspect: number,
): Box {
  if (framing.fit === "contain") {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }
  const width = Math.min(imageWidth, imageHeight * targetAspect);
  const height = Math.min(imageHeight, imageWidth / targetAspect);
  const [px, py] = framing.position
    .split(/\s+/)
    .map((p) => parseFloat(p) / 100);
  return {
    x: (imageWidth - width) * (px || 0),
    y: (imageHeight - height) * (py || 0),
    width,
    height,
  };
}

export function boxContains(outer: Box, inner: Box, epsilon = 0.5): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

export interface FrameFaceInput {
  imageWidth: number;
  imageHeight: number;
  /** null when the detector found nobody, or was not available at all. */
  face: Box | null;
  targetAspect: number;
}

export function frameFace({
  imageWidth,
  imageHeight,
  face,
  targetAspect,
}: FrameFaceInput): Framing {
  if (!face || imageWidth <= 0 || imageHeight <= 0) {
    return DEFAULT_FRAMING;
  }

  const safe = safeBox(face, imageWidth, imageHeight);

  // The cover crop, in source pixels.
  const windowWidth = Math.min(imageWidth, imageHeight * targetAspect);
  const windowHeight = Math.min(imageHeight, imageWidth / targetAspect);

  // A headshot that fills the frame cannot be cropped to 16:9 without losing
  // the top or the bottom of the face. Show the whole photo instead.
  if (safe.width > windowWidth + 0.5 || safe.height > windowHeight + 0.5) {
    return { fit: "contain", position: "50% 50%" };
  }

  // Centre the safe box in the crop. Slack ends up split evenly above and
  // below it, so the requested headroom is a floor, never a ceiling.
  const slackX = imageWidth - windowWidth;
  const slackY = imageHeight - windowHeight;
  const offsetX = clamp(safe.x + safe.width / 2 - windowWidth / 2, 0, slackX);
  const offsetY = clamp(safe.y + safe.height / 2 - windowHeight / 2, 0, slackY);

  return {
    fit: "cover",
    position: `${pct(slackX < 0.5 ? 50 : (offsetX / slackX) * 100)} ${pct(
      slackY < 0.5 ? 50 : (offsetY / slackY) * 100,
    )}`,
  };
}
