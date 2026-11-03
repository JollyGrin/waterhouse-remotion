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

// --- Round 3: neon and VHS ---

/**
 * A neon tube striking: from `onFrame` the tube tries to light and drops
 * out `dropouts` times (3-5, seeded) during the first `window` frames,
 * stepped on twos, then holds. Returns the tube's brightness: 1 lit, a dim
 * ember during a dropout, 0 before the switch.
 */
export function neonStrike(
  seed: number,
  frame: number,
  onFrame: number,
  window = 16,
  ember = 0.12,
): number {
  if (frame < onFrame) return 0;
  const t = frame - onFrame;
  if (t >= window) return 1;
  const steps = Math.floor(window / 2);
  const count = 3 + Math.floor(((noise(seed, 0) + 1) / 2) * 3); // 3..5
  const step = Math.floor(t / 2);
  // The dropouts are the `count` steps with the highest noise, so the tube
  // always settles lit at the end of the window.
  const ranked = Array.from({ length: steps - 1 }, (_, i) => i).sort(
    (a, b) => noise(seed + 1, b) - noise(seed + 1, a),
  );
  return ranked.indexOf(step) !== -1 && ranked.indexOf(step) < count ? ember : 1;
}

/** Number of dropout steps `neonStrike` will use for a seed (for tests). */
export function neonDropoutCount(seed: number): number {
  return 3 + Math.floor(((noise(seed, 0) + 1) / 2) * 3);
}

export interface RainStreak {
  x: number;
  phase: number;
  speed: number;
  len: number;
}

/** `count` seeded rain streaks for a w x h frame; positions via rainY. */
export function rainStreaks(count: number, seed: number, w: number): RainStreak[] {
  const out: RainStreak[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: ((noise(seed, i) + 1) / 2) * (w + 200) - 100,
      phase: ((noise(seed + 1, i) + 1) / 2) * 2000,
      speed: 36 + ((noise(seed + 2, i) + 1) / 2) * 18,
      len: 30 + ((noise(seed + 3, i) + 1) / 2) * 34,
    });
  }
  return out;
}

/** The streak's top y at `frame`, stepped on twos, wrapping over h. */
export function rainY(s: RainStreak, frame: number, h: number): number {
  const span = h + 160;
  return ((onTwos(frame) * s.speed + s.phase) % span) - 80;
}

/**
 * VHS tape wobble: the horizontal offset of the row at `y`, a slow sine
 * down the picture plus a faster ripple, `amp` px peak.
 */
export function vhsWobble(y: number, frame: number, amp: number): number {
  return (
    amp * 0.7 * Math.sin(y / 140 + frame * 0.33) +
    amp * 0.3 * Math.sin(y / 23 - frame * 0.9)
  );
}

/**
 * Seeded dropout frames: one every ~`every` frames (+-4), from `from` to
 * `until`. Each is a one-frame white streak at a seeded row.
 */
export function dropoutFrames(seed: number, from: number, until: number, every = 15): number[] {
  const out: number[] = [];
  let f = from + Math.round(((noise(seed, 0) + 1) / 2) * every);
  let i = 1;
  while (f < until) {
    out.push(f);
    f += every + Math.round(noise(seed, i++) * 4);
  }
  return out;
}

/**
 * The front of the VHS lock-in: `sweeps` wipes bottom to top, each taking
 * `len` frames and one equal share of `h`, eased out so each reads as its
 * own pulse. Returns the y above which the picture still exists (h before
 * the first sweep, 0 after the last).
 */
export function sweepFront(frame: number, start: number, sweeps: number, len: number, h: number): number {
  if (frame < start) return h;
  const k = Math.min(sweeps - 1, Math.floor((frame - start) / len));
  const t = Math.min(1, (frame - start - k * len) / len);
  const eased = 1 - Math.pow(1 - t, 3);
  const share = h / sweeps;
  return Math.max(0, h - share * k - share * eased);
}

/**
 * A jagged horizontal edge for a clip polygon: points along y = `front`
 * every `step` px, pushed up or down by up to `amp`, re-seeded per frame.
 * Returned as the polygon for the region ABOVE the edge (0..front).
 */
