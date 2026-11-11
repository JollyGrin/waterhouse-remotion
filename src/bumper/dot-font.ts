// A 3 x 5 dot-matrix font for the fader's LED ticker: A-Z, digits, space.
// Each glyph is five rows of three characters; '#' is a lit dot.

export const DOT_GLYPH_W = 3;
export const DOT_GLYPH_H = 5;
export const DOT_GLYPH_GAP = 1;

const GLYPHS: Record<string, string[]> = {
  A: ["###", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: ["###", "#..", "#..", "#..", "###"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: ["###", "#..", "#.#", "#.#", "###"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: ["###", "#.#", "#.#", "###", "..#"],
  R: ["###", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", "..#", "..#"],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  " ": ["...", "...", "...", "...", "..."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "-": ["...", "...", "###", "...", "..."],
};

/** Width in dots of a string set in this font (glyphs plus 1-dot gaps). */
export function dotTextWidth(text: string): number {
  return text.length * (DOT_GLYPH_W + DOT_GLYPH_GAP) - DOT_GLYPH_GAP;
}

/**
 * The lit dots of `text`, as [col, row] pairs from the text's own origin.
 * Unknown characters are blank. Upper-cased.
 */
export function dotText(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const chars = text.toUpperCase().split("");
  chars.forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    const x0 = i * (DOT_GLYPH_W + DOT_GLYPH_GAP);
    glyph.forEach((row, r) => {
      row.split("").forEach((cell, c) => {
        if (cell === "#") out.push([x0 + c, r]);
      });
    });
  });
  return out;
}
