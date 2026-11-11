/**
 * FORT RIDDIM promo card: the animated RIDDIM disc with the billing written over it.
 *
 * Separate from the 10.10.10 reel (src/fort-riddim/edit.ts) — that one is an edit, this
 * is a finished 17s clip Manuel supplied that only wants lettering. Nothing else about
 * the picture is touched.
 *
 * Tempo was measured off the clip's own audio by spectral-flux autocorrelation, then the
 * downbeat chosen from the four candidate phases by comb score: beat 1 of the bar scored
 * 4.94 against 2.85 / 1.64 / 3.95 for the other three, so the grid below is the track's
 * own, not a guess.
 */

export const FPS = 30;
export const WIDTH = 1080;
/** The source is 1922 tall, not 1920. Kept as delivered. */
export const HEIGHT = 1922;
export const FRAMES = 508;
export const DURATION = FRAMES / FPS;

export const BPM = 134.9;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
export const FIRST_DOWNBEAT = 0.477;

/** Reel time of the nth downbeat. */
export const downbeat = (n: number) => FIRST_DOWNBEAT + n * BAR;

/** Seconds since the most recent beat, for the pulse. */
export const beatPhase = (t: number) => {
  const b = (t - FIRST_DOWNBEAT) / BEAT;
  return (b - Math.floor(b)) * BEAT;
};

/**
 * A line of lettering. `rel` scales a run against the rest of the line, which is how the
 * poster sets BOOGIE B2B ALEC — the B2B is roughly half height.
 */
export type Run = { text: string; rel?: number };
export type Card = { id: string; lines: Run[][]; start: number; end: number };

/**
 * Each card is fitted to one width, so a long line would come out in small letters next
 * to GIBBO. The two long ones are stacked instead, which keeps every card at the same
 * letter height — the only thing that reads as consistent when the words are this short.
 */
export const LINES: { id: string; lines: Run[][] }[] = [
  { id: "title", lines: [[{ text: "FORT" }], [{ text: "RIDDIM" }]] },
  { id: "date", lines: [[{ text: "10·10·10" }]] },
  { id: "gibbo", lines: [[{ text: "GIBBO" }]] },
  // B2B set smaller, as the poster sets it.

  // Stacked, or it sets in much smaller letters than the one-word names either side of it.
  { id: "boogie", lines: [[{ text: "BOOGIE" }], [{ text: "B2B ", rel: 0.75 }, { text: "ALEC" }]] },
  { id: "manscream", lines: [[{ text: "MANSCREAM" }]] },
  { id: "denzo", lines: [[{ text: "DENZO" }]] },
  { id: "venue", lines: [[{ text: "WATERHOUSE" }], [{ text: "STUDIOS" }]] },
];

/**
 * How each card writes itself: one hit per syllable, placed by ear against the bar rather
 * than on an even grid. `n` is how many letters that syllable brings up (spaces do not
 * count), `at` is where it lands in beats from the card's own downbeat. Quarters, eighths
 * and the odd sixteenth, so the words have the phrasing of someone saying them over the
 * track instead of a machine spelling them out.
 */
export const SYLLABLES: Record<string, { n: number; at: number }[]> = {
  // DJ ... SHOW-CASE, the same phrasing as the title card (showcase.ts)
  showcase: [{ n: 2, at: 0 }, { n: 4, at: 1 }, { n: 4, at: 1.5 }],
  // FORT ... RID-DIM
  title: [{ n: 4, at: 0 }, { n: 3, at: 1 }, { n: 3, at: 1.5 }],
  // ten-ten-ten, said quickly, the way it is read aloud
  date: [{ n: 3, at: 0 }, { n: 3, at: 0.5 }, { n: 2, at: 1 }],
  gibbo: [{ n: 3, at: 0 }, { n: 2, at: 0.5 }],
  // BOO-GIE ... B2B ... A-LEC
  boogie: [
    { n: 3, at: 0 },
    { n: 3, at: 0.5 },
    { n: 3, at: 1.5 },
    { n: 1, at: 2.5 },
    { n: 3, at: 3 },
  ],
  // MAN, then the long one off the sixteenth
  manscream: [{ n: 3, at: 0 }, { n: 6, at: 0.75 }],
  denzo: [{ n: 3, at: 0 }, { n: 2, at: 0.5 }],
  // WA-TER-HOUSE ... STU-DI-OS
  venue: [
    { n: 2, at: 0 },
    { n: 3, at: 0.5 },
    { n: 5, at: 1 },
    { n: 3, at: 2 },
    { n: 2, at: 2.5 },
    { n: 2, at: 3 },
  ],
};

/**
 * One bar each, every change on a downbeat. The title opens on frame 0 rather than
 * waiting out the pick-up, and the venue holds from the sixth downbeat to the end —
 * it is the sign-off, so it is the one card allowed to sit.
 */
export const CARDS: Card[] = LINES.map((r, i) => ({
  ...r,
  start: i === 0 ? 0 : downbeat(i),
  end: i === LINES.length - 1 ? DURATION : downbeat(i + 1),
}));
