import { noise } from "./fx";
import { sampleLogoGrid } from "./logo-sample";

// The split-flap board's schedule, pure and tested: which face every tile
// shows at every frame. A tile is a list of flips; each flip takes
// `flipFrames` frames from `start + k * flipFrames` and goes from
// faces[k] to faces[k + 1]. Flap.tsx only asks `tileState(tile, frame)`.

export type Face =
  | { kind: "color"; fill: string }
  | { kind: "glyph"; char: string }
  | { kind: "transparent" };

export interface TileFlips {
  start: number; // the first flip starts here
  flipFrames: number; // frames per flip
  faces: Face[]; // faces[0] is shown before start; faces[n-1] after the last flip
}

export interface Tile {
  id: string;
  kind: "mosaic" | "char";
  col: number;
  row: number; // mosaic 0..9; char rows 0 and 1
  x: number; // px, top-left on the 1920 x 1080 frame
  y: number;
  w: number;
  h: number;
  flips: TileFlips; // the build (greys / cycling letters) and the correction
  exit: TileFlips; // the one flip to transparent, in the diagonal wave
}

export interface TileState {
  from: Face;
  to: Face;
  progress: number; // 0..1 within the current flip; 1 when at rest
  flipping: boolean;
}

// --- Layout and timing constants (all tunable; Flap.tsx reads these too) ---
export const MOSAIC_COLS = 16;
export const MOSAIC_ROWS = 10;
export const MOSAIC_TILE = 58; // px square
export const CHAR_COLS = 20;
export const CHAR_TILE_W = 42;
export const CHAR_TILE_H = 60;
export const TILE_GUTTER = 4; // board showing between tiles
export const HALF_GAP = 2; // the split line between the two halves

export const MOSAIC_LEFT = 960 - (MOSAIC_COLS * (MOSAIC_TILE + TILE_GUTTER) - TILE_GUTTER) / 2;
export const MOSAIC_TOP = 92;
export const CHAR_LEFT = 960 - (CHAR_COLS * (CHAR_TILE_W + TILE_GUTTER) - TILE_GUTTER) / 2;
export const ROW1_TOP = MOSAIC_TOP + MOSAIC_ROWS * (MOSAIC_TILE + TILE_GUTTER) + 60;
export const ROW2_TOP = ROW1_TOP + CHAR_TILE_H + 24;

export const MOSAIC_START = 8; // the wave starts top-left
export const MOSAIC_COL_STAGGER = 1; // frames per column
export const MOSAIC_ROW_STAGGER = 0.5; // frames per row
export const MOSAIC_FLIP_FRAMES = 4;
export const MOSAIC_FLIPS_MIN = 2; // flips through greys before the final face
export const MOSAIC_FLIPS_MAX = 4;

export const ROW1_START = 44;
export const ROW2_START = 45;
export const CHAR_STAGGER = 0.5; // frames per letter, left to right
export const CHAR_FLIP_FRAMES = 2;
export const CHAR_CYCLES_MIN = 3; // characters cycled before landing
export const CHAR_CYCLES_MAX = 8;
export const STUCK_INDEX = 13; // the second S of SESSIONS
export const STUCK_FIX = 72; // ... stays wrong until here, then a double clack
export const EXIT_START = 84; // the diagonal wave; OBS transition point
export const EXIT_FLIP_FRAMES = 4;
export const EXIT_SPEED = 100; // px of (x + y) per frame; the board's far corner clears by f110
export const CLEAR_FRAME = 110;

export const ROW1_TEXT = "WATERHOUSE SESSIONS";
export const GREYS = ["#2b2b2b", "#4a4a4a", "#6b6b6b", "#8d8d8d", "#b0b0b0", "#1c1c1c"];
export const CYCLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const BLACK: Face = { kind: "color", fill: "#0e0e0e" };
export const WHITE: Face = { kind: "color", fill: "#f4f4f0" };
export const BLANK: Face = { kind: "glyph", char: " " };
export const TRANSPARENT: Face = { kind: "transparent" };

const pick = <T,>(arr: T[], seed: number, i: number): T =>
  arr[Math.floor(((noise(seed, i) + 1) / 2) * arr.length) % arr.length];
