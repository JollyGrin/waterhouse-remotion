// Pure geometry for Idea 4 - Corner hit: the bounce arithmetic, the crack
// polylines and the glass panes between them. No React here so it can be
// unit-tested and so the timing block in Corner.tsx stays readable.

import { makeRng } from "../pullup/plan";

export interface Point {
  x: number;
  y: number;
}

export interface DriftSpec {
  width: number; // frame
  height: number;
  boxW: number; // the moving lockup's box
  boxH: number;
  rightBounce: number; // frame it reflects off the right edge
  bottomBounce: number; // frame it reflects off the bottom edge
  cornerFrame: number; // frame it lands exactly in the top-left corner
}

export interface Drift {
  x0: number;
  y0: number;
  vx: number; // px per frame, speed on each axis (constant)
  vy: number;
}

/**
 * Constant-speed drift that reflects off the right edge at `rightBounce`,
 * off the bottom at `bottomBounce`, and is exactly at (0, 0) at
 * `cornerFrame`. Working backwards from the corner: after each bounce the
 * box has to cross its whole axis, so the speed is distance over the frames
 * left, and the start is wherever that speed puts it at frame 0.
 *
 * `y0 >= 0` requires `bottomBounce <= cornerFrame / 2` (the box cannot
 * cross the frame upward faster than it came down), hence the ticket's
 * "~f30" bottom bounce is not reachable in 1080 px; f20 is.
 */
export function solveDrift(s: DriftSpec): Drift {
  const maxX = s.width - s.boxW;
  const maxY = s.height - s.boxH;
  const vx = maxX / (s.cornerFrame - s.rightBounce);
  const vy = maxY / (s.cornerFrame - s.bottomBounce);
  const x0 = maxX - vx * s.rightBounce;
  const y0 = maxY - vy * s.bottomBounce;
  if (x0 < 0 || y0 < 0) {
    throw new Error(
      `Drift starts outside the frame (x0=${x0.toFixed(1)}, y0=${y0.toFixed(1)}): bring the bounces earlier.`,
    );
  }
  return { x0, y0, vx, vy };
}

