import { LOGO_PATHS, LOGO_PIECE_ORDER, LOGO_VIEW_H, LOGO_VIEW_W, type LogoPiece } from "./Logo";

// The mark as a grid: which piece of the logo (if any) sits under the
// centre of each cell of a cols x rows grid. The fader's dot-matrix panel
// and the split-flap mosaic are both built from this, so neither is
// hand-drawn. Pure: the SVG paths are flattened to polygons and sampled
// with an even-odd point-in-polygon test.

export type Point = [number, number];

/**
 * Flatten an absolute SVG path (M, L, H, V, C, Z - what public/logo.svg
 * uses) into one polygon. Cubic segments are subdivided `curveSteps` times;
 * the logo's curves are 2-unit corner rounds, so this is more than enough.
 */
export function pathToPolygon(d: string, curveSteps = 4): Point[] {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const pts: Point[] = [];
  let i = 0;
  let cmd = "";
  let cur: Point = [0, 0];
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MLHVCZ]$/i.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z") continue;
    }
    if (cmd === "M" || cmd === "L") {
      cur = [num(), num()];
      pts.push(cur);
    } else if (cmd === "H") {
      cur = [num(), cur[1]];
      pts.push(cur);
    } else if (cmd === "V") {
      cur = [cur[0], num()];
      pts.push(cur);
    } else if (cmd === "C") {
      const [x1, y1, x2, y2, x, y] = [num(), num(), num(), num(), num(), num()];
      const [x0, y0] = cur;
      for (let s = 1; s <= curveSteps; s++) {
        const u = s / curveSteps;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u * u;
        const e = u ** 3;
        pts.push([a * x0 + b * x1 + c * x2 + e * x, a * y0 + b * y1 + c * y2 + e * y]);
      }
      cur = [x, y];
    } else {
      throw new Error(`pathToPolygon: unsupported command "${cmd}"`);
    }
  }
  // A path that walks back to its start before Z would double the point.
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
  return pts;
}

/** Even-odd point-in-polygon. */
export function pointInPolygon([px, py]: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

const POLYGONS: Record<LogoPiece, Point[]> = {
  house: pathToPolygon(LOGO_PATHS.house),
  beamA: pathToPolygon(LOGO_PATHS.beamA),
  beamB: pathToPolygon(LOGO_PATHS.beamB),
  pillar: pathToPolygon(LOGO_PATHS.pillar),
};

/** Which piece of the mark is under a point in logo units (1000 x 666), or null. */
export function pieceAt(p: Point): LogoPiece | null {
  for (const piece of LOGO_PIECE_ORDER) {
    if (pointInPolygon(p, POLYGONS[piece])) return piece;
  }
  return null;
}

export type LogoGrid = Array<Array<LogoPiece | null>>; // [row][col]

/**
 * The mark fitted into a cols x rows grid of square cells (scaled to fit,
 * centred) and sampled at every cell centre. Returns grid[row][col].
 */
export function sampleLogoGrid(cols: number, rows: number): LogoGrid {
  // Cell size in logo units: the mark must fit both ways.
  const unit = Math.max(LOGO_VIEW_W / cols, LOGO_VIEW_H / rows);
  const offX = (cols * unit - LOGO_VIEW_W) / 2;
  const offY = (rows * unit - LOGO_VIEW_H) / 2;
  const grid: LogoGrid = [];
  for (let r = 0; r < rows; r++) {
    const row: Array<LogoPiece | null> = [];
    for (let c = 0; c < cols; c++) {
      row.push(pieceAt([(c + 0.5) * unit - offX, (r + 0.5) * unit - offY]));
    }
    grid.push(row);
  }
  return grid;
}

/** Count of cells per piece, for tests and a sanity check in the Studio. */
export function gridCounts(grid: LogoGrid): Record<LogoPiece | "none", number> {
  const counts = { house: 0, beamA: 0, beamB: 0, pillar: 0, none: 0 };
  for (const row of grid) for (const cell of row) counts[cell ?? "none"]++;
  return counts;
}
