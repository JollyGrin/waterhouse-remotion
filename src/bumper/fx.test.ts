import { describe, expect, it } from "bun:test";
import {
  dropoutFrames,
  jaggedTop,
  neonDropoutCount,
  neonStrike,
  rainStreaks,
  rainY,
  sweepFront,
  vhsWobble,
  boil,
  jitter,
  noise,
  onTwos,
  pendulum,
  pendulumApexFrames,
  punch,
  shake,
  tornPolygon,
  faderTravel,
  flickerOn,
  frameReaching,
  musicEnvelope,
  settleOvershoot,
  springTrack,
} from "./fx";

describe("noise", () => {
  it("is deterministic and within [-1, 1]", () => {
    for (let f = 0; f < 200; f++) {
      const v = noise(3, f);
      expect(v).toBe(noise(3, f));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
  it("differs by seed and by frame", () => {
    expect(noise(1, 5)).not.toBe(noise(2, 5));
    expect(noise(1, 5)).not.toBe(noise(1, 6));
  });
  it("is roughly centred", () => {
    let sum = 0;
    for (let f = 0; f < 2000; f++) sum += noise(9, f);
    expect(Math.abs(sum / 2000)).toBeLessThan(0.08);
  });
});

describe("stop motion", () => {
  it("holds frames on twos", () => {
    expect([0, 1, 2, 3, 4, 5].map(onTwos)).toEqual([0, 0, 2, 2, 4, 4]);
  });
  it("jitters by whole pixels and only every second frame", () => {
    const a = jitter(4, 10, 1);
    expect(jitter(4, 11, 1)).toEqual(a);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(1);
    expect(Number.isInteger(a.y)).toBe(true);
  });
  it("boils within the amplitude and steps on twos", () => {
    const a = boil(2, 20, 0.6);
    expect(boil(2, 21, 0.6)).toEqual(a);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(0.6);
  });
});

describe("camera", () => {
  it("shakes only inside the window and decays to nothing", () => {
    expect(shake(9, 10, 10, 1)).toEqual({ x: 0, y: 0 });
    expect(shake(18, 10, 10, 1)).toEqual({ x: 0, y: 0 });
    const first = shake(10, 10, 10, 1);
    const late = shake(16, 10, 10, 1);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0);
    expect(Math.abs(late.x)).toBeLessThanOrEqual(10 * Math.pow(1 - 6 / 8, 2));
  });
  it("punches in and comes straight back", () => {
    expect(punch(5, 10, 0.03)).toBe(1);
    expect(punch(12, 10, 0.03)).toBeCloseTo(1.03, 5);
    expect(punch(14, 10, 0.03)).toBeCloseTo(1, 5);
    expect(punch(20, 10, 0.03)).toBe(1);
  });
});

describe("tornPolygon", () => {
  it("keeps the corners and stays near the box", () => {
    const pts = tornPolygon(200, 80, 5, 14, 5)
      .split(", ")
      .map((p) => p.replace(/px/g, "").split(" ").map(Number));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.some(([x, y]) => x === 200 && y === 0)).toBe(true);
    expect(pts.some(([x, y]) => x === 200 && y === 80)).toBe(true);
    expect(pts.some(([x, y]) => x === 0 && y === 80)).toBe(true);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-5);
      expect(x).toBeLessThanOrEqual(205);
      expect(y).toBeGreaterThanOrEqual(-5);
      expect(y).toBeLessThanOrEqual(85);
    }
    expect(pts.length).toBeGreaterThan(20);
  });
});

describe("pendulum", () => {
  const k = 2.1;
  const w = 7.85;
  it("starts at the release angle and decays", () => {
    expect(pendulum(0, 55, k, w)).toBe(55);
    expect(Math.abs(pendulum(1.4, 55, k, w))).toBeLessThan(3);
  });
  it("apex frames alternate side and come every half period", () => {
    const apices = pendulumApexFrames(k, w, 30, 42);
    expect(apices.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < apices.length; i++) {
      const gap = apices[i] - apices[i - 1];
      expect(gap).toBeGreaterThanOrEqual(11);
      expect(gap).toBeLessThanOrEqual(13);
      const a = pendulum(apices[i] / 30, 55, k, w);
      const b = pendulum(apices[i - 1] / 30, 55, k, w);
      expect(Math.sign(a)).toBe(-Math.sign(b));
    }
  });
});

describe("neon strike", () => {
  it("is off before the switch, lit after the window, and drops out 3-5 times", () => {
    for (let seed = 1; seed < 12; seed++) {
      expect(neonStrike(seed, 7, 8)).toBe(0);
      expect(neonStrike(seed, 24, 8)).toBe(1);
      expect(neonStrike(seed, 60, 8)).toBe(1);
      const steps = new Set<number>();
      for (let f = 8; f < 24; f++) if (neonStrike(seed, f, 8) < 1) steps.add(Math.floor((f - 8) / 2));
      expect(steps.size).toBe(neonDropoutCount(seed));
      expect(steps.size).toBeGreaterThanOrEqual(3);
      expect(steps.size).toBeLessThanOrEqual(5);
      // Never drops out on the last step: it settles lit.
      expect(neonStrike(seed, 22, 8)).toBe(1);
    }
  });
  it("holds a dropout for two frames", () => {
    for (let f = 8; f < 24; f += 2) expect(neonStrike(3, f, 8)).toBe(neonStrike(3, f + 1, 8));
  });
});