/** Top-left of the box at `frame` (clamped to the corner from cornerFrame). */
export function driftAt(s: DriftSpec, d: Drift, frame: number): Point {
  if (frame >= s.cornerFrame) return { x: 0, y: 0 };
  const maxX = s.width - s.boxW;
  const maxY = s.height - s.boxH;
  const x =
    frame <= s.rightBounce
      ? d.x0 + d.vx * frame
      : maxX - d.vx * (frame - s.rightBounce);
  const y =
    frame <= s.bottomBounce
      ? d.y0 + d.vy * frame
      : maxY - d.vy * (frame - s.bottomBounce);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

export interface CrackSpec {
  width: number;
  height: number;
  // The logo pane: a box in the top-left corner the cracks cross in a
  // straight line, so it stays one piece.
  boxW: number;
  boxH: number;
  count: number;
  seed: number;
  jitterPx: number;
  jitterDeg: number;
  segments: number; // polyline segments outside the box
}

export interface Crack {
  angleDeg: number; // from the top edge, clockwise: 0 = right, 90 = down
  boxExit: Point; // where it leaves the logo box
  end: Point; // where it meets the frame edge
  points: Point[]; // the whole polyline, corner first
  length: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where a ray from (0,0) at `angleDeg` meets the rectangle w x h. */
function rayExit(angleDeg: number, w: number, h: number): Point {
  const t = Math.tan(rad(angleDeg));
  if (w * t <= h) return { x: w, y: w * t };
  return { x: h / t, y: h };
}

export function buildCracks(s: CrackSpec): Crack[] {
  const rng = makeRng(s.seed);
  const cracks: Crack[] = [];
  for (let i = 0; i < s.count; i++) {
    // Evenly spread between the top and left edges, then jittered.
    const base = (90 * (i + 1)) / (s.count + 1);
    const angleDeg = base + (rng() * 2 - 1) * s.jitterDeg;
    const boxExit = rayExit(angleDeg, s.boxW, s.boxH);
    const end = rayExit(angleDeg, s.width, s.height);
    const points: Point[] = [{ x: 0, y: 0 }, boxExit];
    // Perpendicular jitter along the way, none at either end.
    const nx = -Math.sin(rad(angleDeg));
    const ny = Math.cos(rad(angleDeg));
    for (let k = 1; k < s.segments; k++) {
      const t = k / s.segments;
      const j = (rng() * 2 - 1) * s.jitterPx;
      points.push({
        x: boxExit.x + (end.x - boxExit.x) * t + nx * j,
        y: boxExit.y + (end.y - boxExit.y) * t + ny * j,
      });
    }
    points.push(end);
    let length = 0;
    for (let k = 1; k < points.length; k++) {
      length += Math.hypot(
        points[k].x - points[k - 1].x,
        points[k].y - points[k - 1].y,
      );
    }
    cracks.push({ angleDeg, boxExit, end, points, length });
  }
  return cracks.sort((a, b) => a.angleDeg - b.angleDeg);
}

export interface Pane {
  polygon: Point[];
  centroid: Point;
  isLogo: boolean;
}

/**
 * The glass between the cracks. Pane k lies between crack k-1 and crack k,
 * where "crack -1" is the top edge and "crack n" is the left edge, minus the
 * logo box. The logo box itself is the last pane.
 */
export function buildPanes(s: CrackSpec, cracks: Crack[]): Pane[] {
  const { width: W, height: H, boxW, boxH } = s;

  // Pseudo-cracks for the two frame edges that meet at the corner.
  const top: Crack = {
    angleDeg: 0,
    boxExit: { x: boxW, y: 0 },
    end: { x: W, y: 0 },
    points: [
      { x: 0, y: 0 },
      { x: boxW, y: 0 },
      { x: W, y: 0 },
    ],
    length: W,
  };
  const left: Crack = {
    angleDeg: 90,
    boxExit: { x: 0, y: boxH },
    end: { x: 0, y: H },
    points: [
      { x: 0, y: 0 },
      { x: 0, y: boxH },
      { x: 0, y: H },
    ],
    length: H,
  };
  const edges = [top, ...cracks, left];

  // Walk the frame boundary clockwise from a's end to b's end. Ends are on
  // the right edge (x = W) or the bottom edge (y = H), and crack a is the
  // earlier one, so the bottom-right corner is passed when they straddle it.
  const frameWalk = (a: Point, b: Point): Point[] =>
    a.x === W && b.x !== W ? [{ x: W, y: H }] : [];
  // Walk the logo box boundary back from b's exit to a's exit; the box
  // corner (boxW, boxH) sits between them when one exit is on the box's
  // right side and the other on its bottom.
  const boxWalk = (a: Point, b: Point): Point[] =>
    a.x === boxW && b.x !== boxW ? [{ x: boxW, y: boxH }] : [];

  const panes: Pane[] = [];
  for (let k = 1; k < edges.length; k++) {
    const a = edges[k - 1];
    const b = edges[k];
    const outerA = a.points.slice(1); // from the box exit outward
    const outerB = b.points.slice(1).reverse(); // from the frame back in
    const polygon = [...outerA, ...frameWalk(a.end, b.end), ...outerB, ...boxWalk(a.boxExit, b.boxExit)];
    panes.push({ polygon, centroid: centroid(polygon), isLogo: false });
  }
  const box: Point[] = [
    { x: 0, y: 0 },
    { x: boxW, y: 0 },
    { x: boxW, y: boxH },
    { x: 0, y: boxH },
  ];
  panes.push({ polygon: box, centroid: centroid(box), isLogo: true });
  return panes;
}

export function centroid(poly: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-6) return poly[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Shoelace area, for sanity checks: the panes must tile the frame. */
export function area(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * The order the panes fall in: the wedges from the top edge round to the
 * left edge, the logo pane last. Sequential on purpose: the glass still
 * standing is then always one polygon (see `standingPolygon`), so it can be
 * drawn as a single clipped element with no anti-aliased seams between
 * pieces that have not moved yet.
 */
export function fallOrder(panes: Pane[]): number[] {
  const wedges = panes
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.isLogo)
    .map(({ i }) => i);
  return [...wedges, panes.findIndex((p) => p.isLogo)];
}

/**
 * The glass still standing once the first `fallen` wedges have gone: wedges
 * `fallen`..n-1 plus the logo box, as one polygon. With every wedge gone it
 * is just the box; null once the box has gone too.
 */
export function standingPolygon(
  s: CrackSpec,
  cracks: Crack[],
  fallen: number,
): Point[] | null {
  const { width: W, height: H, boxW, boxH } = s;
  if (fallen > cracks.length + 1) return null;
  if (fallen === cracks.length + 1) {
    return [
      { x: 0, y: 0 },
      { x: boxW, y: 0 },
      { x: boxW, y: boxH },
      { x: 0, y: boxH },
    ];
  }
  // The boundary crack: the top edge when nothing has fallen yet.
  const edge: Crack =
    fallen === 0
      ? {
          angleDeg: 0,
          boxExit: { x: boxW, y: 0 },
          end: { x: W, y: 0 },
          points: [
            { x: 0, y: 0 },
            { x: boxW, y: 0 },
            { x: W, y: 0 },
          ],
          length: W,
        }
      : cracks[fallen - 1];
  const exitOnBottom = edge.boxExit.x !== boxW;
  const endOnRight = edge.end.x === W;
  return [
    { x: 0, y: 0 },
    { x: boxW, y: 0 },
    ...(exitOnBottom ? [{ x: boxW, y: boxH }] : []),
    ...edge.points.slice(1),
    ...(endOnRight ? [{ x: W, y: H }] : []),
    { x: 0, y: H },
  ];
}

export const toClipPath = (poly: Point[]) =>
  `polygon(${poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(", ")})`;