const intIn = (lo: number, hi: number, seed: number, i: number): number =>
  lo + Math.floor(((noise(seed, i) + 1) / 2) * (hi - lo + 1)) % (hi - lo + 1);

/** "WITH DENZO", or "WITH DENZO + GUEST", centred on the 20 tiles. */
export function row2Text(guestName: string | null): string {
  const guest = guestName?.trim();
  const text = (guest ? `WITH DENZO + ${guest}` : "WITH DENZO").toUpperCase().slice(0, CHAR_COLS);
  const pad = Math.floor((CHAR_COLS - text.length) / 2);
  return (" ".repeat(pad) + text).padEnd(CHAR_COLS, " ");
}

/** Row 1, centred the same way (19 letters on 20 tiles). */
export function row1Text(): string {
  const pad = Math.floor((CHAR_COLS - ROW1_TEXT.length) / 2);
  return (" ".repeat(pad) + ROW1_TEXT).padEnd(CHAR_COLS, " ");
}

/** The diagonal exit wave: this tile's flip-to-transparent. */
function exitFlips(x: number, y: number, w: number, h: number, finalFace: Face): TileFlips {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const origin = MOSAIC_LEFT + MOSAIC_TOP + MOSAIC_TILE; // the first tile's centre
  const delay = Math.round((cx + cy - origin) / EXIT_SPEED);
  return { start: EXIT_START + delay, flipFrames: EXIT_FLIP_FRAMES, faces: [finalFace, TRANSPARENT] };
}

function charTile(rowIndex: 0 | 1, col: number, target: string, start: number, seed: number): Tile {
  const x = CHAR_LEFT + col * (CHAR_TILE_W + TILE_GUTTER);
  const y = rowIndex === 0 ? ROW1_TOP : ROW2_TOP;
  const faces: Face[] = [BLANK];
  let flips: TileFlips;
  if (target === " ") {
    // A blank stays blank: nothing to flip.
    flips = { start, flipFrames: CHAR_FLIP_FRAMES, faces };
  } else {
    const cycles = intIn(CHAR_CYCLES_MIN, CHAR_CYCLES_MAX, seed, col);
    for (let k = 0; k < cycles - 1; k++) faces.push({ kind: "glyph", char: pick(CYCLE_CHARS.split(""), seed + 1 + k, col) });
    const stuck = rowIndex === 0 && col === STUCK_INDEX;
    if (stuck) {
      // Lands on the wrong letter and stays there until STUCK_FIX. The
      // correction is scheduled as its own flips below.
      const wrong = { kind: "glyph", char: "R" } as const;
      faces.push(wrong);
    } else {
      faces.push({ kind: "glyph", char: target });
    }
    flips = { start, flipFrames: CHAR_FLIP_FRAMES, faces };
  }
  return {
    id: `c${rowIndex}-${col}`,
    kind: "char",
    col,
    row: rowIndex,
    x,
    y,
    w: CHAR_TILE_W,
    h: CHAR_TILE_H,
    flips,
    exit: exitFlips(x, y, CHAR_TILE_W, CHAR_TILE_H, { kind: "glyph", char: target }),
  };
}

/** The stuck tile's correction: two quick flips from the wrong letter to S. */
export const STUCK_FIX_FLIPS: TileFlips = {
  start: STUCK_FIX,
  flipFrames: CHAR_FLIP_FRAMES,
  faces: [{ kind: "glyph", char: "R" }, { kind: "glyph", char: "Q" }, { kind: "glyph", char: "S" }],
};