describe("rain", () => {
  it("spreads seeded streaks across the width and falls on twos", () => {
    const streaks = rainStreaks(50, 7, 1920);
    expect(streaks).toHaveLength(50);
    expect(streaks.some((s) => s.x < 400)).toBe(true);
    expect(streaks.some((s) => s.x > 1500)).toBe(true);
    const s = streaks[0];
    expect(rainY(s, 10, 1080)).toBe(rainY(s, 11, 1080));
    expect(rainY(s, 12, 1080)).not.toBe(rainY(s, 10, 1080));
    for (let f = 0; f < 200; f++) {
      const y = rainY(s, f, 1080);
      expect(y).toBeGreaterThanOrEqual(-80);
      expect(y).toBeLessThan(1080 + 80);
    }
  });
});

describe("vhs", () => {
  it("wobbles within the amplitude and differs by row and frame", () => {
    for (let y = 0; y < 1080; y += 37) {
      expect(Math.abs(vhsWobble(y, 10, 3))).toBeLessThanOrEqual(3);
    }
    expect(vhsWobble(100, 10, 3)).not.toBe(vhsWobble(400, 10, 3));
    expect(vhsWobble(100, 10, 3)).not.toBe(vhsWobble(100, 11, 3));
  });
  it("drops out every ~15 frames", () => {
    const frames = dropoutFrames(5, 40, 100);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i] - frames[i - 1]).toBeGreaterThanOrEqual(11);
      expect(frames[i] - frames[i - 1]).toBeLessThanOrEqual(19);
    }
    expect(frames[0]).toBeGreaterThanOrEqual(40);
    expect(frames[frames.length - 1]).toBeLessThan(100);
  });
  it("sweeps the front to the top in three pulses", () => {
    expect(sweepFront(99, 100, 3, 6, 1080)).toBe(1080);
    expect(sweepFront(106, 100, 3, 6, 1080)).toBeCloseTo(720, 0);
    expect(sweepFront(112, 100, 3, 6, 1080)).toBeCloseTo(360, 0);
    expect(sweepFront(118, 100, 3, 6, 1080)).toBe(0);
    expect(sweepFront(130, 100, 3, 6, 1080)).toBe(0);
    let prev = 1080;
    for (let f = 100; f <= 118; f++) {
      const y = sweepFront(f, 100, 3, 6, 1080);
      expect(y).toBeLessThanOrEqual(prev);
      prev = y;
    }
  });
  it("makes a jagged clip that never dips below the front by more than amp", () => {
    const poly = jaggedTop(1920, 500, 1, 7, 48, 10);
    const ys = poly.split(" ").slice(2).map((p) => Number(p.split(",")[1]));
    expect(ys.length).toBeGreaterThan(30);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(490);
      expect(y).toBeLessThanOrEqual(510);
    }
  });
});

describe("round 4: springTrack", () => {
  it("sits still on a still target", () => {
    expect(springTrack(() => 0.5, 60, { damping: 6, stiffness: 100 })).toBeCloseTo(0.5, 6);
  });
  it("lags a step, overshoots it, and settles on it", () => {
    const step = (f: number) => (f >= 10 ? 1 : 0);
    const cfg = { damping: 6, stiffness: 100 };
    expect(springTrack(step, 11, cfg)).toBeLessThan(0.3); // lag
    let peak = 0;
    for (let f = 10; f < 60; f++) peak = Math.max(peak, springTrack(step, f, cfg));
    expect(peak).toBeGreaterThan(1.15); // overshoot
    expect(springTrack(step, 150, cfg)).toBeCloseTo(1, 2); // settled
  });
});

describe("round 4: fader helpers", () => {
  it("travels 0 to 1 with a ramp, then a constant speed", () => {
    expect(faderTravel(0, 32, 4)).toBe(0);
    expect(faderTravel(32, 32, 4)).toBe(1);
    expect(faderTravel(40, 32, 4)).toBe(1);
    const v1 = faderTravel(20, 32, 4) - faderTravel(19, 32, 4);
    const v2 = faderTravel(30, 32, 4) - faderTravel(29, 32, 4);
    expect(v1).toBeCloseTo(v2, 9);
    expect(faderTravel(2, 32, 4) - faderTravel(1, 32, 4)).toBeLessThan(v1);
    expect(frameReaching((f) => faderTravel(f, 32, 4), 1, 0, 60)).toBe(32);
  });
  it("overshoots by px and is still after 24 frames", () => {
    expect(settleOvershoot(-1, 4)).toBe(0);
    expect(settleOvershoot(0, 4)).toBeCloseTo(0, 6);
    expect(settleOvershoot(2, 4)).toBeCloseTo(4, 6);
    expect(settleOvershoot(6, 4)).toBeLessThan(0);
    expect(Math.abs(settleOvershoot(24, 4))).toBeLessThan(0.1);
  });
  it("flickers on with exactly three dropouts, then holds", () => {
    const on: number[] = [];
    for (let f = 40; f < 70; f++) on.push(flickerOn(9, f, 48, 3, 8));
    expect(on.slice(0, 8).every((v) => v === 0)).toBe(true);
    const window = on.slice(8, 16);
    expect(window.filter((v) => v === 0)).toHaveLength(3);
    expect(window[7]).toBe(1);
    expect(on.slice(16).every((v) => v === 1)).toBe(true);
  });
  it("gives a music envelope in [0, 1] that peaks on the beat", () => {
    for (let f = 0; f < 120; f++) {
      const v = musicEnvelope(5, f);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(musicEnvelope(5, 30)).toBeGreaterThan(musicEnvelope(5, 36));
  });
});
