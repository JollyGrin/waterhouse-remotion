import { describe, expect, it } from "bun:test";
import { DOT_GLYPH_H, dotText, dotTextWidth } from "./dot-font";

describe("dot font", () => {
  it("sets WATERHOUSE SESSIONS in 75 columns", () => {
    expect(dotTextWidth("WATERHOUSE SESSIONS")).toBe(75);
  });
  it("draws a W as two posts meeting in the middle", () => {
    const dots = dotText("W");
    expect(dots).toContainEqual([0, 0]);
    expect(dots).toContainEqual([2, 0]);
    expect(dots).toContainEqual([1, 2]);
    expect(dots).not.toContainEqual([1, 0]);
    for (const [, r] of dots) expect(r).toBeLessThan(DOT_GLYPH_H);
  });
  it("offsets the second glyph by four columns and leaves spaces empty", () => {
    const dots = dotText("I I");
    expect(dots.filter(([c]) => c >= 3 && c < 8)).toHaveLength(0);
    expect(dots).toContainEqual([9, 0]);
  });
});
