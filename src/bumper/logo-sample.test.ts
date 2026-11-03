import { describe, expect, it } from "bun:test";
import { LOGO_PATHS, LOGO_PIECE_BOX, LOGO_VIEW_H, LOGO_VIEW_W } from "./Logo";
import { gridCounts, pathToPolygon, pieceAt, pointInPolygon, sampleLogoGrid } from "./logo-sample";

describe("pathToPolygon", () => {
  it("flattens the pillar to its four corners", () => {
    const poly = pathToPolygon(LOGO_PATHS.pillar);
    expect(poly).toHaveLength(4);
    expect(poly[0]).toEqual([596.561, 397.961]);
    expect(poly[2]).toEqual([775.132, 665.871]);
  });
  it("subdivides the house's rounded corners and keeps its box", () => {
    const poly = pathToPolygon(LOGO_PATHS.house);
    expect(poly.length).toBeGreaterThan(8);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 0);
    expect(Math.max(...xs)).toBeCloseTo(347.9, 0);
    expect(Math.min(...ys)).toBeCloseTo(2.1, 0);
    expect(Math.max(...ys)).toBeCloseTo(665.5, 0);
  });
  it("supports H and V", () => {
    expect(pathToPolygon("M0 0H10V10H0Z")).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });
});

describe("pointInPolygon", () => {
  const square: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it("is inside / outside a square", () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([5, -1], square)).toBe(false);
  });
});

describe("pieceAt", () => {
  it("finds each piece at a point well inside it, and nothing in the gaps", () => {
    expect(pieceAt([100, 500])).toBe("house"); // low in the block
    expect(pieceAt([340, 100])).toBe("house"); // under the roof line, right edge
    expect(pieceAt([20, 100])).toBeNull(); // above the roof slope, left
    expect(pieceAt([530, 170])).toBe("beamA");
    expect(pieceAt([860, 270])).toBe("beamB");
    expect(pieceAt([685, 550])).toBe("pillar");
    expect(pieceAt([500, 500])).toBeNull(); // between house and pillar
    expect(pieceAt([700, 60])).toBeNull(); // sky above beam B
    expect(pieceAt([360, 300])).toBeNull(); // the gap between house and beam A
  });
  it("agrees with the piece boxes: a hit is inside that piece's box", () => {
    for (let y = 10; y < LOGO_VIEW_H; y += 37) {
      for (let x = 10; x < LOGO_VIEW_W; x += 41) {
        const piece = pieceAt([x, y]);
        if (!piece) continue;
        const b = LOGO_PIECE_BOX[piece];
        expect(x).toBeGreaterThanOrEqual(b.x - 0.01);
        expect(x).toBeLessThanOrEqual(b.x + b.w + 0.01);
        expect(y).toBeGreaterThanOrEqual(b.y - 0.01);
        expect(y).toBeLessThanOrEqual(b.y + b.h + 0.01);
      }
    }
  });
});

describe("sampleLogoGrid", () => {
  it("fits the 16 x 10 split-flap mosaic: house left, pillar right, beams above the pillar", () => {
    const g = sampleLogoGrid(16, 10);
    expect(g).toHaveLength(10);
    expect(g[0]).toHaveLength(16);
    // The bottom row: the house's base on the left, the pillar's base on the right.
    const bottom = g[9];
    expect(bottom.slice(0, 5).every((c) => c === "house")).toBe(true);
    expect(bottom.indexOf("pillar")).toBeGreaterThan(bottom.lastIndexOf("house"));
    // The roof: the top-left cell is sky, the top-right cell is sky.
    expect(g[0][0]).toBeNull();
    expect(g[0][15]).toBeNull();
    // Beam A sits left of beam B, both above the pillar.
    const rowOf = (piece: string) => g.findIndex((row) => row.indexOf(piece as never) !== -1);
    expect(rowOf("beamA")).toBeLessThan(rowOf("pillar"));
    expect(rowOf("beamB")).toBeLessThan(rowOf("pillar"));
    const counts = gridCounts(g);
    expect(counts.house).toBeGreaterThan(20);
    expect(counts.beamA).toBeGreaterThan(3);
    expect(counts.beamB).toBeGreaterThan(3);
    expect(counts.pillar).toBeGreaterThan(6);
    expect(counts.none).toBeGreaterThan(40);
  });
  it("matches the path at every cell centre (the mosaic is a sample, not a drawing)", () => {
    const cols = 16;
    const rows = 10;
    const g = sampleLogoGrid(cols, rows);
    const unit = Math.max(LOGO_VIEW_W / cols, LOGO_VIEW_H / rows);
    const offX = (cols * unit - LOGO_VIEW_W) / 2;
    const offY = (rows * unit - LOGO_VIEW_H) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        expect(g[r][c]).toBe(pieceAt([(c + 0.5) * unit - offX, (r + 0.5) * unit - offY]));
      }
    }
  });
  it("gets finer with more dots: the 46 x 30 dot-matrix keeps the piece proportions", () => {
    const fine = gridCounts(sampleLogoGrid(46, 30));
    const total = 46 * 30;
    // The mark covers roughly 40 % of its box; the house is the biggest piece.
    const lit = total - fine.none;
    expect(lit / total).toBeGreaterThan(0.3);
    expect(lit / total).toBeLessThan(0.55);
    expect(fine.house).toBeGreaterThan(fine.pillar);
    expect(fine.pillar).toBeGreaterThan(fine.beamB);
  });
});
