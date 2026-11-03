import { describe, expect, it } from "bun:test";
import {
  CHAR_COLS,
  CLEAR_FRAME,
  EXIT_START,
  MOSAIC_COLS,
  MOSAIC_ROWS,
  MOSAIC_START,
  ROW1_START,
  STUCK_FIX,
  STUCK_INDEX,
  clacks,
  flapPlan,
  flipsEnd,
  flipsState,
  isBakedClack,
  row1Text,
  row2Text,
  tileLanded,
  tileState,
  type Tile,
  type TileFlips,
} from "./flap-plan";
import { sampleLogoGrid } from "./logo-sample";

const plan = flapPlan(null);
const mosaic = plan.filter((t) => t.kind === "mosaic");
const row1 = plan.filter((t) => t.kind === "char" && t.row === 0);
const row2 = plan.filter((t) => t.kind === "char" && t.row === 1);
const glyph = (t: Tile, frame: number) => {
  const s = tileState(t, frame);
  return s.to.kind === "glyph" ? s.to.char : s.to.kind;
};

describe("flap plan: mosaic", () => {
  it("has 16 x 10 tiles that start in a wave, 1 frame per column and 0.5 per row", () => {
    expect(mosaic).toHaveLength(MOSAIC_COLS * MOSAIC_ROWS);
    const at = (c: number, r: number) => mosaic.find((t) => t.col === c && t.row === r)!;
    expect(at(0, 0).flips.start).toBe(MOSAIC_START);
    expect(at(1, 0).flips.start).toBe(MOSAIC_START + 1);
    expect(at(0, 2).flips.start).toBe(MOSAIC_START + 1);
    expect(at(15, 9).flips.start).toBe(Math.round(MOSAIC_START + 15 + 4.5));
  });
  it("flips 2-4 times through greys and lands on the sampled logo by f44", () => {
    const grid = sampleLogoGrid(MOSAIC_COLS, MOSAIC_ROWS);
    for (const t of mosaic) {
      const n = t.flips.faces.length - 1;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      const final = t.flips.faces[n];
      expect(final.kind).toBe("color");
      const lit = final.kind === "color" && final.fill === "#f4f4f0";
      expect(lit).toBe(grid[t.row][t.col] !== null);
      expect(flipsEnd(t.flips)).toBeLessThanOrEqual(44);
    }
  });
});

describe("flap plan: character rows", () => {
  it("centres the two lines on 20 tiles", () => {
    expect(row1Text()).toBe("WATERHOUSE SESSIONS ");
    expect(row2Text(null)).toBe("     WITH DENZO     ");
    expect(row2Text("Tj Gee")).toBe("WITH DENZO + TJ GEE ");
    expect(row2Text("Tj Gee")).toHaveLength(CHAR_COLS);
  });
  it("cycles 3-8 letters per tile, left to right, and has row 1 landed before the fix", () => {
    for (const t of row1) {
      const target = row1Text()[t.col];
      if (target === " ") {
        expect(t.flips.faces).toHaveLength(1);
        continue;
      }
      const cycles = t.flips.faces.length - 1;
      expect(cycles).toBeGreaterThanOrEqual(3);
      expect(cycles).toBeLessThanOrEqual(8);
      expect(t.flips.start).toBeGreaterThanOrEqual(ROW1_START);
      if (t.col !== STUCK_INDEX) {
        expect(glyph(t, 80)).toBe(target);
        expect(flipsEnd(t.flips)).toBeLessThanOrEqual(STUCK_FIX);
      }
    }
  });
  it("lands row 2 by f66", () => {
    for (const t of row2) expect(flipsEnd(t.flips)).toBeLessThanOrEqual(66);
    expect(row2.map((t) => glyph(t, 70)).join("")).toBe("     WITH DENZO     ");
  });
  it("sticks the second S of SESSIONS on a wrong letter and corrects it at f72 with two flips", () => {
    const stuck = row1[STUCK_INDEX];
    expect(row1Text()[STUCK_INDEX]).toBe("S");
    expect(glyph(stuck, STUCK_FIX - 1)).not.toBe("S");
    expect(tileState(stuck, STUCK_FIX - 1).flipping).toBe(false);
    expect(tileState(stuck, STUCK_FIX).flipping).toBe(true);
    expect(tileLanded(stuck)).toBe(STUCK_FIX + 4);
    expect(glyph(stuck, STUCK_FIX + 4)).toBe("S");
    expect(tileState(stuck, STUCK_FIX + 4).flipping).toBe(false);
  });
});

describe("flap plan: exit", () => {
  it("is a diagonal wave from the top left that leaves nothing after f110", () => {
    const first = Math.min(...plan.map((t) => t.exit.start));
    const last = Math.max(...plan.map((t) => flipsEnd(t.exit)));
    expect(first).toBe(EXIT_START);
    expect(last).toBeLessThanOrEqual(CLEAR_FRAME);
    const at = (c: number, r: number) => mosaic.find((t) => t.col === c && t.row === r)!;
    expect(at(0, 0).exit.start).toBeLessThan(at(15, 0).exit.start);
    expect(at(0, 0).exit.start).toBeLessThan(at(0, 9).exit.start);
    expect(at(15, 9).exit.start).toBeGreaterThan(at(8, 5).exit.start);
    for (const t of plan) {
      expect(t.exit.start).toBeGreaterThan(tileLanded(t));
      const s = tileState(t, CLEAR_FRAME);
      expect(s.to.kind).toBe("transparent");
      expect(s.flipping).toBe(false);
    }
  });
});

describe("flipsState", () => {
  const f: TileFlips = { start: 10, flipFrames: 4, faces: [{ kind: "color", fill: "a" }, { kind: "color", fill: "b" }, { kind: "color", fill: "c" }] };
  it("rests before, flips in order, rests after", () => {
    expect(flipsState(f, 9)).toEqual({ from: f.faces[0], to: f.faces[0], progress: 1, flipping: false });
    expect(flipsState(f, 10)).toEqual({ from: f.faces[0], to: f.faces[1], progress: 0.25, flipping: true });
    expect(flipsState(f, 13).progress).toBe(1);
    expect(flipsState(f, 14).from).toBe(f.faces[1]);
    expect(flipsState(f, 18)).toEqual({ from: f.faces[2], to: f.faces[2], progress: 1, flipping: false });
  });
});

describe("clacks", () => {
  it("is a dense cascade through the build that thins out through the exit", () => {
    const all = clacks(plan);
    const per = (a: number, b: number) => all.filter((c) => c.frame >= a && c.frame < b).length / (b - a);
    expect(per(12, 30)).toBeGreaterThan(8);
    expect(per(EXIT_START, EXIT_START + 8)).toBeGreaterThan(per(CLEAR_FRAME - 8, CLEAR_FRAME));
    expect(all.filter((c) => c.phase === "fix").map((c) => c.frame)).toEqual([STUCK_FIX, STUCK_FIX + 2]);
    const live = all.filter((c) => !isBakedClack(c));
    expect(live.length).toBeGreaterThan(20);
    expect(live.every((c) => c.tile.indexOf("c1-") === 0 && c.phase === "build")).toBe(true);
    for (const c of all) {
      expect(c.rate).toBeGreaterThan(0.84);
      expect(c.rate).toBeLessThan(1.16);
    }
  });
});
