/**
 * Works out where an artist photo has to sit so the person reads well inside the
 * Waterhouse mark — which is the whole trick, because every artist photo is
 * framed differently and the logo's window is a tall, narrow opening.
 *
 * Driven by the face rectangle Vision reports, so the answer follows the subject
 * rather than the edges of whatever crop the artist sent.
 */

import {
  MARK_FRAME,
  partBounds,
  spanAtY,
  type Bounds,
  type MarkPart,
} from "../src/poster/markGeometry";

export type Box = { x: number; y: number; width: number; height: number; confidence?: number };

/**
 * How far the photo may be enlarged beyond the face-driven size in order to fill
 * the window. Without a ceiling, a photo whose face sits near the top edge would
 * be blown up until the head no longer fits the opening.
 */
const MAX_COVER_GROWTH = 1.8;

/**
 * A laid-over subject should reach the bottom of the canvas the way every
 * reference poster's does. A tight head crop can't, so it is enlarged towards
 * the edge — but only until the face reaches this share of the canvas, past
 * which the artist swamps the logo.
 */
const MAX_FRONT_FACE = 0.38;

/** Faces smaller than this share of the widest one are background or false hits. */
const MIN_RELATIVE_FACE = 0.5;

export type Framing = { photoScale: number; photoOffsetX: number; photoOffsetY: number };

export type ModeName = "front" | "window" | "window-full";

type Recipe = {
  /** Which pieces of the mark the photo shows through (null = laid over it). */
  window: MarkPart[] | null;
  /** Face width as a fraction of the target area's width. */
  faceFill: number;
  /** Where the face centre sits vertically within the target area, 0 = top. */
  faceY: number;
  /** Where the face centre sits horizontally, 0.5 = centred. */
  faceX: number;
};

