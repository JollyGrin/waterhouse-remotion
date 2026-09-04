/**
 * How a photo hangs in the stream window.
 *
 * The window is landscape (820x560) while artist photos are mostly portrait,
 * so a plain `cover` crop has to throw away most of the height. Anchoring at
 * `center top` works for a full-body or waist-up shot and fails badly for a
 * tight headshot - Denzo's profile photo rendered as forehead and glasses
 * with the mouth outside the frame entirely.
 *
 * The rule is decided from the photo's own shape, nothing else:
 *
 *   - portrait (taller than it is wide) -> `contain`, centred, over a
 *     blurred and darkened copy of itself, so nothing is ever cut;
 *   - landscape or square -> `cover`, centred, which loses only the edges of
 *     an image that already suits the window.
 *
 * The composition measures each photo as it loads (src/PullUp.tsx), so this
 * needs no image decoding, no preflight and no extra dependency.
 */

export type Fit = "cover" | "contain";

/** The stream window in src/PullUp.tsx. Shared so the two cannot drift. */
export const PLAYER_FRAME = { width: 820, height: 560 };
/** Its two halves when a shared booking puts a bill side by side (2px rule). */
export const PANEL_FRAME = { width: (PLAYER_FRAME.width - 2) / 2, height: 560 };

/** What a photo does before it has been measured. */
export const DEFAULT_FIT: Fit = "cover";

/**
 * The rule, from an image's natural pixel dimensions. Anything not yet
 * measured - a zero, a NaN, an image still loading - covers, which is what
 * the window did before any of this existed.
 */
export function fitFor(naturalWidth: number, naturalHeight: number): Fit {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return DEFAULT_FIT;
  return naturalHeight > naturalWidth ? "contain" : "cover";
}
