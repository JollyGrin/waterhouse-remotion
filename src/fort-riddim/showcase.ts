import { BAR, FIRST_DOWNBEAT, LINES, type Card, type Run } from "./promo";

/**
 * The DJ showcase post: slide one of an Instagram carousel, the DJs on the slides behind
 * it. Carousels lock every slide to the ratio of the first, so this is 4:5 — the tallest
 * Instagram allows, and a quarter more phone screen than a square.
 *
 * It is the promo's disc, lettering and beat grid, re-cut: DJ SHOWCASE, then the four
 * names a bar and a half each — a single bar wrote the name and took it away again before
 * anyone had finished reading it — and FORT RIDDIM as the sign-off, the one card that does
 * not melt away. The date never leaves the frame, so the slide still says something on its
 * own if nobody swipes.
 *
 * It ends on a downbeat, and the picture is dissolved back to its own first frame over the
 * last few frames, so the loop Instagram plays has no seam in it.
 */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1350;

/** Where each card starts and ends, in bars from the first downbeat. */
const AT = [0, 1, 2.5, 4, 5.5, 7, 8];
export const DURATION = FIRST_DOWNBEAT + AT[AT.length - 1] * BAR;
export const FRAMES = Math.round(DURATION * FPS);

/** Frames of dissolve at the loop point, and so also the picture's head start. */
export const LOOP_FADE = 12;

/** Lettering sits a little above centre, clear of the vortex. */
export const CENTRE_Y = 560;
export const DATE = "10·10·10";

const TITLE: Run[][] = [[{ text: "DJ" }], [{ text: "SHOWCASE" }]];
const NAMES = ["gibbo", "boogie", "manscream", "denzo"];

const lines = (id: string) => LINES.find((l) => l.id === id)!.lines;

/** The last card holds instead of melting. */
export const SIGN_OFF = "title";

export const CARDS: Card[] = [
  { id: "showcase", lines: TITLE },
  ...NAMES.map((id) => ({ id, lines: lines(id) })),
  { id: SIGN_OFF, lines: lines(SIGN_OFF) },
].map((c, i) => ({
  ...c,
  // The first card opens on frame 0 rather than waiting out the pick-up.
  start: i === 0 ? 0 : FIRST_DOWNBEAT + AT[i] * BAR,
  end: FIRST_DOWNBEAT + AT[i + 1] * BAR,
}));