export function jaggedTop(w: number, front: number, seed: number, frame: number, step = 48, amp = 10): string {
  const pts: string[] = ["0,0", `${w},0`];
  for (let x = w; x >= 0; x -= step) {
    const y = Math.max(0, front + noise(seed + frame, Math.round(x / step)) * amp);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

// --- Round 4: fader and split-flap ---

export interface SpringConfig {
  damping: number;
  stiffness: number;
  mass?: number;
}

/**
 * A mass on a spring chasing a moving target: integrated frame by frame
 * from 0 to `untilFrame` (semi-implicit Euler, 4 substeps), so the output
 * lags, overshoots and rings like a real meter needle. Deterministic and
 * cheap (a few hundred steps). Starts at rest on target(0).
 */
export function springTrack(
  target: (frame: number) => number,
  untilFrame: number,
  { damping, stiffness, mass = 1 }: SpringConfig,
  fps = 30,
): number {
  let x = target(0);
  let v = 0;
  const sub = 4;
  const dt = 1 / fps / sub;
  for (let f = 1; f <= untilFrame; f++) {
    const goal = target(f);
    for (let s = 0; s < sub; s++) {
      const a = (stiffness * (goal - x) - damping * v) / mass;
      v += a * dt;
      x += v * dt;
    }
  }
  return x;
}

/**
 * The thumb overshooting an end stop: a decaying half-sine that peaks at
 * `px` two frames after `t = 0`, dips back past zero and is still by ~20
 * frames (what "spring damping 14" looks like on a 4 px throw). 0 before.
 */
export function settleOvershoot(t: number, px: number): number {
  if (t < 0) return 0;
  const raw = (u: number) => Math.exp(-u / 6) * Math.sin((Math.PI * u) / 4);
  return (px / raw(2)) * raw(t);
}

/**
 * A fader throw with a trapezoid velocity profile: constant acceleration
 * for `accel` frames, then constant speed, arriving at 1 exactly at
 * `frames`. 0 before, 1 after.
 */
export function faderTravel(t: number, frames: number, accel: number): number {
  if (t <= 0) return 0;
  if (t >= frames) return 1;
  // Distance: accel/2 * v during the ramp, then (frames - accel) * v.
  const v = 1 / (accel / 2 + (frames - accel));
  if (t < accel) return (v * t * t) / (2 * accel);
  return (v * accel) / 2 + v * (t - accel);
}

/** The first frame at which a travel curve reaches `level` (for the LEDs). */
export function frameReaching(
  travel: (frame: number) => number,
  level: number,
  from: number,
  until: number,
): number {
  for (let f = from; f <= until; f++) if (travel(f) >= level - 1e-9) return f;
  return until;
}

/**
 * A relay-switched lamp coming on with exactly `dropouts` one-frame
 * dropouts in its first `window` frames (seeded positions, never the last
 * frame), then steady. Returns 0 (off), 1 (on).
 */
export function flickerOn(seed: number, frame: number, onFrame: number, dropouts = 3, window = 8): number {
  if (frame < onFrame) return 0;
  const t = frame - onFrame;
  if (t >= window - 1) return 1;
  const ranked = Array.from({ length: window - 1 }, (_, i) => i).sort(
    (a, b) => noise(seed, b) - noise(seed, a),
  );
  return ranked.indexOf(t) < dropouts ? 0 : 1;
}

/**
 * A seeded "music" level in [0, 1]: a kick every `beat` frames with a fast
 * decay, a softer off-beat, and a little noise, like a VU meter watching a
 * track. Deterministic per frame.
 */
export function musicEnvelope(seed: number, frame: number, beat = 15): number {
  const inBeat = ((frame % beat) + beat) % beat;
  const kick = Math.exp(-inBeat / 3.2);
  const off = Math.exp(-(((inBeat + beat / 2) % beat) / 4)) * 0.45;
  const bar = Math.floor(frame / beat);
  const accent = 0.85 + 0.15 * ((noise(seed, bar) + 1) / 2);
  const n = 0.06 * noise(seed + 3, frame);
  return Math.max(0, Math.min(1, 0.42 + 0.5 * accent * Math.max(kick, off) + n));
}
