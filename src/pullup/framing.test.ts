import { describe, expect, it } from "bun:test";
import { DEFAULT_FIT, PANEL_FRAME, PLAYER_FRAME, fitFor } from "./framing";

describe("fitFor", () => {
  it("contains a portrait photo rather than cropping it", () => {
    // Denzo's profile photo: a tight headshot, taller than it is wide. A
    // cover crop to 820x560 cut his mouth off entirely.
    expect(fitFor(1272, 1696)).toBe("contain");
  });

  it("covers a landscape photo", () => {
    expect(fitFor(1920, 1080)).toBe("cover");
  });

  it("covers a square photo", () => {
    expect(fitFor(1080, 1080)).toBe("cover");
  });

  it("treats one pixel taller as portrait", () => {
    expect(fitFor(1000, 1001)).toBe("contain");
    expect(fitFor(1000, 1000)).toBe("cover");
  });

  it("covers anything it cannot measure", () => {
    for (const [w, h] of [
      [0, 0],
      [0, 500],
      [500, 0],
      [NaN, NaN],
      [-10, 20],
    ]) {
      expect(fitFor(w, h)).toBe(DEFAULT_FIT);
    }
    expect(DEFAULT_FIT).toBe("cover");
  });
});

describe("frame geometry", () => {
  it("splits the window into two panels either side of a 2px rule", () => {
    expect(PANEL_FRAME.width * 2 + 2).toBe(PLAYER_FRAME.width);
    expect(PANEL_FRAME.height).toBe(PLAYER_FRAME.height);
  });
});