export const RECIPES: Record<ModeName, Recipe> = {
  // Laid over the mark, exactly as the hand-made posters do it. These three
  // numbers are not taste — they are measured off the DENZO poster (session 010)
  // by running the same face detector over the finished artwork: the face is
  // 24.5% of the canvas wide, centred at 52.8% across and 55.5% down.
  front: { window: null, faceFill: 0.245, faceY: 0.555, faceX: 0.528 },
  // Seen through the house. The opening is 315 x 727 — so tall and narrow that a
  // roughly square photo scaled to fill it top to bottom ends up 2.4x the
  // opening's width, which pushes the face straight out through the side walls.
  // So the photo fills the window's *width* only, sits in the upper half, and
  // fades into the grey house below (see photoBottomFade). The face takes most
  // of the width, because at this size anything less is unrecognisable.
  window: { window: ["house"], faceFill: 0.95, faceY: 0.53, faceX: 0.5 },
  // Seen through the whole mark. Much wider, so the face takes proportionally
  // less of it.
  "window-full": {
    window: ["house", "middleBar", "rightBar", "stem"],
    faceFill: 0.3,
    faceY: 0.36,
    faceX: 0.45,
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Union of the faces worth framing on. Vision happily reports faces in a crowd
 * behind the DJ booth, so anything much smaller than the biggest face, or that
 * Vision itself is unsure about, is dropped first.
 */
export function keptFaces(faces: Box[]): Box[] {
  const confident = faces.filter((f) => (f.confidence ?? 1) >= 0.4);
  if (confident.length === 0) return [];
  const widest = Math.max(...confident.map((f) => f.width));
  return confident.filter((f) => f.width >= MIN_RELATIVE_FACE * widest);
}

export function faceUnion(faces: Box[]): Box | null {
  return unionOf(keptFaces(faces));
}

function unionOf(faces: Box[]): Box | null {
  if (faces.length === 0) return null;
  const left = Math.min(...faces.map((f) => f.x));
  const top = Math.min(...faces.map((f) => f.y));
  const right = Math.max(...faces.map((f) => f.x + f.width));
  const bottom = Math.max(...faces.map((f) => f.y + f.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * When Vision finds no face — a logo card, a back-turned shot, a wide crowd — fall
 * back to treating the upper part of the subject as if it were the head. Crude,
 * but it keeps the subject in the window instead of centring dead space.
 */
const assumedFace = (photo: Box): Box => ({
  x: photo.width * 0.3,
  y: photo.height * 0.08,
  width: photo.width * 0.4,
  height: photo.width * 0.4,
});

/**
 * Whether a source photo can carry a poster at all. The calendar's
 * profile_image_url is a mixed bag — some artists have a proper portrait, others
 * have an Instagram screenshot or a wide shot of the booth — and no amount of
 * framing rescues those. Better to say so than to ship a bad cover.
 */
export function assessPhoto(
  photo: { width: number; height: number },
  faces: Box[]
): { ok: boolean; reason?: string } {
  const kept = keptFaces(faces);
  if (kept.length === 0) {
    return { ok: false, reason: "no face found — is this a portrait?" };
  }
  // Judge on the biggest single face, not their combined span: three small faces
  // spread across a club shot cover most of the frame between them while each one
  // is still far too small to recognise.
  const share = Math.max(...kept.map((f) => f.width)) / photo.width;
  if (share < 0.12) {
    return {
      ok: false,
      reason: `the largest face is only ${Math.round(share * 100)}% of the photo's width — this looks like a wide or group shot, and the artist will be unrecognisable in the logo window`,
    };
  }
  return { ok: true };
}

export function computeFraming(
  mode: ModeName,
  photo: { width: number; height: number },
  face: Box | null
): Framing {
  const recipe = RECIPES[mode];
  const target: Bounds = recipe.window
    ? partBounds(recipe.window)
    : { left: 0, top: 0, right: MARK_FRAME, bottom: MARK_FRAME };
  const head = face ?? assumedFace({ x: 0, y: 0, ...photo });

  const areaW = target.right - target.left;
  const areaH = target.bottom - target.top;

  // Measure the opening at the height the face will sit at, not across the whole
  // bounding box — the house tapers, and framing on the box shoves faces up into
  // the roof's diagonal.
  const faceCy = target.top + recipe.faceY * areaH;
  const span = recipe.window ? spanAtY(recipe.window, faceCy) : null;
  const spanW = span ? span.right - span.left : areaW;
  const spanCx = span ? (span.left + span.right) / 2 : target.left + recipe.faceX * areaW;

  // Size the photo so the face occupies the intended share of the opening.
  let renderW = (recipe.faceFill * spanW) / (head.width / photo.width);
  let renderH = (renderW * photo.height) / photo.width;

  // Where the face sits within the photo. Clamped off the edges so a face at the
  // very top or side can't send the coverage arithmetic to infinity.
  const fx = clamp((head.x + head.width / 2) / photo.width, 0.08, 0.92);
  const fy = clamp((head.y + head.height / 2) / photo.height, 0.08, 0.92);

  const faceCx = recipe.window ? spanCx : target.left + recipe.faceX * areaW;

  // Cover the window's width, growing about the face so it keeps its position.
  // Height is deliberately not covered: forcing that is what blew the face out
  // through the side walls. The grey house fills whatever is left below.
  if (recipe.window) {
    const needW = Math.max((faceCx - target.left) / fx, (target.right - faceCx) / (1 - fx));
    const k = clamp(needW / renderW, 1, MAX_COVER_GROWTH);
    renderW *= k;
    renderH *= k;
  }

  if (!recipe.window) {
    // Grow a short crop towards the bottom edge, about the face so it keeps its
    // position, and stop before the face outgrows the mark behind it.
    const bottom = faceCy + (1 - fy) * renderH;
    if (bottom < MARK_FRAME) {
      const wanted = (MARK_FRAME - faceCy) / (1 - fy) / renderH;
      const ceiling = (MAX_FRONT_FACE * MARK_FRAME) / (recipe.faceFill * MARK_FRAME);
      const k = clamp(wanted, 1, ceiling);
      renderW *= k;
      renderH *= k;
    }
  }

  const left = faceCx - fx * renderW;
  const top = faceCy - fy * renderH;

  return {
    photoScale: renderH / MARK_FRAME,
    photoOffsetX: (left + renderW / 2 - MARK_FRAME / 2) / MARK_FRAME,
    photoOffsetY: (top + renderH - MARK_FRAME) / MARK_FRAME,
  };
}
