/**
 * Vertical promo reel cut out of a finished session episode.
 *
 * The episode is a locked-off wide two-shot, so there is no 9:16 crop of the whole
 * frame that holds both men — a centre crop lands on the empty floor between them.
 * The reel therefore punches in on whoever is talking and cuts between them, which
 * is also what makes it read as an edit rather than a clipped-out lump of podcast.
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** The source these crops are measured against. */
export const SOURCE = { width: 1920, height: 1080 };

/**
 * Crop windows into the source, in source pixels. All are 9:16 so they scale to the
 * canvas with no letterboxing.
 *
 * `y` never runs to the full 1080: the livestream capture has a now-playing ticker
 * burned into its bottom ~30px, and it is not wanted here.
 *
 * Two framings per person, alternated on consecutive segments. Adjacent segments of
 * the same speaker are jump cuts — same camera, same chair — and swapping the framing
 * is what lets them read as a cut to a second angle instead of a glitch.
 */
export const SHOTS = {
  froA:  { x: 364, y: 95, width: 534, height: 950 },
  froB:  { x: 396, y: 130, width: 470, height: 836 },
  hostA: { x: 988, y: 95, width: 534, height: 950 },
  hostB: { x: 1020, y: 130, width: 470, height: 836 },
  // Boogie episode: the chairs swap sides. The host sits left and Boogie right, with
  // his head ~90px further right than Fro's host was. Boogie's crops stop at x1614, clear
  // of the burned-in "BOOGIE" name tag at x1660.
  leftHostA: { x: 380, y: 95, width: 534, height: 950 },
  leftHostB: { x: 420, y: 130, width: 470, height: 836 },
  boogieA: { x: 1080, y: 95, width: 534, height: 950 },
  boogieB: { x: 1110, y: 130, width: 470, height: 836 },
} as const;

export type ShotName = keyof typeof SHOTS;

/**
 * A slow push over each segment. The camera never moves in the source, and on a
 * vertical crop of a static wide shot that stillness reads as a freeze-frame after a
 * few seconds. 4% over the segment is enough to feel alive and small enough that it
 * never looks like a zoom.
 */
export const PUSH = 1.04;

/**
 * Captions sit clear of Instagram's own furniture: the caption/CTA block eats roughly
 * the bottom 420px of the frame and the action rail the right ~120px. Anything below
 * y1500 is liable to be covered on someone's phone.
 */
export const CAPTIONS = {
  fontSize: 60,
  fontWeight: 800,
  lineHeight: 1.22,
  /** Vertical centre of the caption block. */
  centreY: 1330,
  /** Widest a line may run before it wraps. */
  maxWidth: 880,
  /** Lines per page; a third line pushes into Instagram's UI. */
  maxLines: 2,
  activeBackground: "#2b9bf4",
  upcomingOpacity: 0.5,
  wordGap: 14,
  boxPaddingX: 12,
  boxPaddingY: 5,
  boxRadius: 7,
};

/** The channel bug, top-left, clear of Instagram's top furniture. */
export const BUG = { top: 96, left: 72, width: 132, opacity: 0.9 };

/** Lowest source row any crop may reach. Below this is the burned-in ticker. */
export const TICKER_TOP = 1046;

/** Seconds of end card after the last frame of picture. */
export const END_CARD_SECONDS = 1.6;
