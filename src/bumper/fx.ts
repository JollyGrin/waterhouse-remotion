// Pure helpers shared by the bumper ideas: seeded noise, stop-motion
// stepping, camera shake, torn edges, the lamp's pendulum. No React here so
// everything is unit-testable; the SVG layers that use them are in
// fx-layers.tsx.

/** Deterministic hash noise in [-1, 1] for (seed, frame). */
export function noise(seed: number, frame: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(frame | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Stop-motion: the frame held on twos. */
export const onTwos = (frame: number): number => Math.floor(frame / 2) * 2;

/** +-px jitter that changes every two frames, like a hand-placed cut-out. */
export function jitter(
  seed: number,
  frame: number,
  px: number,
): { x: number; y: number } {
  const step = Math.floor(frame / 2);
  return {
    x: Math.round(noise(seed, step) * px),
    y: Math.round(noise(seed + 101, step) * px),
  };
}

/**
 * Camera shake after an impact at `at`: seeded noise of amplitude `amp` px,
 * decaying quadratically to 0 over `frames` frames. 0 outside the window.
 */
export function shake(
  frame: number,
  at: number,
  amp: number,
  seed: number,
  frames = 8,
): { x: number; y: number } {
  const t = frame - at;
  if (t < 0 || t >= frames) return { x: 0, y: 0 };
  const env = amp * Math.pow(1 - t / frames, 2);
  return {
    x: env * noise(seed, t),
    y: env * noise(seed + 7, t),
  };
}

/** A 4-frame punch-in: scale rises to 1 + amount and comes straight back. */
export function punch(frame: number, at: number, amount: number, frames = 4): number {
  const t = frame - at;
  if (t < 0 || t > frames) return 1;
  return 1 + amount * Math.sin((Math.PI * t) / frames);
}

/**
 * Edge "boil": a 2D offset of +-px that steps every two frames, for cut
 * edges that should never sit perfectly still.
 */
export function boil(seed: number, frame: number, px: number): { x: number; y: number } {
  const step = Math.floor(frame / 2);
  return { x: noise(seed, step) * px, y: noise(seed + 53, step) * px };
}

/**
 * A torn-paper outline for a w x h box as CSS `polygon()` points: one
 * vertex every `step` px along each edge, pushed in or out by up to `amp`.
 * Corners stay put so the shape still reads as a rectangle.
 */
export function tornPolygon(w: number, h: number, seed: number, step = 14, amp = 5): string {
  const pts: Array<[number, number]> = [];
  let i = 0;
  const wobble = () => noise(seed, i++) * amp;
  const along = (len: number) => {
    const out: number[] = [];
    for (let p = step; p < len - step / 2; p += step) out.push(p);
    return out;
  };
  pts.push([0, 0]);
  for (const x of along(w)) pts.push([x, wobble()]);
  pts.push([w, 0]);
  for (const y of along(h)) pts.push([w + wobble(), y]);
  pts.push([w, h]);
  for (const x of along(w).reverse()) pts.push([x, h + wobble()]);
  pts.push([0, h]);
  for (const y of along(h).reverse()) pts.push([wobble(), y]);
  return pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ");
}

/** Damped pendulum: A0 * e^(-k t) * cos(w t), angle in the unit of A0. */
export function pendulum(t: number, a0: number, k: number, omega: number): number {
  if (t < 0) return a0;
  return a0 * Math.exp(-k * t) * Math.cos(omega * t);
}

/**
 * Frames (after the release) at which the pendulum reverses: the velocity
 * zeros of e^(-kt) cos(wt), which sit at tan(wt) = -k/w, i.e. every half
 * period from t0 = (pi - atan(k/w)) / w.
 */
export function pendulumApexFrames(
  k: number,
  omega: number,
  fps: number,
  untilFrame: number,
): number[] {
  const out: number[] = [];
  const t0 = (Math.PI - Math.atan(k / omega)) / omega;
  for (let n = 0; ; n++) {
    const f = Math.round(((t0 + (n * Math.PI) / omega) * fps));
    if (f > untilFrame) break;
    out.push(f);
  }
  return out;
}