export function flapPlan(guestName: string | null): Tile[] {
  const tiles: Tile[] = [];
  const grid = sampleLogoGrid(MOSAIC_COLS, MOSAIC_ROWS);
  for (let r = 0; r < MOSAIC_ROWS; r++) {
    for (let c = 0; c < MOSAIC_COLS; c++) {
      const x = MOSAIC_LEFT + c * (MOSAIC_TILE + TILE_GUTTER);
      const y = MOSAIC_TOP + r * (MOSAIC_TILE + TILE_GUTTER);
      const i = r * MOSAIC_COLS + c;
      const n = intIn(MOSAIC_FLIPS_MIN, MOSAIC_FLIPS_MAX, 71, i);
      const final = grid[r][c] ? WHITE : BLACK;
      const faces: Face[] = [BLACK];
      for (let k = 0; k < n - 1; k++) faces.push({ kind: "color", fill: pick(GREYS, 72 + k, i) });
      faces.push(final);
      tiles.push({
        id: `m${r}-${c}`,
        kind: "mosaic",
        col: c,
        row: r,
        x,
        y,
        w: MOSAIC_TILE,
        h: MOSAIC_TILE,
        flips: {
          start: Math.round(MOSAIC_START + c * MOSAIC_COL_STAGGER + r * MOSAIC_ROW_STAGGER),
          flipFrames: MOSAIC_FLIP_FRAMES,
          faces,
        },
        exit: exitFlips(x, y, MOSAIC_TILE, MOSAIC_TILE, final),
      });
    }
  }
  const r1 = row1Text();
  const r2 = row2Text(guestName);
  for (let c = 0; c < CHAR_COLS; c++) {
    tiles.push(charTile(0, c, r1[c], Math.round(ROW1_START + c * CHAR_STAGGER), 81));
    tiles.push(charTile(1, c, r2[c], Math.round(ROW2_START + c * CHAR_STAGGER), 83));
  }
  return tiles;
}

/** The frame a flip list is done (its last face at rest). */
export function flipsEnd(f: TileFlips): number {
  return f.start + (f.faces.length - 1) * f.flipFrames;
}

/** State of a flip list at `frame`. */
export function flipsState(f: TileFlips, frame: number): TileState {
  const n = f.faces.length - 1;
  if (n === 0 || frame < f.start) return { from: f.faces[0], to: f.faces[0], progress: 1, flipping: false };
  const k = Math.floor((frame - f.start) / f.flipFrames);
  if (k >= n) return { from: f.faces[n], to: f.faces[n], progress: 1, flipping: false };
  const progress = (frame - f.start - k * f.flipFrames + 1) / f.flipFrames;
  return { from: f.faces[k], to: f.faces[k + 1], progress, flipping: true };
}

/** What a tile shows at `frame`: build, correction (stuck tile), then exit. */
export function tileState(tile: Tile, frame: number): TileState {
  if (frame >= tile.exit.start) return flipsState(tile.exit, frame);
  if (tile.kind === "char" && tile.row === 0 && tile.col === STUCK_INDEX && frame >= STUCK_FIX) {
    return flipsState(STUCK_FIX_FLIPS, frame);
  }
  return flipsState(tile.flips, frame);
}

/** The frame a tile has landed on its final build face. */
export function tileLanded(tile: Tile): number {
  if (tile.kind === "char" && tile.row === 0 && tile.col === STUCK_INDEX) return flipsEnd(STUCK_FIX_FLIPS);
  return flipsEnd(tile.flips);
}

export interface Clack {
  frame: number;
  rate: number; // playback rate, +-15 % seeded
  gain: number;
  tile: string;
  phase: "build" | "fix" | "exit";
}

/**
 * Every flip start in the plan, as a clack: the cascade. The audio script
 * bakes everything but row 2's build (which depends on the guest name) into
 * flap-cascade.wav; Flap.tsx plays row 2's build as single clacks.
 */
export function clacks(tiles: Tile[]): Clack[] {
  const out: Clack[] = [];
  let i = 0;
  for (const t of tiles) {
    const lists: Array<[TileFlips, Clack["phase"], number]> = [
      [t.flips, "build", t.kind === "mosaic" ? 0.55 : 0.8],
      [t.exit, "exit", 0.7],
    ];
    if (t.kind === "char" && t.row === 0 && t.col === STUCK_INDEX) lists.push([STUCK_FIX_FLIPS, "fix", 1]);
    for (const [f, phase, gain] of lists) {
      for (let k = 0; k < f.faces.length - 1; k++) {
        out.push({ frame: f.start + k * f.flipFrames, rate: 1 + 0.15 * noise(91, i), gain, tile: t.id, phase });
        i++;
      }
    }
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/** Is this clack baked into flap-cascade.wav (true) or played live (false)? */
export const isBakedClack = (c: Clack) => !(c.phase === "build" && c.tile.indexOf("c1-") === 0);

/** The idle rattler: one seeded mosaic tile. */
export const RATTLE_TILE = { row: 6, col: 9 };
